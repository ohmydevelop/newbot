import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer as httpServer } from "node:http";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { ConfigCodex } from "./config-fixture.js";
import type { Method, Params, Result } from "../server/protocol.js";

class DefaultsCodex extends ConfigCodex {
  override async call<M extends Method>(
    method: M,
    params: Params<M>,
  ): Promise<Result<M>> {
    const result = await super.call(method, params);
    if (method === "thread/resume")
      return {
        ...result,
        modelProvider: (params as any).modelProvider,
      } as Result<M>;
    return result;
  }
  override async unload(id: string) {
    this.loaded.delete(id);
  }
}

for (const mode of ["sqlite", "native"] as const)
  test(`${mode}: model defaults cannot inject an unsupported effort, while explicit choices remain validated`, async () => {
    const directory = mkdtempSync(join(tmpdir(), "newbot-model-defaults-"));
    const upstream = httpServer((_, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          data: [{ id: "plain-model" }, { id: "fixture-model" }],
        }),
      );
    });
    await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
    const baseUrl = `http://127.0.0.1:${(upstream.address() as any).port}`;
    const codex = new DefaultsCodex();
    codex.home = join(directory, "codex");
    mkdirSync(codex.home);
    codex.config.model_providers.fixture = {
      name: "Fixture",
      base_url: baseUrl,
      wire_api: "responses",
    };
    const origin = "http://127.0.0.1:3100";
    const ctx = await createServer({
      directory,
      cwd: directory,
      codex,
      password: "fixture-login",
      origins: [origin],
      ...(mode === "native" ? { providerRuntime: null } : {}),
    });
    try {
      const login = await ctx.app.inject({
        method: "POST",
        url: "/api/login",
        headers: { origin },
        payload: { password: "fixture-login" },
      });
      const headers = {
        origin,
        cookie: login.headers["set-cookie"]!.toString().split(";")[0],
      };
      const post = (url: string, payload: object) =>
        ctx.app.inject({ method: "POST", url, headers, payload });
      const action = (payload: object) => post("/api/agent/action", payload);
      const run = (payload: object) =>
        post("/api/agent/run", {
          text: "test",
          requestId: randomUUID(),
          ...payload,
        });
      if (mode === "sqlite") {
        const current = (
          await ctx.app.inject({ url: "/api/runtime/config", headers })
        ).json();
        const published = await post("/api/runtime/config", {
          expectedRevision: current.configuration.revision,
          providers: [
            {
              id: "fixture",
              name: "Fixture",
              baseUrl,
              defaultModel: "fixture-model",
            },
          ],
          defaults: {
            provider: "fixture",
            model: "fixture-model",
            effort: "medium",
          },
        });
        assert.equal(published.statusCode, 200, published.body);
      }
      const old = await run({ model: "fixture-model", effort: "high" });
      assert.equal(old.statusCode, 200, old.body);
      codex.finish(old.json().threadId);

      // Selecting another model without an effort must not inherit the global medium.
      const selected = await run({ model: "plain-model" });
      assert.equal(selected.statusCode, 200, selected.body);
      codex.finish(selected.json().threadId);
      const starts = () =>
        codex.calls.filter((c) => c.method === "thread/start");
      assert.equal(
        starts().at(-1)!.params.config.model_reasoning_effort,
        undefined,
      );
      const catalog = (await action({ action: "gateway/catalog" })).json();
      const config = (
        await ctx.app.inject({ url: "/api/config", headers })
      ).json().configuration;
      const saved = await action({
        action: "gateway/defaults",
        id: "fixture",
        model: "plain-model",
        makeDefault: true,
        expectedRevision: config.revision,
        expectedDefaultRevision: catalog.find((g: any) => g.id === "fixture")
          .defaultRevision,
      });
      assert.equal(saved.statusCode, 200, saved.body);
      assert.ok(!saved.json().configuration.defaults.effort);
      const next = await run({});
      assert.equal(next.statusCode, 200, next.body);
      codex.finish(next.json().threadId);
      assert.equal(starts().at(-1)!.params.model, "plain-model");
      assert.equal(
        starts().at(-1)!.params.config.model_reasoning_effort,
        undefined,
      );

      const count = starts().length;
      const invalid = await run({
        model: "plain-model",
        effort: "invented-value",
      });
      assert.equal(invalid.statusCode, 400, invalid.body);
      assert.equal(starts().length, count);
      const previous = await ctx.app.inject({
        url: `/api/threads/${old.json().threadId}`,
        headers,
      });
      assert.equal(previous.json().runtime.effort, "high");
      assert.equal(previous.json().runtime.model, "fixture-model");
      const changed = await action({
        action: "session/update",
        threadId: old.json().threadId,
        expectedRevision: previous.json().runtime.revision,
        model: "plain-model",
      });
      assert.equal(changed.statusCode, 200, changed.body);
      assert.equal(changed.json().effort, "");
      const explicitInvalid = await action({
        action: "session/update",
        threadId: old.json().threadId,
        expectedRevision: changed.json().revision,
        effort: "invented-value",
      });
      assert.equal(explicitInvalid.statusCode, 400);
      if (mode === "sqlite")
        assert.equal(
          codex.calls.filter((c) => c.method === "config/batchWrite").length,
          0,
        );
    } finally {
      await ctx.app.close();
      upstream.closeAllConnections();
      await new Promise<void>((done) => upstream.close(() => done()));
      rmSync(directory, { recursive: true, force: true });
    }
  });
