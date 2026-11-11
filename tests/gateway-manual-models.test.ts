import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer as httpServer } from "node:http";
import { createServer } from "../server/index.js";
import { ConfigCodex } from "./config-fixture.js";

class ManualCodex extends ConfigCodex {
  override async unload(id: string) {
    this.loaded.delete(id);
  }
  override async call(method: any, params: any): Promise<any> {
    const result: any = await super.call(method, params);
    if (method === "thread/start" || method === "thread/resume") {
      result.modelProvider = params.modelProvider || "manual";
      result.model = params.model || "vendor/model-v1";
      result.thread.modelProvider = result.modelProvider;
      this.threads.get(result.thread.id)!.modelProvider = result.modelProvider;
      this.loaded.add(result.thread.id);
    }
    return result;
  }
}
test("manual models survive unavailable discovery, enter execution, and restore from SQLite without native writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-manual-models-"));
  const upstream = httpServer((_, res) => {
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
  const origin = "http://127.0.0.1:3100";
  const make = async () => {
    const codex = new ManualCodex();
    codex.home = join(dir, "codex");
    mkdirSync(codex.home, { recursive: true });
    return createServer({
      directory: dir,
      cwd: join(dir, "work"),
      codex,
      password: "manual-test-login",
      origins: [origin],
    });
  };
  let ctx = await make();
  const login = async () => {
    const r = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "manual-test-login" },
    });
    return {
      origin,
      cookie: r.headers["set-cookie"]!.toString().split(";")[0],
    };
  };
  let headers = await login();
  const action = (payload: object) =>
    ctx.app.inject({
      method: "POST",
      url: ["provider/save", "gateway/save"].includes((payload as any).action)
        ? "/api/config"
        : "/api/agent/action",
      headers,
      payload,
    });
  const config = async () =>
    (await ctx.app.inject({ url: "/api/config", headers })).json()
      .configuration;
  try {
    const before = await config();
    const id = "manual";
    const saved = await action({
      action: "provider/save",
      id,
      create: true,
      expectedRevision: before.revision,
      patch: {
        name: "Manual",
        baseUrl: `http://127.0.0.1:${(upstream.address() as any).port}`,
        customModels: ["vendor/model-v1", "vendor/model-v1", "other-model"],
      },
    });
    assert.equal(saved.statusCode, 200, saved.body);
    const cat = (await action({ action: "gateway/catalog" }))
      .json()
      .find((g: any) => g.id === id);
    assert.ok(cat.error);
    assert.deepEqual(
      cat.models.map((m: any) => m.model),
      ["vendor/model-v1", "other-model"],
    );
    assert.ok(
      cat.models.every(
        (m: any) =>
          m.source === "manual" && m.supportedReasoningEfforts.length === 0,
      ),
    );
    assert.ok(!cat.models.some((m: any) => m.model === "fixture-model"));
    const select = await action({
      action: "gateway/defaults",
      id,
      model: "vendor/model-v1",
      makeDefault: true,
      expectedRevision: (await config()).revision,
      expectedDefaultRevision: cat.defaultRevision,
    });
    assert.equal(select.statusCode, 200, select.body);
    const run = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers,
      payload: { requestId: randomUUID(), text: "test manual model" },
    });
    assert.equal(run.statusCode, 200, run.body);
    const start = (ctx.runtime as ConfigCodex).calls.findLast(
      (c) => c.method === "thread/start",
    )!;
    assert.equal(start.params.model, "vendor/model-v1");
    assert.equal(start.params.config.model_reasoning_effort, undefined);
    assert.equal(
      (ctx.runtime as ConfigCodex).calls.filter(
        (c) => c.method === "config/batchWrite",
      ).length,
      0,
    );
    await ctx.app.close();
    ctx = await make();
    headers = await login();
    assert.deepEqual(
      (await config()).providers.find((p: any) => p.id === id).customModels,
      ["vendor/model-v1", "other-model"],
    );
    assert.equal((await config()).defaults.model, "vendor/model-v1");
    const invalid = await action({
      action: "gateway/save",
      targetId: id,
      requestId: randomUUID(),
      expectedRevision: (await config()).revision,
      name: "Manual",
      customModels: ["bad model"],
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await ctx.app.close();
    upstream.closeAllConnections();
    await new Promise<void>((done) => upstream.close(() => done()));
    rmSync(dir, { recursive: true, force: true });
  }
});
