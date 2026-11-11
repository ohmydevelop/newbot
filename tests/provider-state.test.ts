import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { database, DATABASE_VERSION } from "../server/db.js";
import {
  ProviderRuntime,
  providerRuntimeValues,
  providerRuntimeInput,
} from "../server/provider-runtime.js";
import { providerState } from "../server/provider-state.js";
import { initialProviderRuntime } from "../server/provider-source.js";
import { createServer } from "../server/index.js";
import { ConfigCodex } from "./config-fixture.js";
import { ProviderCodex } from "./provider-fixture.js";

const values = () =>
  providerRuntimeValues(
    providerRuntimeInput.parse({
      providers: [
        {
          id: "saved_gateway",
          name: "已保存网关",
          baseUrl: "http://127.0.0.1:1/v1",
          defaultModel: "fixture-model",
        },
      ],
      defaults: {
        provider: "saved_gateway",
        model: "fixture-model",
        effort: "medium",
      },
    }),
  );
const edit = (keyPath: string, value: any) => ({
  keyPath,
  value,
  mergeStrategy: "replace" as const,
});

test("v6 migration preserves existing session, model selection and credential data while adding SQLite Provider state", () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-provider-v6-"));
  let db = database(directory);
  try {
    db.set("password", "existing-hash");
    db.raw.exec("DROP TABLE provider_configuration; PRAGMA user_version=6");
    db.addThread("original", "saved_gateway");
    db.raw
      .prepare(
        "INSERT INTO session_runtime VALUES('original',4,'saved_gateway','fixture-model','medium','ask')",
      )
      .run();
    db.raw
      .prepare("INSERT INTO sessions VALUES('existing-session',9999999999999)")
      .run();
    db.raw.close();
    db = database(directory);
    assert.equal(
      (db.raw.prepare("PRAGMA user_version").get() as any).user_version,
      DATABASE_VERSION,
    );
    assert.equal(db.get("password"), "existing-hash");
    assert.equal(db.provider("original"), "saved_gateway");
    assert.equal(
      (db.raw.prepare("SELECT * FROM session_runtime").get() as any).revision,
      4,
    );
    assert.equal(
      (db.raw.prepare("SELECT * FROM sessions").get() as any).token,
      "existing-session",
    );
    assert.equal(providerState(db).read(), undefined);
    assert.equal(
      (db.raw.prepare("PRAGMA integrity_check").get() as any).integrity_check,
      "ok",
    );
  } finally {
    db.raw.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("SQLite commits precede snapshot publication; failed writes preserve both RAM and leased execution configuration", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-provider-failure-"));
  const db = database(directory);
  try {
    const preserved = values();
    preserved.model_providers.saved_gateway.name = " Legacy gateway ";
    const runtime = await initialProviderRuntime(
      db,
      directory,
      directory,
      new ProviderRuntime(preserved),
    );
    const before = runtime.snapshot(),
      release = runtime.retain();
    db.raw.exec(
      "CREATE TRIGGER reject_provider_update BEFORE UPDATE ON provider_configuration BEGIN SELECT RAISE(ABORT,'PRIVATE_SQL_DIAGNOSTIC'); END;",
    );
    assert.throws(
      () => runtime.apply(before.revision, [edit("model", "another-model")]),
      (e: any) => {
        assert.equal(e.configurationIssue.code, "write_failed");
        assert.equal(e.configurationIssue.persistence, "unchanged");
        assert.ok(!e.message.includes("PRIVATE_SQL_DIAGNOSTIC"));
        return true;
      },
    );
    assert.deepEqual(runtime.snapshot(), before);
    assert.deepEqual(providerState(db).read(), before);
    db.raw.exec("DROP TRIGGER reject_provider_update");
    runtime.apply(before.revision, [edit("model", "another-model")]);
    assert.equal(providerState(db).read()!.values.model, "another-model");
    assert.deepEqual(runtime.snapshot(before.revision), before);
    release();
    assert.throws(() => runtime.snapshot(before.revision), /失效/);
    runtime.apply(runtime.revision, [edit("model_reasoning_effort", null)]);
    assert.deepEqual(
      (await initialProviderRuntime(db, directory, directory)).snapshot(),
      runtime.snapshot(),
    );
  } finally {
    db.raw.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a stale process cannot overwrite a newer durable configuration or publish its rejected snapshot", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-provider-cas-"));
  const db = database(directory);
  try {
    const first = await initialProviderRuntime(
      db,
      directory,
      directory,
      new ProviderRuntime(values()),
    );
    const second = await initialProviderRuntime(db, directory, directory);
    const stale = second.snapshot();
    first.apply(first.revision, [edit("model_reasoning_effort", "high")]);
    assert.throws(
      () => second.apply(second.revision, [edit("model", "stale-model")]),
      (e: any) => e.statusCode === 409,
    );
    assert.deepEqual(second.snapshot(), stale);
    assert.equal(
      providerState(db).read()!.values.model_reasoning_effort,
      "high",
    );
    assert.equal(
      (await initialProviderRuntime(db, directory, directory)).snapshot().values
        .model_reasoning_effort,
      "high",
    );
  } finally {
    db.raw.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("ordinary Provider SQLite state rejects plaintext credentials, arbitrary native settings and credential-bearing URLs", () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-provider-private-"));
  const db = database(directory);
  try {
    for (const patch of [
      { api_key: "PRIVATE_TEST_KEY" },
      { http_headers: { Authorization: "Bearer PRIVATE_TEST_KEY" } },
      { base_url: "https://user:PRIVATE_TEST_KEY@example.com/v1" },
      { env_key: "ADMIN_PASSWORD" },
    ]) {
      const invalid = values();
      Object.assign(invalid.model_providers.saved_gateway, patch);
      assert.throws(
        () =>
          new ProviderRuntime(invalid).persist(
            providerState(db).writer(null),
            true,
          ),
        /不能持久化/,
      );
      assert.equal(providerState(db).read(), undefined);
    }
    const runtime = new ProviderRuntime(values()).persist(
      providerState(db).writer(null),
      true,
    );
    const before = runtime.snapshot();
    assert.throws(
      () =>
        runtime.apply(runtime.revision, [
          edit("model_providers.saved_gateway.auth", {
            token: "PRIVATE_TEST_KEY",
          }),
        ]),
      /不能持久化/,
    );
    assert.deepEqual(runtime.snapshot(), before);
    assert.ok(
      !JSON.stringify(
        db.raw.prepare("SELECT * FROM provider_configuration").all(),
      ).includes("PRIVATE_TEST_KEY"),
    );
  } finally {
    db.raw.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid persisted state fails explicitly without resetting configuration or falling back to native files", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-provider-corrupt-"));
  const db = database(directory);
  try {
    db.raw
      .prepare("INSERT INTO provider_configuration VALUES(1,1,?,?,1)")
      .run(randomUUID(), "INVALID_PRIVATE_CONFIG");
    await assert.rejects(
      initialProviderRuntime(db, directory, directory),
      (e: any) => {
        assert.match(e.message, /原配置未被覆盖/);
        assert.ok(!e.message.includes("INVALID_PRIVATE_CONFIG"));
        return true;
      },
    );
    assert.equal(
      (
        db.raw
          .prepare("SELECT content FROM provider_configuration")
          .get() as any
      ).content,
      "INVALID_PRIVATE_CONFIG",
    );
  } finally {
    db.raw.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("product APIs persist edits, defaults and deletion; restart restores SQLite and write failures remain unchanged", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-provider-restart-")),
    origin = "http://127.0.0.1:3100";
  const open = (seed?: ProviderRuntime) =>
    createServer({
      directory,
      cwd: join(directory, "work"),
      codex: new ProviderCodex(),
      password: "provider-sqlite-test-password",
      origins: [origin],
      ...(seed ? { providerRuntime: seed } : {}),
    });
  let ctx = await open(new ProviderRuntime(values()));
  try {
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "provider-sqlite-test-password" },
    });
    const headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    const config = async () =>
      (await ctx.app.inject({ url: "/api/runtime/config", headers })).json();
    const post = async (url: string, payload: object) => {
      const r = await ctx.app.inject({ method: "POST", url, headers, payload });
      assert.equal(r.statusCode, 200, r.body);
      return r.json();
    };
    await post("/api/config", {
      action: "provider/save",
      id: "saved_gateway",
      create: false,
      patch: { name: "更新后的网关", baseUrl: "http://127.0.0.1:1/updated" },
      expectedRevision: (await config()).configuration.revision,
    });
    await post("/api/config", {
      action: "settings/defaults",
      model: "fixture-model",
      effort: "medium",
      expectedRevision: (await config()).configuration.revision,
    });
    await post("/api/config", {
      action: "provider/save",
      id: "deleted_gateway",
      create: true,
      patch: { name: "临时网关", baseUrl: "http://127.0.0.1:1/deleted" },
      expectedRevision: (await config()).configuration.revision,
    });
    await post("/api/config", {
      action: "provider/delete",
      id: "deleted_gateway",
      expectedRevision: (await config()).configuration.revision,
    });
    const snapshot = ctx.runtime.providerRuntime!.snapshot();
    const password = ctx.db.get("password");
    assert.equal(
      snapshot.values.model_providers.saved_gateway.name,
      "更新后的网关",
    );
    assert.equal(snapshot.values.model_providers.deleted_gateway, undefined);
    const row = providerState(ctx.db).read()!;
    assert.deepEqual(row, snapshot);
    assert.equal((await config()).requiresResupplyAfterRestart, false);
    assert.equal(
      (ctx.runtime as ConfigCodex).calls.filter(
        (c) => c.method === "config/batchWrite",
      ).length,
      0,
    );
    await ctx.app.close();
    ctx = await open(new ProviderRuntime());
    assert.deepEqual(ctx.runtime.providerRuntime!.snapshot(), snapshot);
    assert.equal(ctx.runtime.providerRuntime!.sourceStatus, "restored");
    assert.equal(ctx.db.get("password"), password);
    assert.equal((await config()).storage, "sqlite");
    assert.equal((await config()).configuration.sources.model.type, "sqlite");
    const unchanged = ctx.runtime.providerRuntime!.snapshot();
    ctx.db.raw.exec(
      "CREATE TRIGGER fail_api_write BEFORE UPDATE ON provider_configuration BEGIN SELECT RAISE(ABORT,'failure'); END",
    );
    const reply = await ctx.app.inject({
      method: "POST",
      url: "/api/config",
      headers,
      payload: {
        action: "provider/save",
        id: "saved_gateway",
        create: false,
        patch: { name: "不能保存" },
        expectedRevision: (await config()).configuration.revision,
      },
    });
    assert.equal(reply.statusCode, 502, reply.body);
    assert.equal(reply.json().configurationIssue.persistence, "unchanged");
    assert.deepEqual(ctx.runtime.providerRuntime!.snapshot(), unchanged);
    assert.deepEqual(providerState(ctx.db).read(), unchanged);
    ctx.db.raw.exec("DROP TRIGGER fail_api_write");
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
