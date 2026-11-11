import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer as httpServer } from "node:http";
import {
  ProviderRuntime,
  providerRuntimeInput,
  providerRuntimeValues,
} from "../server/provider-runtime.js";
import {
  fetchProviderSource,
  initialProviderRuntime,
} from "../server/provider-source.js";
import { configuration } from "../server/configuration.js";
import { ConfigCodex } from "./config-fixture.js";
import { createServer } from "../server/index.js";
import { database } from "../server/db.js";
import {
  credentialVault,
  credentialBinding,
} from "../server/credential-vault.js";
import { codexEnvironment } from "../server/codex.js";
import { volatileRuntimeLogs } from "../server/runtime-logs.js";
import { stat, statfs, writeFile } from "node:fs/promises";

const source = (path = "one") => ({
  providers: [
    {
      id: "memory_gateway",
      name: "测试网关",
      baseUrl: `https://example.com/${path}`,
      defaultModel: "fixture-model",
    },
  ],
  defaults: {
    provider: "memory_gateway",
    model: "fixture-model",
    effort: "medium",
  },
});
const seed = () => providerRuntimeValues(providerRuntimeInput.parse(source()));

test("the default product path uses SQLite snapshots and ignores native Provider file defaults", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-memory-default-"));
  const ctx = await createServer({
    directory,
    cwd: join(directory, "work"),
    codex: new MemoryCodex(),
    password: "memory-default-test-password",
    origins: ["http://127.0.0.1:3100"],
  });
  try {
    assert.equal(ctx.runtime.providerRuntime?.storage, "sqlite");
    const view = await ctx.service.providerConfiguration();
    assert.deepEqual(view.providers, []);
    assert.equal(view.defaults.provider, "openai");
    assert.equal(view.providerStorage, "sqlite");
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("memory Provider editing remains writable without a native user layer and cannot bypass native MCP write restrictions", async () => {
  const codex = new ConfigCodex();
  codex.noWritableLayer = true;
  const runtime = new ProviderRuntime(seed()),
    store = configuration(codex, "/work", runtime);
  const before = await store.read();
  assert.equal(before.publicView.writable, true);
  assert.equal(before.publicView.nativeWritable, false);
  await store.writeDefaults(
    {
      expectedRevision: before.publicView.revision,
      model: "fixture-model",
      effort: "high",
    },
    async () => {},
  );
  assert.equal(runtime.snapshot().values.model_reasoning_effort, "high");
  await assert.rejects(
    store.mutate((await store.read()).publicView.revision, async () => ({
      edits: [
        {
          keyPath: "mcp_servers.remote.enabled",
          value: false,
          mergeStrategy: "replace",
        },
      ],
      effective: () => true,
    })),
    /不可写/,
  );
  assert.equal(
    codex.calls.filter((c) => c.method === "config/batchWrite").length,
    0,
  );
});

test("native diagnostics use a private tmpfs directory, clean up, and fail closed for an invalid log root", async () => {
  const before = process.env.NEWBOT_RUNTIME_LOG_ROOT;
  try {
    delete process.env.NEWBOT_RUNTIME_LOG_ROOT;
    const logs = await volatileRuntimeLogs();
    assert.equal((await statfs(logs.path)).type, 0x01021994);
    assert.equal((await stat(logs.path)).mode & 0o777, 0o700);
    await writeFile(join(logs.path, "synthetic.log"), "volatile-only");
    await logs.close();
    assert.equal(existsSync(logs.path), false);
    process.env.NEWBOT_RUNTIME_LOG_ROOT = "/dev/null";
    await assert.rejects(volatileRuntimeLogs(), /tmpfs/);
  } finally {
    if (before === undefined) delete process.env.NEWBOT_RUNTIME_LOG_ROOT;
    else process.env.NEWBOT_RUNTIME_LOG_ROOT = before;
  }
});

test("Provider snapshots are detached, leased revisions survive edits, and unleased old revisions expire", () => {
  const store = new ProviderRuntime(seed());
  const before = store.snapshot();
  before.values.model_providers.memory_gateway.base_url =
    "https://evil.example";
  assert.equal(
    store.snapshot().values.model_providers.memory_gateway.base_url,
    "https://example.com/one",
  );
  const release = store.retain();
  store.apply(before.revision, [
    {
      keyPath: "model_providers.memory_gateway.base_url",
      value: "https://example.com/two",
      mergeStrategy: "replace",
    },
  ]);
  assert.equal(
    store.threadConfig("memory_gateway", before.revision).config.model_providers
      .memory_gateway.base_url,
    "https://example.com/one",
  );
  release();
  release();
  assert.throws(() => store.snapshot(before.revision), /失效/);
  assert.throws(() => store.apply(before.revision, []), /变化/);
});

test("configuration mutations use RAM CAS and never call native config writes, including defaults and credential references", async () => {
  const codex = new ConfigCodex(),
    runtime = new ProviderRuntime(seed());
  const store = configuration(codex, "/work", runtime);
  const before = await store.read();
  const results = await Promise.allSettled(
    ["two", "three"].map((path) =>
      store.mutate(before.publicView.revision, async () => ({
        edits: [
          {
            keyPath: "model_providers.memory_gateway.base_url",
            value: `https://example.com/${path}`,
            mergeStrategy: "replace",
          },
        ],
        effective: (after) =>
          (after.response.config.model_providers as any).memory_gateway
            .base_url === `https://example.com/${path}`,
      })),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    codex.calls.filter((c) => c.method === "config/batchWrite").length,
    0,
  );
  assert.equal(codex.config.model_providers.memory_gateway, undefined);
  const view = (await store.read()).publicView;
  assert.equal(view.providerStorage, "memory");
  assert.equal(view.providers.length, 1);
  assert.equal(view.providers[0].editable, true);
  assert.ok(!JSON.stringify(view).includes("SYNTHETIC_CONFIG_SECRET"));
  await store.writeDefaults(
    { expectedRevision: view.revision, model: "fixture-model", effort: "high" },
    async () => {},
  );
  assert.equal(runtime.snapshot().values.model_reasoning_effort, "high");
  assert.equal(
    codex.calls.filter((c) => c.method === "config/batchWrite").length,
    0,
  );
});

test("non-Provider configuration remains native, and mixed storage mutations are rejected before writing", async () => {
  const codex = new ConfigCodex(),
    store = configuration(codex, "/work", new ProviderRuntime(seed()));
  let before = await store.read();
  await store.mutate(before.publicView.revision, async () => ({
    edits: [
      {
        keyPath: "mcp_servers.remote.enabled",
        value: true,
        mergeStrategy: "replace",
      },
    ],
    effective: (after) =>
      (after.response.config.mcp_servers as any).remote.enabled,
  }));
  assert.equal(codex.config.mcp_servers.remote.enabled, true);
  before = await store.read();
  const writes = codex.calls.filter(
    (c) => c.method === "config/batchWrite",
  ).length;
  await assert.rejects(
    store.mutate(before.publicView.revision, async () => ({
      edits: [
        { keyPath: "model", value: "fixture-model", mergeStrategy: "replace" },
        {
          keyPath: "mcp_servers.remote.enabled",
          value: false,
          mergeStrategy: "replace",
        },
      ],
      effective: () => true,
    })),
    /同时/,
  );
  assert.equal(
    codex.calls.filter((c) => c.method === "config/batchWrite").length,
    writes,
  );
});

test("source payloads cannot carry keys, executable configuration, duplicate IDs or unsafe URLs", () => {
  for (const patch of [
    { apiKey: "secret" },
    { http_headers: { Authorization: "secret" } },
    { command: "sh" },
    { baseUrl: "https://user:key@example.com" },
    { baseUrl: "file:///etc/passwd" },
  ]) {
    const value = source();
    Object.assign(value.providers[0], patch);
    assert.equal(providerRuntimeInput.safeParse(value).success, false);
  }
  const repeated = source();
  repeated.providers.push(repeated.providers[0]);
  assert.equal(providerRuntimeInput.safeParse(repeated).success, false);
});

class MemoryCodex extends ConfigCodex {
  restarts = 0;
  override async restart() {
    this.restarts++;
    this.state = "ready";
    if (this.credentialSource)
      this.credentialRefs = new Set(Object.keys(await this.credentialSource()));
  }
  override async unload(id: string) {
    this.loaded.delete(id);
  }
  override async call(method: any, params: any): Promise<any> {
    const result: any = await super.call(method, params);
    if (method === "thread/start" || method === "thread/resume") {
      const provider = params.modelProvider || "memory_gateway";
      result.modelProvider = provider;
      result.model = params.model || "fixture-model";
      result.thread.modelProvider = provider;
      this.threads.get(result.thread.id)!.modelProvider = provider;
      this.loaded.add(result.thread.id);
    }
    return result;
  }
}

async function fixture(fn: (ctx: any) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "newbot-memory-api-")),
    origin = "http://127.0.0.1:3100";
  const codex = new MemoryCodex(),
    runtime = new ProviderRuntime(seed());
  const ctx = await createServer({
    directory,
    cwd: join(directory, "workspace"),
    codex,
    providerRuntime: runtime,
    password: "memory-runtime-test-password",
    origins: [origin],
  });
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password: "memory-runtime-test-password" },
  });
  const headers = {
    origin,
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
  };
  const post = (url: string, payload: object) =>
    ctx.app.inject({ method: "POST", url, headers, payload });
  const config = async () =>
    (
      await ctx.app.inject({
        method: "GET",
        url: "/api/runtime/config",
        headers,
      })
    ).json().configuration;
  try {
    await fn({
      ...ctx,
      codex,
      memory: runtime,
      post,
      config,
      headers,
      directory,
    });
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("authenticated source publication and gateway CRUD update RAM without restart or config files", async () =>
  fixture(async (c) => {
    let view = await c.config();
    const anonymous = await c.app.inject({
      method: "POST",
      url: "/api/runtime/config",
      headers: { origin: c.headers.origin },
      payload: { ...source(), expectedRevision: view.revision },
    });
    assert.equal(anonymous.statusCode, 401);
    const rejected = await c.app.inject({
      method: "POST",
      url: "/api/runtime/config",
      headers: { ...c.headers, origin: "https://evil.example" },
      payload: { ...source(), expectedRevision: view.revision },
    });
    assert.equal(rejected.statusCode, 403);
    let response = await c.post("/api/runtime/config", {
      ...source("two"),
      expectedRevision: view.revision,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(
      c.memory.snapshot().values.model_providers.memory_gateway.base_url,
      "https://example.com/two",
    );
    response = await c.post("/api/runtime/config", {
      ...source("three"),
      expectedRevision: view.revision,
    });
    assert.equal(response.statusCode, 409);
    view = await c.config();
    response = await c.post("/api/config", {
      action: "gateway/save",
      requestId: randomUUID(),
      targetId: "memory_gateway",
      name: "改名",
      baseUrl: "https://example.com/three",
      expectedRevision: view.revision,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(
      c.memory.snapshot().values.model_providers.memory_gateway.name,
      "改名",
    );
    assert.equal(c.codex.restarts, 0);
    assert.equal(
      c.codex.calls.filter((x: any) => x.method === "config/batchWrite").length,
      0,
    );
    assert.equal(existsSync(join(c.directory, "codex", "config.toml")), false);
  }));

test("updates preserve running turns, retry IDs and drafts; new run metadata contains only selection and revision", async () =>
  fixture(async (c) => {
    const requestId = randomUUID();
    const payload = {
      requestId,
      text: "保留历史",
      provider: "memory_gateway",
      model: "fixture-model",
    };
    const first = await c.post("/api/agent/run", payload);
    assert.equal(first.statusCode, 200, first.body);
    const accepted = first.json();
    const oldTurns = c.codex.threads.get(accepted.threadId).turns.length;
    const before = await c.config();
    const update = await c.post("/api/runtime/config", {
      ...source("next"),
      expectedRevision: before.revision,
    });
    assert.equal(update.statusCode, 200, update.body);
    assert.ok(c.codex.active.has(accepted.threadId));
    const retry = await c.post("/api/agent/run", payload);
    assert.equal(retry.statusCode, 200, retry.body);
    assert.equal(c.codex.threads.get(accepted.threadId).turns.length, oldTurns);
    const context = c.db.raw
      .prepare("SELECT context FROM run_context WHERE request_id=?")
      .get(requestId).context;
    assert.ok(!context.includes("example.com"));
    assert.ok(JSON.parse(context).providerConfigRevision);
    assert.equal(
      c.db.raw
        .prepare("SELECT provider,model FROM session_runtime WHERE thread_id=?")
        .get(accepted.threadId).provider,
      "memory_gateway",
    );
    c.codex.finish(accepted.threadId);
  }));

test("an empty runtime rejects old Provider selection while retaining its session binding and native history", async () =>
  fixture(async (c) => {
    const first = await c.post("/api/agent/run", {
      requestId: randomUUID(),
      text: "旧会话",
      provider: "memory_gateway",
      model: "fixture-model",
    });
    assert.equal(first.statusCode, 200, first.body);
    const id = first.json().threadId;
    c.codex.finish(id);
    const blank = new ProviderRuntime();
    c.codex.providerRuntime = blank;
    const separate = configuration(
      c.codex,
      join(c.directory, "workspace"),
      blank,
    );
    assert.equal((await separate.read()).publicView.providers.length, 0);
    assert.throws(() => blank.threadConfig("memory_gateway"), /尚未下发/);
    assert.equal(c.db.provider(id), "memory_gateway");
    assert.ok(c.codex.threads.get(id).turns.length);
    assert.equal(c.codex.restarts, 0);
  }));

test("encrypted credentials rebind only to an identical explicitly supplied receiver, never a changed endpoint", () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-memory-vault-")),
    cwd = join(directory, "workspace");
  mkdirSync(cwd);
  const db = database(directory),
    vault = credentialVault(db, directory, cwd);
  try {
    const config = seed();
    const binding = credentialBinding("provider", "memory_gateway", config)!;
    const ref = vault.stage(
      "provider",
      "memory_gateway",
      binding.binding,
      "encrypted",
      Buffer.from("test-credential"),
    );
    vault.restoreProviderReferences(config);
    assert.equal(config.model_providers.memory_gateway.env_key, ref);
    const changed = providerRuntimeValues(
      providerRuntimeInput.parse(source("different")),
    );
    vault.restoreProviderReferences(changed);
    assert.equal(changed.model_providers.memory_gateway.env_key, undefined);
    assert.ok(!JSON.stringify(config).includes("test-credential"));
  } finally {
    vault.close();
    db.raw.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Web can restore a missing historical gateway under its original ID and reconnect its uniquely bound encrypted credential", async () =>
  fixture(async (c) => {
    const first = await c.post("/api/agent/run", {
      requestId: randomUUID(),
      text: "历史网关恢复",
      provider: "memory_gateway",
      model: "fixture-model",
    });
    assert.equal(first.statusCode, 200, first.body);
    const id = first.json().threadId;
    c.codex.finish(id);
    const definition = c.memory.snapshot().values;
    const binding = credentialBinding(
      "provider",
      "memory_gateway",
      definition,
    )!;
    const ref = c.vault.stage(
      "provider",
      "memory_gateway",
      binding.binding,
      "encrypted",
      Buffer.from("restore-test-secret"),
    );
    let view = await c.config();
    const cleared = await c.post("/api/runtime/config", {
      expectedRevision: view.revision,
      providers: [],
    });
    assert.equal(cleared.statusCode, 200, cleared.body);
    const missing = (await c.service.settings()).configuration.providers.find(
      (p: any) => p.id === "memory_gateway",
    );
    assert.equal(missing.missing, true);
    assert.equal(missing.editable, true);
    view = await c.config();
    const unknown = await c.post("/api/config", {
      action: "gateway/save",
      requestId: randomUUID(),
      targetId: "not_a_saved_gateway",
      name: "Unknown",
      baseUrl: "https://example.com/one",
      expectedRevision: view.revision,
    });
    assert.notEqual(unknown.statusCode, 200);
    const restored = await c.post("/api/config", {
      action: "gateway/save",
      requestId: randomUUID(),
      targetId: "memory_gateway",
      name: "Restored",
      baseUrl: "https://example.com/one",
      expectedRevision: view.revision,
    });
    assert.equal(restored.statusCode, 200, restored.body);
    assert.equal(
      c.memory.snapshot().values.model_providers.memory_gateway.env_key,
      ref,
    );
    const resumed = await c.post("/api/agent/run", {
      threadId: id,
      requestId: randomUUID(),
      text: "沿用原线程",
    });
    assert.equal(resumed.statusCode, 200, resumed.body);
    assert.equal(resumed.json().threadId, id);
    assert.equal(c.codex.credentialRefs.has(ref),false);
    const injected=await c.codex.privateConfiguration!({threadId:id,modelProvider:"memory_gateway",config:c.memory.snapshot().values});
    assert.equal(injected.config.model_providers.memory_gateway.http_headers.Authorization,"Bearer restore-test-secret");
    assert.ok(!resumed.body.includes("restore-test-secret"));
    assert.equal(
      c.codex.calls.filter((x: any) => x.method === "config/batchWrite").length,
      0,
    );
    c.codex.finish(id);
  }));

test("configuration source failures retain an existing snapshot; cold boot remains available with an explicit unavailable state", async () => {
  let mode = "ok";
  const endpoint = httpServer((_req, res) => {
    if (mode === "redirect") {
      res.writeHead(302, { location: "/other" });
      res.end();
    } else if (mode === "large") res.end("x".repeat(131073));
    else res.end(mode === "ok" ? JSON.stringify(source()) : "invalid");
  });
  await new Promise<void>((resolve) =>
    endpoint.listen(0, "127.0.0.1", resolve),
  );
  const before = process.env.NEWBOT_RUNTIME_CONFIG_URL;
  process.env.NEWBOT_RUNTIME_CONFIG_URL = `http://127.0.0.1:${(endpoint.address() as any).port}/config`;
  const directory = mkdtempSync(join(tmpdir(), "newbot-memory-source-")),
    db = database(directory);
  try {
    assert.equal(
      (await fetchProviderSource()).providers[0].id,
      "memory_gateway",
    );
    const loaded = await initialProviderRuntime(db, directory, directory);
    assert.equal(loaded.sourceStatus, "loaded");
    const saved = loaded.snapshot();
    for (mode of ["invalid", "redirect", "large"])
      await assert.rejects(fetchProviderSource(), /来源/);
    assert.deepEqual(loaded.snapshot(), saved);
    const restored = await initialProviderRuntime(db, directory, directory);
    assert.equal(restored.sourceStatus, "restored");
    assert.deepEqual(restored.snapshot(), saved);
    db.raw.prepare("DELETE FROM provider_configuration").run();
    const unavailable = await initialProviderRuntime(db, directory, directory);
    assert.equal(unavailable.sourceStatus, "unavailable");
    assert.deepEqual(unavailable.snapshot().values.model_providers, {});
    assert.equal(
      db.raw.prepare("SELECT 1 FROM provider_configuration").get(),
      undefined,
    );
    assert.equal(
      codexEnvironment({
        NEWBOT_RUNTIME_CONFIG_TOKEN: "private",
        NEWBOT_RUNTIME_CONFIG_URL: "https://config.example",
      }).NEWBOT_RUNTIME_CONFIG_TOKEN,
      undefined,
    );
  } finally {
    if (before === undefined) delete process.env.NEWBOT_RUNTIME_CONFIG_URL;
    else process.env.NEWBOT_RUNTIME_CONFIG_URL = before;
    endpoint.closeAllConnections();
    await new Promise<void>((resolve) => endpoint.close(() => resolve()));
    db.raw.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
