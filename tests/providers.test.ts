import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { configuration } from "../server/configuration.js";
import { providerManager, providerSave } from "../server/providers.js";
import { ProviderCodex } from "./provider-fixture.js";
import { configSecret } from "./config-fixture.js";
import { createServer as httpServer } from "node:http";
async function fixture(fn: (f: any) => Promise<void>, endpoint?: string) {
  const directory = mkdtempSync(join(tmpdir(), "newbot-providers-")),
    codex = new ProviderCodex(endpoint);
  const ctx = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "work"),
    codex,
    password: "provider-test-password",
    origins: ["http://127.0.0.1:3100"],
  });
  const store = configuration(codex, join(directory, "work")),
    manager = providerManager(codex, ctx.db, store);
  const revision = async () => (await store.read()).publicView.revision;
  try {
    await fn({ ...ctx, codex, store, manager, revision });
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
const saveInput = (revision: string, patch: any = {}, rest: any = {}) => ({
  expectedRevision: revision,
  id: "secondary",
  create: false,
  patch: { name: "Renamed", ...patch },
  ...rest,
});
test("provider edit preserves credentials and advanced fields, create fixes Responses semantics, strict revisions reject stale writes", async () => {
  await fixture(async ({ manager, revision, codex, store }: any) => {
    const original = structuredClone(codex.config.model_providers.fixture),
      token = await revision();
    const edited = await manager.save(
      saveInput(token, { name: "Changed" }, { id: "fixture" }),
    );
    assert.equal(edited.state, "applied");
    assert.deepEqual(codex.config.model_providers.fixture, {
      ...original,
      name: "Changed",
    });
    assert.ok(!JSON.stringify(edited.configuration).includes(configSecret));
    const writes = codex.calls.filter(
      (c: any) => c.method === "config/batchWrite",
    );
    assert.equal(writes[0].params.expectedVersion, "1");
    assert.equal(
      writes[0].params.edits[0].keyPath,
      "model_providers.fixture.name",
    );
    await assert.rejects(manager.save(saveInput(token)), { statusCode: 409 });
    await manager.save(
      saveInput(
        await revision(),
        { name: "New", baseUrl: "http://127.0.0.1:9/v1/", envKey: null },
        { id: "newone", create: true },
      ),
    );
    assert.deepEqual(codex.config.model_providers.newone, {
      name: "New",
      base_url: "http://127.0.0.1:9/v1",
      wire_api: "responses",
      requires_openai_auth: false,
    });
    await assert.rejects(
      manager.save(
        saveInput(
          await revision(),
          { name: "dup", baseUrl: "http://localhost" },
          { id: "newone", create: true },
        ),
      ),
      /已存在/,
    );
    assert.equal(
      (await store.read()).publicView.providers.find(
        (p: any) => p.id === "fixture",
      ).editable,
      true,
    );
  });
});
test("provider schemas reject raw keys, arbitrary config, unsafe URLs and unapproved credential references", async () => {
  await fixture(async ({ manager, revision }: any) => {
    const token = await revision();
    for (const baseUrl of [
      "file:///etc/passwd",
      "https://user:secret@example.com/v1",
      "https://example.com/v1?token=secret",
      "https://example.com/#fragment",
    ])
      assert.equal(
        providerSave.safeParse(saveInput(token, { baseUrl })).success,
        false,
      );
    for (const patch of [
      { apiKey: "secret" },
      { http_headers: { Authorization: "secret" } },
      { wire_api: "chat" },
    ])
      assert.equal(
        providerSave.safeParse({ ...saveInput(token), patch }).success,
        false,
      );
    for (const envKey of [
      "ADMIN_PASSWORD",
      "HOME",
      "NODE_OPTIONS",
      "CODEX_HOME",
      "UNAUTHORIZED_NEWBOT_ENV",
    ])
      await assert.rejects(
        manager.save(saveInput(token, { envKey })),
        /未授权/,
      );
    await manager.save(saveInput(token, { envKey: "OPENAI_API_KEY" }));
    await manager.save(saveInput(await revision(), { envKey: null }));
  });
});
test("provider definitions from non-user layers and builtins are read-only", async () => {
  await fixture(async ({ manager, revision, codex, store }: any) => {
    await assert.rejects(
      manager.save(saveInput(await revision(), {}, { id: "openai" })),
      /内置/,
    );
    const original = codex.call.bind(codex);
    codex.call = async (method: any, params: any) => {
      const r = await original(method, params);
      if (method === "config/read")
        r.origins["model_providers.secondary"] = {
          name: { type: "project", dotCodexFolder: "/work" },
          version: "1",
        };
      return r;
    };
    assert.equal(
      (await store.read()).publicView.providers.find(
        (p: any) => p.id === "secondary",
      ).editable,
      false,
    );
    await assert.rejects(manager.save(saveInput(await revision())), /来源/);
    await assert.rejects(
      manager.remove({ id: "secondary", expectedRevision: await revision() }),
      /不能/,
    );
  });
});
test("provider deletion protects active provider, archived Web history, config profiles and native history before removing only the definition", async () => {
  await fixture(async ({ manager, revision, codex, db }: any) => {
    const del = async (id = "secondary") =>
      manager.remove({ id, expectedRevision: await revision() });
    await assert.rejects(del("fixture"), /当前/);
    db.raw
      .prepare(
        "INSERT INTO threads(id,title,provider,updated,archived) VALUES(?,?,?,?,?)",
      )
      .run("old", "old", "secondary", Date.now(), 1);
    await assert.rejects(del(), /历史会话/);
    db.raw.prepare("DELETE FROM threads WHERE id=?").run("old");
    codex.config.profiles = { alternate: { model_provider: "secondary" } };
    await assert.rejects(del(), /配置仍引用/);
    delete codex.config.profiles;
    codex.nativeReferences = [{ provider: "secondary", archived: true }];
    await assert.rejects(del(), /Codex 历史/);
    codex.nativeReferences = [];
    const result = await del();
    assert.equal(result.state, "applied");
    assert.equal(codex.config.model_providers.secondary, undefined);
    assert.ok(codex.config.model_providers.fixture.http_headers);
    const calls = codex.calls.filter((c: any) => c.method === "thread/list");
    assert.ok(calls.some((c: any) => c.params.archived === true));
    assert.ok(
      calls.every((c: any) => c.params.modelProviders[0] === "secondary"),
    );
  });
});
test("provider deletion fails closed when native references cannot be read", async () => {
  await fixture(async ({ manager, revision, codex }: any) => {
    const original = codex.call.bind(codex);
    codex.call = async (m: any, p: any) =>
      m === "thread/list" ? {} : original(m, p);
    await assert.rejects(
      manager.remove({ id: "secondary", expectedRevision: await revision() }),
      /核对/,
    );
    assert.ok(codex.config.model_providers.secondary);
  });
});
test("provider API requires authentication and safe origin, blocks active work and returns only redacted state after reload", async () => {
  await fixture(async ({ app, codex }: any) => {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/config",
          headers: { origin: "http://127.0.0.1:3100" },
          payload: { action: "provider/save" },
        })
      ).statusCode,
      401,
    );
    const origin = "http://127.0.0.1:3100",
      login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin },
        payload: { password: "provider-test-password" },
      }),
      headers = { origin, cookie: login.headers["set-cookie"].split(";")[0] };
    const before = (await app.inject({ url: "/api/config", headers })).json();
    const payload = {
      action: "provider/save",
      ...saveInput(before.configuration.revision),
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/config",
          headers: { ...headers, origin: "https://evil.example" },
          payload,
        })
      ).statusCode,
      403,
    );
    for (const type of ["task", "approval"]) {
      if (type === "task") codex.active.add("running");
      else
        codex.approvals.set("waiting", {
          id: "waiting",
          method: "test",
          params: {},
        });
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/config",
            headers,
            payload,
          })
        ).statusCode,
        400,
      );
      codex.active.clear();
      codex.approvals.clear();
    }
    const response = await app.inject({
      method: "POST",
      url: "/api/config",
      headers,
      payload,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().state, "applied");
    assert.ok(!response.body.includes(configSecret));
    assert.ok(!response.body.includes("preserved-private-header"));
    assert.equal(codex.restarts, 1);
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/config",
          headers,
          payload,
        })
      ).statusCode,
      409,
    );
  });
});
test("provider switch uses native CAS, refreshes models and normalizes unsupported defaults", async () => {
  await fixture(async ({ service, codex }: any) => {
    const settings = await service.settings();
    await service.handle("provider/switch", {
      provider: "secondary",
      expectedRevision: settings.configuration.revision,
    });
    assert.equal(codex.config.model_provider, "secondary");
    assert.equal(codex.config.model, "secondary-model");
    assert.equal(codex.config.model_reasoning_effort, "low");
    const actual = await service.settings();
    assert.equal(actual.models[0].model, "secondary-model");
    assert.ok(actual.providers.some((p: any) => p.id === "openai"));
    await assert.rejects(
      service.handle("provider/switch", {
        provider: "fixture",
        expectedRevision: settings.configuration.revision,
      }),
      { statusCode: 409 },
    );
    assert.equal(service.busy, false);
  });
});
test("provider restart failures report saved state, release maintenance and do not erase edits", async () => {
  await fixture(async ({ service, codex }: any) => {
    const settings = await service.settings();
    codex.failRestart = true;
    await assert.rejects(
      service.handle(
        "provider/save",
        saveInput(settings.configuration.revision),
      ),
      /已写入/,
    );
    assert.equal(codex.config.model_providers.secondary.name, "Renamed");
    assert.equal(service.busy, false);
    assert.equal(codex.state, "offline");
    await service.handle("bridge/restart", {});
    const latest = await service.settings();
    await service.handle(
      "provider/save",
      saveInput(latest.configuration.revision, { name: "Recovered" }),
    );
    assert.equal(codex.config.model_providers.secondary.name, "Recovered");
  });
});
test("a failed Provider switch rolls back its own version without clobbering concurrent edits", async () => {
  await fixture(async ({ service, codex }: any) => {
    const settings = await service.settings(),
      original = codex.call.bind(codex);
    let once = true;
    codex.call = async (m: any, p: any) => {
      if (
        m === "model/list" &&
        codex.config.model_provider === "secondary" &&
        once
      ) {
        once = false;
        return { data: [], nextCursor: null };
      }
      return original(m, p);
    };
    await assert.rejects(
      service.handle("provider/switch", {
        provider: "secondary",
        expectedRevision: settings.configuration.revision,
      }),
      /可用模型/,
    );
    assert.equal(codex.config.model_provider, "fixture");
    assert.equal(codex.config.model, "fixture-model");
    assert.equal(service.busy, false);
  });
  await fixture(async ({ service, codex }: any) => {
    const settings = await service.settings(),
      original = codex.restart.bind(codex);
    codex.restart = async () => {
      await original();
      codex.config.model_provider = "fixture";
      codex.config.external_write = "keep";
      codex.version++;
    };
    await assert.rejects(
      service.handle("provider/switch", {
        provider: "secondary",
        expectedRevision: settings.configuration.revision,
      }),
    );
    assert.equal(codex.config.external_write, "keep");
    assert.equal(codex.state, "ready");
    assert.equal(service.busy, false);
  });
});
test("provider diagnostics bound responses, isolate credentials, refuse redirects and distinguish catalog from compatibility", async () => {
  let mode = "ok",
    received: any[] = [];
  const secret = "SYNTHETIC_DIAGNOSTIC_TOKEN",
    env = "NEWBOT_DIAGNOSTIC_KEY";
  const upstream = httpServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      received.push({
        url: req.url,
        authorization: req.headers.authorization,
        body: body ? JSON.parse(body) : null,
      });
      res.setHeader("content-type", "application/json");
      if (mode === "redirect") {
        res.statusCode = 302;
        res.setHeader("location", "/leaked");
        res.end();
      } else if (mode === "error") {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: secret }));
      } else if (mode === "large")
        res.end(JSON.stringify({ data: "x".repeat(270000) }));
      else if (mode === "malformed") res.end(JSON.stringify({ output: [] }));
      else if (req.url?.endsWith("/models"))
        res.end(
          JSON.stringify({
            data: [
              { id: "test-model" },
              { id: secret },
              { id: "invalid model" },
              { id: "test-model" },
            ],
          }),
        );
      else
        res.end(
          JSON.stringify({
            id: "resp_test",
            object: "response",
            status: "completed",
            output: [{ content: secret }],
          }),
        );
    });
  });
  await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
  const address = upstream.address() as any;
  const previous = process.env[env],
    allow = process.env.PROVIDER_CREDENTIAL_ENV_ALLOWLIST;
  process.env[env] = secret;
  process.env.PROVIDER_CREDENTIAL_ENV_ALLOWLIST = env;
  try {
    await fixture(async ({ manager, revision, codex }: any) => {
      codex.config.model_providers.secondary.env_key = env;
      const probe = async (test = false) =>
        manager.probe(
          {
            id: "secondary",
            expectedRevision: await revision(),
            model: "test-model",
          },
          async () => [{ model: "native-model" }],
          test,
        );
      const models = await probe();
      assert.deepEqual(models.models, ["test-model"]);
      assert.equal(models.source, "upstream");
      assert.match(models.note, /兼容性未验证/);
      const result = await probe(true);
      assert.equal(result.source, "responses");
      assert.ok(!JSON.stringify(result).includes(secret));
      assert.equal(received[1].authorization, `Bearer ${secret}`);
      assert.deepEqual(received[1].body, {
        model: "test-model",
        input: "Reply OK.",
        stream: false,
        store: false,
        max_output_tokens: 64,
        tools: [],
      });
      const native = await manager.probe(
        { id: "fixture", expectedRevision: await revision() },
        async () => [{ model: "native-model" }],
        false,
      );
      assert.equal(native.source, "codex");
      const account = await manager.probe(
        { id: "openai", expectedRevision: await revision() },
        async () => [],
        true,
      );
      assert.equal(account.source, "account");
      mode = "malformed";
      await assert.rejects(probe(true), { statusCode: 502 });
      for (const fail of ["error", "large", "redirect"]) {
        mode = fail;
        await assert.rejects(
          probe(),
          (e: any) => !e.message.includes(secret) && e.statusCode === 502,
        );
      }
      assert.ok(!received.some((r) => r.url === "/leaked"));
      delete process.env[env];
      mode = "ok";
      await assert.rejects(probe(), /环境变量不可用/);
    }, `http://127.0.0.1:${address.port}/v1`);
  } finally {
    if (previous === undefined) delete process.env[env];
    else process.env[env] = previous;
    if (allow === undefined)
      delete process.env.PROVIDER_CREDENTIAL_ENV_ALLOWLIST;
    else process.env.PROVIDER_CREDENTIAL_ENV_ALLOWLIST = allow;
    await new Promise<void>((r) => upstream.close(() => r()));
  }
});
test("provider maintenance blocks new work while a write is pending and always releases after failed reads", async () => {
  await fixture(async ({ service, codex }: any) => {
    const before = await service.settings();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      gate = new Promise<void>((r) => (release = r));
    const original = codex.call.bind(codex);
    codex.call = async (method: any, params: any) => {
      if (method === "config/batchWrite") {
        enter();
        await gate;
      }
      return original(method, params);
    };
    const saving = service.handle(
      "provider/save",
      saveInput(before.configuration.revision),
    );
    await entered;
    try {
      assert.equal(service.busy, true);
      await assert.rejects(service.handle("thread/start", {}), {
        statusCode: 409,
      });
    } finally {
      release();
    }
    await saving;
    assert.equal(service.busy, false);
    codex.failRead = true;
    await assert.rejects(
      service.handle("provider/switch", { provider: "secondary" }),
    );
    assert.equal(service.busy, false);
    codex.failRead = false;
    await service.handle("provider/switch", {
      provider: "secondary",
      expectedRevision: (await service.settings()).configuration.revision,
    });
  });
});
test("lost Provider write replies reconcile the process without a duplicate mutation", async () => {
  await fixture(async ({ service, codex }: any) => {
    const before = await service.settings();
    codex.loseResponse = true;
    await assert.rejects(
      service.handle("provider/save", saveInput(before.configuration.revision)),
      { statusCode: 409 },
    );
    assert.equal(codex.config.model_providers.secondary.name, "Renamed");
    assert.equal(codex.restarts, 1);
    assert.equal(
      codex.calls.filter((c: any) => c.method === "config/batchWrite").length,
      1,
    );
    assert.equal(service.busy, false);
    assert.equal(
      (await service.settings()).configuration.providers.find(
        (p: any) => p.id === "secondary",
      ).name,
      "Renamed",
    );
  });
});

