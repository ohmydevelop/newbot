import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuration } from "../server/configuration.js";
import { ConfigCodex, configSecret } from "./config-fixture.js";
import { createServer } from "../server/index.js";
const validate = async () => {};
const edit = (revision: string, effort = "high") => ({
  expectedRevision: revision,
  model: "fixture-model",
  effort,
});
test("configuration views whitelist non-sensitive metadata, strip endpoint credentials/path/query and hide raw layer contents and native versions", async () => {
  const codex = new ConfigCodex(),
    store = configuration(codex, "/work");
  const a = await store.read(),
    b = await store.read();
  assert.equal(a.publicView.revision, b.publicView.revision);
  assert.match(a.publicView.revision, /^cfg1\.[a-f0-9]{64}$/);
  const view = JSON.stringify(a.publicView);
  assert.ok(!view.includes(configSecret));
  assert.ok(!view.includes("/private"));
  assert.ok(!view.includes("PROVIDER_KEY_REFERENCE"));
  assert.equal(
    a.publicView.providers[0].endpointOrigin,
    "https://api.example.com",
  );
  assert.equal(a.publicView.providers[0].credentials, "inline");
  assert.equal(a.publicView.mcp[0].endpointOrigin, "https://mcp.example.com");
  assert.equal(a.publicView.mcp[1].transport, "stdio");
  assert.equal(a.publicView.mcp[1].hasArguments, true);
  assert.deepEqual(a.target, {
    filePath: "/private/config.toml",
    expectedVersion: "1",
  });
  codex.config.unknown_private_field.credential = "a different private value";
  assert.notEqual(
    (await store.read()).publicView.revision,
    a.publicView.revision,
  );
  assert.notEqual(
    (await configuration(codex, "/work").read()).publicView.revision,
    (await store.read()).publicView.revision,
  );
});
test("defaults edits use only generated native keys with a trusted target/version and preserve unrelated private configuration", async () => {
  const codex = new ConfigCodex(),
    store = configuration(codex, "/work");
  const old = structuredClone(codex.config.model_providers);
  const before = await store.read();
  const result = await store.writeDefaults(
    edit(before.publicView.revision),
    validate,
  );
  assert.equal(result.state, "applied");
  assert.equal(result.configuration.defaults.effort, "high");
  assert.deepEqual(codex.config.model_providers, old);
  const write = codex.calls.find(
    (c) => c.method === "config/batchWrite",
  )!.params;
  assert.deepEqual(write, {
    filePath: "/private/config.toml",
    expectedVersion: "1",
    reloadUserConfig: false,
    edits: [
      { keyPath: "model", value: "fixture-model", mergeStrategy: "replace" },
      {
        keyPath: "model_reasoning_effort",
        value: "high",
        mergeStrategy: "replace",
      },
    ],
  });
  assert.notEqual(result.configuration.revision, before.publicView.revision);
});
test("stale or missing revisions, forbidden fields and concurrent saves cannot silently overwrite configuration", async () => {
  const codex = new ConfigCodex(),
    store = configuration(codex, "/work");
  const snapshot = await store.read();
  await assert.rejects(
    store.writeDefaults({ model: "fixture-model", effort: "high" }, validate),
    { statusCode: 409 },
  );
  await assert.rejects(
    store.writeDefaults(
      { ...edit(snapshot.publicView.revision), filePath: "/etc/private" },
      validate,
    ),
  );
  const results = await Promise.allSettled([
    store.writeDefaults(edit(snapshot.publicView.revision), validate),
    store.writeDefaults(edit(snapshot.publicView.revision, "low"), validate),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(codex.config.model_reasoning_effort, "high");
  await assert.rejects(
    store.writeDefaults(edit(snapshot.publicView.revision, "low"), validate),
    { statusCode: 409 },
  );
  assert.equal(
    codex.calls.filter((c) => c.method === "config/batchWrite").length,
    1,
  );
});
test("native CAS rejects a write racing the final read; changed project layers also invalidate proposals", async () => {
  const codex = new ConfigCodex(),
    store = configuration(codex, "/work");
  let before = await store.read();
  codex.raceWrite = true;
  await assert.rejects(
    store.writeDefaults(edit(before.publicView.revision), validate),
    { statusCode: 409 },
  );
  assert.equal(codex.config.model_reasoning_effort, "medium");
  before = await store.read();
  codex.contextVersion++;
  await assert.rejects(
    store.writeDefaults(edit(before.publicView.revision), validate),
    { statusCode: 409 },
  );
  before = await store.read();
  codex.changeContextAfterWrite = true;
  await assert.rejects(
    store.writeDefaults(edit(before.publicView.revision), validate),
    { statusCode: 409 },
  );
  assert.equal(codex.config.model_reasoning_effort, "high"); // Applied user write is not blindly rolled back over a changed context.
});
test("read-only configuration and overridden writes report real effective state without exposing native diagnostics", async () => {
  const codex = new ConfigCodex(),
    store = configuration(codex, "/work");
  codex.noWritableLayer = true;
  const readOnly = await store.read();
  assert.equal(readOnly.publicView.writable, false);
  await assert.rejects(
    store.writeDefaults(edit(readOnly.publicView.revision), validate),
    { statusCode: 409 },
  );
  codex.noWritableLayer = false;
  codex.overridden = true;
  const before = await store.read();
  const result = await store.writeDefaults(
    edit(before.publicView.revision),
    validate,
  );
  assert.equal(result.state, "overridden");
  assert.equal(result.configuration.defaults.effort, "medium");
  assert.equal(codex.config.model_reasoning_effort, "high");
  assert.equal(result.configuration.sources.model?.type, "project");
  assert.ok(!JSON.stringify(result).includes(configSecret));
});
test("failed or unconfirmed writes preserve server truth, release the lock and require an explicit reload", async () => {
  const codex = new ConfigCodex(),
    store = configuration(codex, "/work");
  let before = await store.read();
  codex.failWrite = true;
  await assert.rejects(
    store.writeDefaults(edit(before.publicView.revision), validate),
    (e: any) => e.statusCode === 502 && !e.message.includes(configSecret),
  );
  assert.equal(store.saving, false);
  assert.equal(codex.config.model_reasoning_effort, "medium");
  codex.failWrite = false;
  codex.loseResponse = true;
  await assert.rejects(
    store.writeDefaults(edit(before.publicView.revision), validate),
    { statusCode: 409 },
  );
  assert.equal(codex.config.model_reasoning_effort, "high");
  before = await store.read();
  codex.failReadAfterWrite = true;
  await assert.rejects(
    store.writeDefaults(edit(before.publicView.revision, "low"), validate),
    { statusCode: 502 },
  );
  assert.equal(store.saving, false);
  codex.failRead = false;
  assert.equal((await store.read()).publicView.defaults.effort, "low");
});
test("versioned defaults API is authenticated, validates current models, blocks busy runtimes and makes saved effort effective for new threads", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-defaults-api-")),
    codex = new ConfigCodex(),
    origin = "http://127.0.0.1:3100";
  const ctx = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "work"),
    codex,
    password: "configuration-test-password",
    origins: [origin],
  });
  try {
    assert.equal(
      (await ctx.app.inject({ url: "/api/config" })).statusCode,
      401,
    );
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "configuration-test-password" },
    });
    const headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    const get = async () =>
      (await ctx.app.inject({ url: "/api/config", headers })).json();
    const post = (payload: any) =>
      ctx.app.inject({
        method: "POST",
        url: "/api/config",
        headers,
        payload: { action: "settings/defaults", ...payload },
      });
    const before = await get();
    assert.ok(!JSON.stringify(before).includes(configSecret));
    assert.equal(
      (
        await post({
          ...edit(before.configuration.revision),
          model: "unknown-model",
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await post({
          ...edit(before.configuration.revision),
          apiKey: configSecret,
        })
      ).statusCode,
      400,
    );
    codex.active.add("busy");
    assert.equal(
      (await post(edit(before.configuration.revision))).statusCode,
      400,
    );
    codex.active.clear();
    const response = await post({
      ...edit(before.configuration.revision),
      model: "second-model",
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().state, "applied");
    assert.equal(
      (await post(edit(before.configuration.revision, "low"))).statusCode,
      409,
    );
    await ctx.service.handle("thread/start", {});
    const call = codex.calls.filter((c) => c.method === "thread/start").at(-1)!;
    assert.equal(call.params.model, "second-model");
    assert.equal(call.params.config.model_reasoning_effort, "high");
    assert.equal(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/config",
          headers: { ...headers, origin: "https://evil.example" },
          payload: {
            action: "settings/defaults",
            ...edit(response.json().configuration.revision),
          },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await ctx.app.inject({
          url: "/api/config",
          headers: { cookie: headers.cookie, host: "localhost:3100" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("pending approvals and in-flight saves block new turns without creating request reservations", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-config-maintenance-")),
    codex = new ConfigCodex(),
    origin = "http://127.0.0.1:3100";
  const ctx = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "work"),
    codex,
    password: "configuration-test-password",
    origins: [origin],
  });
  let release: (() => void) | undefined;
  try {
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "configuration-test-password" },
    });
    const headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    const config = (
      await ctx.app.inject({ url: "/api/config", headers })
    ).json();
    const payload = {
      action: "settings/defaults",
      ...edit(config.configuration.revision),
    };
    codex.approvals.set("waiting", {
      id: "waiting",
      method: "item/commandExecution/requestApproval",
      params: {},
    } as any);
    assert.equal(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/config",
          headers,
          payload,
        })
      ).statusCode,
      400,
    );
    codex.approvals.clear();
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = codex.call.bind(codex);
    codex.call = (async (method: any, params: any) => {
      if (method === "config/batchWrite") {
        enter();
        await gate;
      }
      return original(method, params);
    }) as typeof codex.call;
    const saving = Promise.resolve(
      ctx.app.inject({ method: "POST", url: "/api/config", headers, payload }),
    );
    await entered;
    assert.equal(ctx.service.busy, true);
    const requestId = "12345678-1234-4234-8234-123456789012";
    const run = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers,
      payload: { requestId, text: "must wait" },
    });
    assert.equal(run.statusCode, 503);
    assert.equal(
      ctx.db.raw
        .prepare("SELECT * FROM runs WHERE request_id=?")
        .get(requestId),
      undefined,
    );
    release?.();
    assert.equal((await saving).statusCode, 200);
    assert.equal(ctx.service.busy, false);
  } finally {
    release?.();
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
