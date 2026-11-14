import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuration } from "../server/configuration.js";
import {
  ConfigurationFailure,
  publicConfigurationIssue,
} from "../server/configuration-error.js";
import { configurationIssue } from "../shared/configuration.js";
import { createServer } from "../server/index.js";
import { ConfigCodex, configSecret } from "./config-fixture.js";
import { ProviderCodex } from "./provider-fixture.js";
import { McpConfigCodex } from "./mcp-config-fixture.js";
async function fixture(
  fn: (f: any) => Promise<void>,
  codex: ConfigCodex = new McpConfigCodex(),
) {
  const dir = mkdtempSync(join(tmpdir(), "newbot-recovery-")),
    ctx = await createServer({
    providerRuntime: null,
      directory: dir,
      cwd: join(dir, "work"),
      codex,
      password: "recovery-test-password",
      origins: ["http://127.0.0.1:3100"],
    });
  try {
    await fn({ ...ctx, codex });
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
const edit = (revision: string) => ({
  model: "fixture-model",
  effort: "high",
  expectedRevision: revision,
});
test("configuration failures distinguish conflicts, rejected writes, unconfirmed replies and acknowledged commits", async () => {
  for (const scenario of [
    "conflict",
    "raceWrite",
    "failWrite",
    "loseResponse",
    "failReadAfterWrite",
    "changeContextAfterWrite",
    "readOnly",
  ]) {
    const codex = new ConfigCodex(),
      core = configuration(codex, "/work"),
      before = await core.read();
    if (scenario === "conflict") codex.version++;
    else if (scenario === "readOnly") codex.noWritableLayer = true;
    else (codex as any)[scenario] = true;
    let failure: any;
    try {
      await core.writeDefaults(
        edit(before.publicView.revision),
        async () => {},
      );
    } catch (e) {
      failure = e;
    }
    assert.ok(failure instanceof ConfigurationFailure);
    const issue = publicConfigurationIssue(failure)!;
    assert.ok(
      !JSON.stringify({ message: failure.message, issue }).includes(
        configSecret,
      ),
    );
    if (["conflict", "raceWrite", "readOnly"].includes(scenario))
      assert.ok(["conflict", "write_unconfirmed"].includes(issue.code));
    if (scenario === "failWrite")
      assert.deepEqual(issue, {
        code: "write_failed",
        persistence: "unchanged",
        recovery: "read",
      });
    if (scenario === "loseResponse")
      assert.deepEqual(issue, {
        code: "write_unconfirmed",
        persistence: "unconfirmed",
        recovery: "read",
      });
    if (scenario === "failReadAfterWrite")
      assert.deepEqual(issue, {
        code: "readback_failed",
        persistence: "saved",
        recovery: "reconnect",
      });
    if (scenario === "changeContextAfterWrite")
      assert.deepEqual(issue, {
        code: "conflict",
        persistence: "saved",
        recovery: "read",
      });
    assert.equal(core.saving, false);
  }
});
test("read-only and overridden outcomes have safe, explicit recovery contracts", async () => {
  const codex = new ConfigCodex(),
    core = configuration(codex, "/work");
  codex.noWritableLayer = true;
  const view = await core.read();
  await assert.rejects(
    core.writeDefaults(edit(view.publicView.revision), async () => {}),
    (e: any) => e.configurationIssue.code === "read_only",
  );
  codex.noWritableLayer = false;
  codex.overridden = true;
  const result = await core.writeDefaults(
    edit((await core.read()).publicView.revision),
    async () => {},
  );
  assert.equal(result.state, "overridden");
  assert.deepEqual(result.configurationIssue, {
    code: "overridden",
    persistence: "saved",
    recovery: "read",
  });
  assert.ok(!JSON.stringify(result).includes(configSecret));
});
test("recovery metadata ignores untrusted errors and strips non-contract fields", () => {
  assert.equal(
    publicConfigurationIssue({
      configurationIssue: {
        code: "read_failed",
        persistence: "unconfirmed",
        recovery: "read",
        token: configSecret,
      },
    }),
    null,
  );
  assert.equal(
    configurationIssue({
      code: configSecret,
      persistence: "saved",
      recovery: "read",
    }),
    null,
  );
  const safe = publicConfigurationIssue(
    new ConfigurationFailure("fixed", 502, {
      code: "read_failed",
      persistence: "unconfirmed",
      recovery: "read",
      token: configSecret,
    } as any),
  );
  assert.deepEqual(safe, {
    code: "read_failed",
    persistence: "unconfirmed",
    recovery: "read",
  });
});
test("reading and reconnecting configuration recover the actual snapshot without another native write or turn", async () => {
  await fixture(async ({ service, codex }: any) => {
    const before = await service.settings();
    await service.handle(
      "settings/defaults",
      edit(before.configuration.revision),
    );
    codex.calls.length = 0;
    const read = await service.handle("configuration/recover", {
      mode: "read",
    });
    assert.equal(read.settings.configuration.defaults.effort, "high");
    codex.offline("synthetic offline");
    const recovered = await service.handle("configuration/recover", {
      mode: "reconnect",
    });
    assert.equal(recovered.state, "reconnected");
    assert.equal(recovered.settings.configuration.defaults.effort, "high");
    assert.equal(codex.state, "ready");
    assert.ok(!JSON.stringify(recovered).includes(configSecret));
    assert.equal(
      codex.calls.some((c: any) =>
        [
          "config/batchWrite",
          "thread/start",
          "turn/start",
          "mcpServer/tool/call",
        ].includes(c.method),
      ),
      false,
    );
    assert.equal(service.busy, false);
  });
});
test("recovery respects active tasks, approvals and pending OAuth and never interrupts work", async () => {
  await fixture(async ({ service, codex }: any) => {
    codex.active.add("running");
    await assert.rejects(
      service.handle("configuration/recover", { mode: "reconnect" }),
      (e: any) => e.configurationIssue.code === "busy",
    );
    assert.ok(codex.active.has("running"));
    codex.active.clear();
    codex.approvals.set("pending", { id: "pending", params: {} });
    await assert.rejects(
      service.handle("configuration/recover", { mode: "reconnect" }),
    );
    assert.ok(codex.approvals.has("pending"));
    codex.approvals.clear();
    await service.handle("mcp/oauth", { name: "local" });
    await assert.rejects(
      service.handle("configuration/recover", { mode: "read" }),
    );
    codex.emit("event", {
      method: "mcpServer/oauthLogin/completed",
      params: {},
    });
    await service.handle("configuration/recover", { mode: "read" });
    assert.equal(
      codex.calls.some((c: any) => c.method === "turn/interrupt"),
      false,
    );
  });
});
test("failed readback fences new work and reconnect does not repeat an already committed defaults edit", async () => {
  await fixture(async ({ service, codex }: any) => {
    const before = await service.settings();
    codex.failReadAfterWrite = true;
    await assert.rejects(
      service.handle("settings/defaults", edit(before.configuration.revision)),
      (e: any) => e.configurationIssue.persistence === "saved",
    );
    assert.equal(codex.state, "offline");
    assert.equal(codex.config.model_reasoning_effort, "high");
    codex.failRead = false;
    const writes = codex.calls.filter(
      (c: any) => c.method === "config/batchWrite",
    ).length;
    const recovered = await service.handle("configuration/recover", {
      mode: "reconnect",
    });
    assert.equal(recovered.settings.configuration.defaults.effort, "high");
    assert.equal(
      codex.calls.filter((c: any) => c.method === "config/batchWrite").length,
      writes,
    );
    assert.equal(service.busy, false);
  });
});
test("unconfirmed defaults responses synchronize authoritative defaults without a duplicate mutation", async () => {
  await fixture(async ({ service, codex }: any) => {
    const before = await service.settings();
    codex.loseResponse = true;
    await assert.rejects(
      service.handle("settings/defaults", edit(before.configuration.revision)),
      (e: any) => e.configurationIssue.code === "write_unconfirmed",
    );
    await service.handle("thread/start", {});
    assert.equal(
      codex.calls.findLast((c: any) => c.method === "thread/start").params
        .config.model_reasoning_effort,
      "high",
    );
    assert.equal(
      codex.calls.filter((c: any) => c.method === "config/batchWrite").length,
      1,
    );
  });
});
test("provider and MCP reload failures preserve confirmed saved state and share reconnect recovery", async () => {
  const provider = new ProviderCodex();
  await fixture(async ({ service }: any) => {
    provider.failRestart = true;
    const before = await service.settings();
    await assert.rejects(
      service.handle("provider/save", {
        id: "secondary",
        create: false,
        expectedRevision: before.configuration.revision,
        patch: { name: "Recovered Provider" },
      }),
      (e: any) =>
        e.configurationIssue.code === "reload_failed" &&
        e.configurationIssue.persistence === "saved",
    );
    const writes = provider.calls.filter(
      (c) => c.method === "config/batchWrite",
    ).length;
    const actual = await service.handle("configuration/recover", {
      mode: "reconnect",
    });
    assert.equal(
      actual.settings.configuration.providers.find(
        (p: any) => p.id === "secondary",
      ).name,
      "Recovered Provider",
    );
    assert.equal(
      provider.calls.filter((c) => c.method === "config/batchWrite").length,
      writes,
    );
  }, provider);
  const mcp = new McpConfigCodex();
  await fixture(async ({ service }: any) => {
    mcp.failReload = true;
    const before = await service.settings();
    await assert.rejects(
      service.handle("mcp/enabled", {
        id: "local",
        enabled: false,
        expectedRevision: before.configuration.revision,
      }),
      (e: any) =>
        e.configurationIssue.code === "reload_failed" &&
        e.configurationIssue.persistence === "saved",
    );
    mcp.failReload = false;
    const writes = mcp.calls.filter(
      (c) => c.method === "config/batchWrite",
    ).length;
    const actual = await service.handle("configuration/recover", {
      mode: "reconnect",
    });
    assert.equal(
      actual.settings.configuration.mcp.find((m: any) => m.id === "local")
        .enabled,
      false,
    );
    assert.equal(
      mcp.calls.filter((c) => c.method === "config/batchWrite").length,
      writes,
    );
  }, mcp);
});
test("recovery failures release maintenance and do not overwrite external edits", async () => {
  const codex = new ProviderCodex();
  await fixture(async ({ service }: any) => {
    await service.settings();
    codex.config.external_write = "keep";
    codex.version++;
    codex.failRead = true;
    await assert.rejects(
      service.handle("configuration/recover", { mode: "read" }),
      (e: any) => e.configurationIssue.recovery === "reconnect",
    );
    assert.equal(service.busy, false);
    codex.failRead = false;
    codex.failRestart = true;
    await assert.rejects(
      service.handle("configuration/recover", { mode: "reconnect" }),
      (e: any) => e.configurationIssue.code === "reload_failed",
    );
    assert.equal(codex.state, "offline");
    assert.equal(service.busy, false);
    const actual = await service.handle("configuration/recover", {
      mode: "reconnect",
    });
    assert.ok(actual.settings.configuration);
    assert.equal(codex.config.external_write, "keep");
    assert.equal(
      codex.calls.some((c) => c.method === "config/batchWrite"),
      false,
    );
  }, codex);
});
test("recovery serializes against new work and concurrent recover requests", async () => {
  await fixture(async ({ service, codex }: any) => {
    await service.settings();
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      gate = new Promise<void>((r) => (release = r)),
      original = codex.restart.bind(codex);
    codex.restart = async () => {
      enter();
      await gate;
      await original();
    };
    const recovering = service.handle("configuration/recover", {
      mode: "reconnect",
    });
    await entered;
    try {
      await assert.rejects(
        service.handle("thread/start", {}),
        (e: any) => e.configurationIssue.code === "busy",
      );
      await assert.rejects(
        service.handle("configuration/recover", { mode: "reconnect" }),
      );
    } finally {
      release();
    }
    await recovering;
    assert.equal(service.busy, false);
  });
});
test("recovery API enforces authentication and Origin, rejects arbitrary edits and serializes only safe error metadata", async () => {
  await fixture(async ({ app, codex }: any) => {
    const origin = "http://127.0.0.1:3100";
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/agent/action",
          headers: { origin },
          payload: { action: "configuration/recover", mode: "read" },
        })
      ).statusCode,
      401,
    );
    const login = await app.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin },
        payload: { password: "recovery-test-password" },
      }),
      headers = { origin, cookie: login.headers["set-cookie"].split(";")[0] };
    const post = (payload: any, h = headers) =>
      app.inject({
        method: "POST",
        url: "/api/agent/action",
        headers: h,
        payload: { action: "configuration/recover", ...payload },
      });
    assert.equal(
      (
        await post(
          { mode: "read" },
          { ...headers, origin: "https://evil.example" },
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await post({
          mode: "read",
          edits: [{ keyPath: "model", value: configSecret }],
        })
      ).statusCode,
      400,
    );
    const good = await post({ mode: "read" });
    assert.equal(good.statusCode, 200, good.body);
    assert.ok(!good.body.includes(configSecret));
    codex.failRead = true;
    const failed = await post({ mode: "read" });
    assert.equal(failed.statusCode, 503);
    assert.deepEqual(failed.json().configurationIssue, {
      code: "read_failed",
      persistence: "unconfirmed",
      recovery: "reconnect",
    });
    assert.ok(!failed.body.includes(configSecret));
  });
});
test("post-reload config read failures fence the runtime and retain acknowledged persistence", async () => {
  const provider = new ProviderCodex(),
    restart = provider.restart.bind(provider);
  provider.restart = async () => {
    await restart();
    provider.failRead = true;
  };
  await fixture(async ({ service }: any) => {
    const before = await service.settings();
    await assert.rejects(
      service.handle("provider/save", {
        id: "secondary",
        create: false,
        expectedRevision: before.configuration.revision,
        patch: { name: "Committed" },
      }),
      (e: any) =>
        e.configurationIssue.code === "readback_failed" &&
        e.configurationIssue.persistence === "saved" &&
        e.configurationIssue.recovery === "reconnect",
    );
    assert.equal(provider.state, "offline");
    assert.equal(provider.config.model_providers.secondary.name, "Committed");
    assert.equal(service.busy, false);
  }, provider);
  const mcp = new McpConfigCodex(),
    original = mcp.call.bind(mcp);
  mcp.call = (async (method: any, params: any) => {
    const result = await original(method, params);
    if (method === "config/mcpServer/reload") mcp.failRead = true;
    return result;
  }) as typeof mcp.call;
  await fixture(async ({ service }: any) => {
    const before = await service.settings();
    await assert.rejects(
      service.handle("mcp/enabled", {
        id: "local",
        enabled: false,
        expectedRevision: before.configuration.revision,
      }),
      (e: any) =>
        e.configurationIssue.code === "readback_failed" &&
        e.configurationIssue.persistence === "saved" &&
        e.configurationIssue.recovery === "reconnect",
    );
    assert.equal(mcp.state, "offline");
    assert.equal(mcp.config.mcp_servers.local.enabled, false);
    assert.equal(service.busy, false);
  }, mcp);
});
test("a Provider rollback reports restored state only when the native write and effective config agree", async () => {
  const codex = new ProviderCodex(),
    original = codex.call.bind(codex);
  let failCatalog = true;
  codex.call = (async (method: any, params: any) => {
    if (
      method === "model/list" &&
      codex.config.model_provider === "secondary" &&
      failCatalog
    ) {
      failCatalog = false;
      return { data: [], nextCursor: null };
    }
    const result = await original(method, params);
    if (
      method === "config/batchWrite" &&
      params.edits.some(
        (e: any) => e.keyPath === "model_provider" && e.value === "fixture",
      )
    )
      result.status = "okOverridden";
    return result;
  }) as typeof codex.call;
  await fixture(async ({ service }: any) => {
    const before = await service.settings();
    await assert.rejects(
      service.handle("provider/switch", {
        provider: "secondary",
        expectedRevision: before.configuration.revision,
      }),
      (e: any) => e.configurationIssue.code === "write_unconfirmed",
    );
    assert.equal(codex.config.model_providers.secondary.name, "备用 Provider");
    assert.equal(service.busy, false);
  }, codex);
});
test("OAuth waits from a stopped process do not block recovery, while live OAuth still does", async () => {
  await fixture(async ({ service, codex }: any) => {
    await service.settings();
    await service.handle("mcp/oauth", { name: "local" });
    await assert.rejects(
      service.handle("configuration/recover", { mode: "reconnect" }),
      (e: any) => e.configurationIssue.code === "busy",
    );
    codex.offline("synthetic process loss");
    const actual = await service.handle("configuration/recover", {
      mode: "reconnect",
    });
    assert.equal(actual.state, "reconnected");
    assert.equal(
      codex.calls.some((c: any) => c.method === "mcpServer/tool/call"),
      false,
    );
  });
});
test("App grants from an offline process are invalidated before reconnect and cannot be replayed", async () => {
  await fixture(async ({ service, codex, db }: any) => {
    const original = codex.call.bind(codex);
    codex.call = async (m: any, p: any) => {
      const result = await original(m, p);
      if (m === "mcpServerStatus/list")
        result.data.find((s: any) => s.name === "local").tools.echo._meta = {
          ui: {
            resourceUri: "ui://recovery-app",
            visibility: ["model", "app"],
          },
        };
      return result;
    };
    await service.settings();
    db.addThread("grant-thread", "fixture");
    await service.apps.refresh("grant-thread");
    const record = service.apps.open("grant-thread", {
      type: "mcpToolCall",
      id: "grant-item",
      status: "completed",
      server: "local",
      tool: "echo",
      arguments: {},
      result: { content: [{ type: "text", text: "synthetic" }] },
    });
    const grant = await service.handle("app/call/request", {
      token: record.token,
      tool: "echo",
      arguments: {},
    });
    await assert.rejects(
      service.handle("configuration/recover", { mode: "reconnect" }),
      (e: any) => e.configurationIssue.code === "busy",
    );
    codex.offline("synthetic process loss");
    await service.handle("configuration/recover", { mode: "reconnect" });
    await assert.rejects(
      service.handle("app/call/approve", { grant: grant.grant, allow: true }),
      /失效/,
    );
    assert.equal(
      codex.calls.some((c: any) => c.method === "mcpServer/tool/call"),
      false,
    );
  });
});