test("model catalog retains all purposes including default and manual entries", async () => {
  let directoryFails = false;
  const upstream = httpServer((_req, res) => {
    if (directoryFails) {
      res.writeHead(503);
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        data: [
          { id: "bge-m3" },
          { id: "bge-reranker-v2-m3" },
          { id: "opaque-vector", task: "embedding" },
          { id: "chat-alias", task: "text-generation" },
          null,
        ],
      }),
    );
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  try {
    await fixture(
      async ({ service, codex, db }: any) => {
        codex.config.profiles = {
          newbot_gateway_secondary: {
            model: "bge-m3",
            model_provider: "secondary",
          },
        };
        codex.config.newbot_models = {
          secondary: ["bge-reranker-v2-m3", "opaque-vector"],
        };
        const catalog = await service.handle("gateway/catalog", {
          refresh: true,
        });
        const gateway = catalog.find((g: any) => g.id === "secondary");
        assert.deepEqual(
          gateway.models.map((m: any) => m.model),
          ["bge-m3", "bge-reranker-v2-m3", "opaque-vector", "chat-alias"],
        );
        for (const model of ["bge-m3", "bge-reranker-v2-m3", "opaque-vector"]) {
          assert.equal((await service.runtimeSettings.validate("secondary", model)).model, model);
        }
        assert.equal((await service.runtimeSettings.validate("secondary")).model, "bge-m3");
        assert.equal(
          (await service.runtimeSettings.validate("secondary", "chat-alias"))
            .model,
          "chat-alias",
        );
        directoryFails = true;
        const failed = (
          await service.handle("gateway/catalog", { refresh: true })
        ).find((g: any) => g.id === "secondary");
        assert.ok(failed.error);
        assert.deepEqual(
          failed.models.map((m: any) => m.model).sort(),
          ["bge-m3", "bge-reranker-v2-m3", "opaque-vector"].sort(),
          "directory errors retain manual and saved defaults regardless of purpose",
        );
        assert.ok(
          db.raw
            .prepare(
              "SELECT value FROM metadata WHERE key LIKE 'model-purposes-v1:%'",
            )
            .all().length,
        );
      },
      `http://127.0.0.1:${(upstream.address() as any).port}`,
    );
  } finally {
    upstream.closeAllConnections();
    await new Promise<void>((r) => upstream.close(() => r()));
  }
});

