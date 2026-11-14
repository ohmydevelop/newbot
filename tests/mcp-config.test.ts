import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../server/index.js";
import { configuration } from "../server/configuration.js";
import { mcpManager, mcpSave, publicMcpStatus } from "../server/mcp-config.js";
import { McpConfigCodex } from "./mcp-config-fixture.js";
import { configSecret } from "./config-fixture.js";
async function fixture(fn: (f: any) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "newbot-mcp-config-")),
    codex = new McpConfigCodex(),
    ctx = await createServer({
      providerRuntime: null,
      directory,
      cwd: join(directory, "work"),
      codex,
      password: "mcp-config-test-password",
      origins: ["http://127.0.0.1:3100"],
    }),
    core = configuration(codex, join(directory, "work")),
    manager = mcpManager(codex, core);
  try {
    await fn({
      ...ctx,
      codex,
      core,
      manager,
      revision: async () => (await core.read()).publicView.revision,
    });
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
const save = (revision: string, patch: any = {}, rest: any = {}) => ({
  expectedRevision: revision,
  id: "local",
  create: false,
  transport: "stdio",
  patch: { toolTimeout: 90, ...patch },
  ...rest,
});
test("MCP edits use native CAS leaves and preserve private commands, arguments, environment and headers", async () => {
  await fixture(async ({ manager, codex, revision }: any) => {
    const original = structuredClone(codex.config.mcp_servers),
      token = await revision();
    const result = await manager.save(save(token));
    assert.equal(result.state, "applied");
    assert.deepEqual(codex.config.mcp_servers.local, {
      ...original.local,
      tool_timeout_sec: 90,
    });
    assert.deepEqual(codex.config.mcp_servers.remote, original.remote);
    assert.ok(!JSON.stringify(result.configuration).includes(configSecret));
    const write = codex.calls.find(
      (c: any) => c.method === "config/batchWrite",
    );
    assert.equal(write.params.expectedVersion, "1");
    assert.equal(
      write.params.edits[0].keyPath,
      "mcp_servers.local.tool_timeout_sec",
    );
    await assert.rejects(manager.save(save(token)), { statusCode: 409 });
  });
});
test("MCP create supports stdio/HTTP, strict schemas, safe endpoint syntax and no transport conversion", async () => {
  await fixture(async ({ manager, revision, codex }: any) => {
    await manager.save(
      save(
        await revision(),
        { command: "node", args: ["server.js"], enabled: false },
        { id: "newstdio", create: true },
      ),
    );
    assert.equal(codex.config.mcp_servers.newstdio.command, "node");
    assert.equal(codex.config.mcp_servers.newstdio.enabled, false);
    await manager.save(
      save(
        await revision(),
        { url: "http://127.0.0.1:8000/mcp", bearerEnv: null },
        { id: "newhttp", create: true, transport: "http" },
      ),
    );
    assert.equal(codex.config.mcp_servers.newhttp.startup_timeout_sec, 10);
    assert.ok(
      !Object.hasOwn(codex.config.mcp_servers.newhttp, "bearer_token_env_var"),
    );
    await assert.rejects(
      manager.save(
        save(
          await revision(),
          { url: "https://example.com" },
          { id: "local", transport: "http" },
        ),
      ),
      /不能切换/,
    );
    await assert.rejects(
      manager.save(
        save(
          await revision(),
          { command: "node" },
          { id: "newstdio", create: true },
        ),
      ),
      /已存在/,
    );
    const token = await revision();
    for (const url of [
      "file:///etc/passwd",
      "https://user:password@example.com/mcp",
      "https://example.com/mcp?token=secret",
      "https://example.com/mcp#fragment",
    ])
      assert.equal(
        mcpSave.safeParse(save(token, { url }, { transport: "http" })).success,
        false,
      );
    for (const patch of [
      { env: { KEY: "secret" } },
      { http_headers: { Authorization: "secret" } },
      { bearer_token: "secret" },
      { startupTimeout: 0 },
      { toolTimeout: 601 },
      { command: "node\nother" },
    ])
      assert.equal(mcpSave.safeParse({ ...save(token), patch }).success, false);
    await assert.rejects(
      manager.save(save(token, { url: "http://localhost/mcp" })),
      /传输类型/,
    );
  });
});
test("MCP environment references require explicit authorization and can be removed without clearing private values", async () => {
  await fixture(async ({ manager, revision, codex }: any) => {
    for (const ref of [
      "ADMIN_PASSWORD",
      "HOME",
      "CODEX_HOME",
      "NODE_OPTIONS",
      "UNAPPROVED_MCP_REF",
    ])
      await assert.rejects(
        manager.save(save(await revision(), { envRefs: [ref] })),
        /不能|未授权/,
      );
    await manager.save(
      save(await revision(), {
        envRefs: ["EXISTING_MCP_REF", "EXISTING_MCP_REF"],
      }),
    );
    assert.deepEqual(codex.config.mcp_servers.local.env_vars, [
      "EXISTING_MCP_REF",
    ]);
    await manager.save(save(await revision(), { envRefs: [], args: [] }));
    assert.deepEqual(codex.config.mcp_servers.local.env_vars, []);
    assert.deepEqual(codex.config.mcp_servers.local.args, []);
    assert.equal(codex.config.mcp_servers.local.env.TOKEN, configSecret);
    await manager.save(
      save(
        await revision(),
        { bearerEnv: null },
        { id: "remote", transport: "http" },
      ),
    );
    assert.equal(
      codex.config.mcp_servers.remote.bearer_token_env_var,
      undefined,
    );
    assert.ok(
      codex.config.mcp_servers.remote.http_headers.Authorization.includes(
        configSecret,
      ),
    );
  });
});
test("non-user and overridden MCP definitions are read-only and cannot be edited or deleted", async () => {
  await fixture(async ({ manager, revision, codex, core }: any) => {
    const original = codex.call.bind(codex);
    codex.call = async (m: any, p: any) => {
      const r = await original(m, p);
      if (m === "config/read")
        r.origins["mcp_servers.local.command"] = {
          name: { type: "project", dotCodexFolder: "/project" },
          version: "1",
        };
      return r;
    };
    assert.equal(
      (await core.read()).publicView.mcp.find((m: any) => m.id === "local")
        .editable,
      false,
    );
    await assert.rejects(manager.save(save(await revision())), /来源/);
    await assert.rejects(
      manager.remove({ id: "local", expectedRevision: await revision() }),
      /不能/,
    );
    await assert.rejects(
      manager.enabled({
        id: "local",
        enabled: false,
        expectedRevision: await revision(),
      }),
      /不属于/,
    );
  });
});
test("MCP enable, disable and delete change only their versioned configuration", async () => {
  await fixture(async ({ manager, revision, codex }: any) => {
    const remote = structuredClone(codex.config.mcp_servers.remote);
    await manager.enabled({
      id: "local",
      enabled: false,
      expectedRevision: await revision(),
    });
    assert.equal(codex.config.mcp_servers.local.enabled, false);
    await manager.enabled({
      id: "local",
      enabled: true,
      expectedRevision: await revision(),
    });
    assert.equal(codex.config.mcp_servers.local.enabled, true);
    await manager.remove({ id: "local", expectedRevision: await revision() });
    assert.equal(codex.config.mcp_servers.local, undefined);
    assert.deepEqual(codex.config.mcp_servers.remote, remote);
  });
});
test("MCP public inventory and connection diagnostics strip raw errors, schemas and metadata", async () => {
  await fixture(async ({ service, codex }: any) => {
    const settings = await service.settings();
    const publicJson = JSON.stringify(settings.mcp);
    assert.ok(!publicJson.includes(configSecret));
    assert.equal(
      settings.mcp.find((m: any) => m.name === "local").toolCount,
      1,
    );
    assert.ok(!publicJson.includes("inputSchema"));
    const test = async () =>
      service.handle("mcp/test", {
        id: "local",
        expectedRevision: (await service.settings()).configuration.revision,
      });
    let result = await test();
    assert.equal(result.state, "discovered");
    assert.equal(result.toolCount, 1);
    assert.equal(codex.reloads, 1);
    assert.ok(!JSON.stringify(result).includes(configSecret));
    for (const [state, expected] of [
      ["failed", "failed"],
      ["auth", "authenticationRequired"],
      ["starting", "unconfirmed"],
    ]) {
      codex.states.set("local", state);
      result = await test();
      assert.equal(result.state, expected);
      assert.ok(!JSON.stringify(result).includes(configSecret));
    }
    codex.failStatus = true;
    await assert.rejects(
      service.handle("mcp/test", {
        id: "local",
        expectedRevision: settings.configuration.revision,
      }),
      (e: any) => e.statusCode === 502 && !e.message.includes(configSecret),
    );
    assert.equal(
      codex.calls.some(
        (c: any) =>
          c.method === "mcpServer/tool/call" ||
          c.method === "thread/start" ||
          c.method === "turn/start",
      ),
      false,
    );
  });
});
test("testing disabled MCP does not reload or start discovery, and stale reload tokens fail closed", async () => {
  await fixture(async ({ service, codex }: any) => {
    const settings = await service.settings(),
      before = codex.calls.length;
    const result = await service.handle("mcp/test", {
      id: "remote",
      expectedRevision: settings.configuration.revision,
    });
    assert.equal(result.state, "disabled");
    assert.equal(
      codex.calls
        .slice(before)
        .some(
          (c: any) =>
            c.method === "mcpServerStatus/list" ||
            c.method === "config/mcpServer/reload",
        ),
      false,
    );
    codex.version++;
    await assert.rejects(
      service.handle("mcp/reload", {
        expectedRevision: settings.configuration.revision,
      }),
      { statusCode: 409 },
    );
    assert.equal(codex.reloads, 0);
    await assert.rejects(service.handle("mcp/reload", {}));
  });
});
test("MCP management blocks tasks, approvals and pending OAuth, releasing guards after each error", async () => {
  await fixture(async ({ service, codex }: any) => {
    const settings = await service.settings(),
      input = save(settings.configuration.revision);
    codex.active.add("active");
    await assert.rejects(service.handle("mcp/save", input), /等待/);
    codex.active.clear();
    codex.approvals.set("pending", {
      id: "pending",
      method: "test",
      params: {},
    });
    await assert.rejects(service.handle("mcp/save", input), /等待/);
    codex.approvals.clear();
    const originalCall = codex.call.bind(codex);
    let release!: (value: any) => void, entered!: () => void;
    const entering = new Promise<void>(resolve => { entered = resolve; });
    codex.call = async (method: string, params: any) => {
      if (method !== "mcpServer/oauth/login") return originalCall(method, params);
      entered();
      return new Promise(resolve => { release = resolve; });
    };
    const starting = service.handle("mcp/oauth", { name: "local" });
    await entering;
    codex.emit("event", { method: "mcpServer/oauthLogin/completed", params: { loginId: "old-attempt", success: true } });
    await assert.rejects(service.handle("mcp/save", input), /OAuth/);
    release({ authorizationUrl: "https://oauth.example/authorize", loginId: "current-attempt" });
    await starting;
    await assert.rejects(service.handle("mcp/save", input), /OAuth/);
    codex.emit("event", {
      method: "mcpServer/oauthLogin/completed",
      params: { loginId: "old-attempt", success: true },
    });
    await assert.rejects(service.handle("mcp/save", input), /OAuth/);
    codex.emit("event", {
      method: "mcpServer/oauthLogin/completed",
      params: { loginId: "current-attempt", success: false },
    });
    await service.handle("mcp/save", input);
    assert.equal(service.busy, false);
    assert.equal(codex.reloads, 1);
  });
});
test("MCP reload failure retains saved state, invalidates old App records and recovers through native reconnect", async () => {
  await fixture(async ({ service, codex }: any) => {
    const settings = await service.settings();
    codex.failReload = true;
    await assert.rejects(
      service.handle("mcp/save", save(settings.configuration.revision)),
      /重载未确认/,
    );
    assert.equal(codex.config.mcp_servers.local.tool_timeout_sec, 90);
    assert.equal(codex.state, "offline");
    assert.equal(service.busy, false);
    codex.failReload = false;
    await service.handle("bridge/restart", {});
    await service.handle("mcp/reload", {
      expectedRevision: (await service.settings()).configuration.revision,
    });
    assert.equal(codex.state, "ready");
  });
});
test("lost MCP write responses reload authoritative configuration without a duplicate write", async () => {
  await fixture(async ({ service, codex }: any) => {
    const settings = await service.settings();
    codex.loseResponse = true;
    await assert.rejects(
      service.handle("mcp/save", save(settings.configuration.revision)),
      { statusCode: 409 },
    );
    assert.equal(codex.config.mcp_servers.local.tool_timeout_sec, 90);
    assert.equal(codex.reloads, 1);
    assert.equal(
      codex.calls.filter((c: any) => c.method === "config/batchWrite").length,
      1,
    );
    assert.equal(service.busy, false);
  });
});
test("MCP maintenance rejects new work during a pending mutation, then releases it", async () => {
  await fixture(async ({ service, codex }: any) => {
    const settings = await service.settings();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      gate = new Promise<void>((r) => (release = r)),
      original = codex.call.bind(codex);
    codex.call = async (m: any, p: any) => {
      if (m === "config/batchWrite") {
        enter();
        await gate;
      }
      return original(m, p);
    };
    const saving = service.handle(
      "mcp/save",
      save(settings.configuration.revision),
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
  });
});
test("MCP HTTP routes require login and allowed Origin and return only the redacted effective configuration", async () => {
  await fixture(async ({ app }: any) => {
    const origin = "http://127.0.0.1:3100";
    assert.equal((await app.inject({ url: "/api/config" })).statusCode, 401);
    const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin },
        payload: { password: "mcp-config-test-password" },
      }),
      headers = { origin, cookie: login.headers["set-cookie"].split(";")[0] },
      settings = (await app.inject({ url: "/api/config", headers })).json(),
      payload = {
        action: "mcp/save",
        ...save(settings.configuration.revision),
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
    const response = await app.inject({
      method: "POST",
      url: "/api/config",
      headers,
      payload,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().state, "applied");
    assert.ok(!response.body.includes(configSecret));
    assert.ok(!response.body.includes("/private/"));
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
test("paginated MCP catalogs keep App permissions discoverable and reload invalidates the old App capability", async () => {
  await fixture(async ({ service, codex }: any) => {
    const original = codex.call.bind(codex);
    codex.call = async (m: any, p: any) => {
      if (m !== "mcpServerStatus/list") return original(m, p);
      const result = await original(m, p);
      if (!p.cursor) return { data: [], nextCursor: "next-page" };
      const local = result.data.find((s: any) => s.name === "local");
      local.tools.echo._meta = {
        ui: { resourceUri: "ui://paginated-app", visibility: ["model", "app"] },
      };
      return { data: [local], nextCursor: null };
    };
    const settings = await service.settings();
    assert.equal(
      settings.mcp.find((s: any) => s.name === "local").toolCount,
      1,
    );
    assert.ok(!JSON.stringify(settings.mcp).includes(configSecret));
    await service.apps.refresh("thread-fixture");
    const record = service.apps.open("thread-fixture", {
      type: "mcpToolCall",
      id: "item-fixture",
      status: "completed",
      server: "local",
      tool: "echo",
      arguments: {},
      result: { content: [{ type: "text", text: "synthetic" }] },
    });
    assert.equal(record.uri, "ui://paginated-app");
    assert.ok(record.tools.has("echo"));
    assert.equal(service.apps.records.size, 1);
    await service.handle("mcp/reload", {
      expectedRevision: settings.configuration.revision,
    });
    assert.equal(service.apps.records.size, 0);
  });
});

test("OAuth completion bypasses chat ownership filtering and publishes only safe global feedback", async () => {
  await fixture(async ({ service, codex }: any) => {
    const seen: any[] = [];
    service.events.on('event', (event: any) => seen.push(event));
    for (const threadId of [null, 'internal-discovery-thread']) codex.emit('event', {method:'mcpServer/oauthLogin/completed',params:{name:'local',threadId,loginId:'login-'+threadId,success:false,error:configSecret}});
    const completions=seen.filter(e=>e.name==='newbot.mcp.oauth.completed');
    assert.equal(completions.length,2);
    assert.equal(JSON.stringify(completions).includes(configSecret),false);
  });
});