test("supplemental followups use the selected route, disable tools and accept only structured text", async () => {
  const bodies: any[] = [];
  let output: any[] = [{type: "message", content: [{type: "output_text",text: JSON.stringify({suggestions: ["如何监控连接池等待时间？", "怎样识别未释放的数据库连接？"]})}]}];
  const server = httpServer(async (req, res) => {
    let body = "";for await(const chunk of req) body += chunk;
    bodies.push(JSON.parse(body));assert.equal(req.url,"/v1/responses");
    res.setHeader("Content-Type","application/json");res.end(JSON.stringify({status:"completed",output}));
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  try {
    await fixture(async ({manager,codex}:any)=>{
      const questions = await manager.followups("thread-id","secondary","secondary-model","连接池等待超时");
      assert.equal(questions.length,2);assert.equal(bodies[0].model,"secondary-model");
      assert.deepEqual(bodies[0].tools,[]);assert.equal(bodies[0].tool_choice,"none");assert.equal(bodies[0].store,false);
      assert.equal(bodies[0].text.format.type,"json_schema");
      assert.equal(codex.calls.filter((c:any)=>c.method==="turn/start").length,0);
      output=[{type:"function_call",name:"exec",arguments:"{}"}];
      await assert.rejects(manager.followups("thread-id","secondary","secondary-model","context"),/追问生成失败/);
    },`http://127.0.0.1:${(server.address() as any).port}/v1`);
  } finally {await new Promise<void>(r=>server.close(()=>r()));}
});
