import { configuration } from "../server/configuration.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer as http } from "node:http";
import { createServer } from "../server/index.js";
import { ProviderRuntime } from "../server/provider-runtime.js";
import { ConfigCodex } from "./config-fixture.js";
import { responseJson } from "../web/http.js";

test(
  "saved configuration and defaults do not wait for remote discovery, or touch existing native threads",
  { timeout: 10000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "newbot-issue06-config-"));
    let blocked = false,
      entered!: () => void,
      release!: () => void;
    const arrived = new Promise<void>((r) => (entered = r));
    const hold = new Promise<void>((r) => (release = r));
    const upstream = http(async (_, res) => {
      if (blocked) {
        entered();
        await hold;
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          data: [{ id: "fixture-model" }, { id: "new-model" }],
        }),
      );
    });
    await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
    const codex = new ConfigCodex();
    codex.config = { model_providers: {}, mcp_servers: {} };
    const runtime = new ProviderRuntime({
      model_provider: "sample",
      model: "fixture-model",
      model_providers: {
        sample: {
          name: "Sample",
          base_url: `http://127.0.0.1:${(upstream.address() as any).port}`,
          wire_api: "responses",
        },
      },
    });
    const origin = "http://127.0.0.1:3100";
    const ctx = await createServer({
      directory,
      cwd: join(directory, "work"),
      codex,
      providerRuntime: runtime,
      password: "issue06-test-login",
      origins: [origin],
    }).catch((error) => {
      upstream.close();
      throw error;
    });
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "issue06-test-login" },
    });
    const headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    const get = () =>
      ctx.app.inject({ url: "/api/config?view=saved", headers });
    const action = (payload: object, operation?: string) =>
      ctx.app.inject({
        method: "POST",
        url: "/api/agent/action",
        headers: {
          ...headers,
          ...(operation ? { "x-newbot-operation-id": operation } : {}),
        },
        payload,
      });
    try {
      const initial = (await get()).json().configuration;
      await action({ action: "gateway/catalog" });
      blocked = true;
      const discovery = Promise.resolve(
        action({ action: "gateway/catalog", refresh: true }),
      );
      await Promise.race([
        arrived,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(Error("probe never started")), 2000).unref(),
        ),
      ]);
      const started = Date.now();
      const current = await get();
      assert.equal(current.statusCode, 200, current.body);
      const nativeBefore = codex.calls.length;
      const operation = randomUUID();
      const payload = {
        action: "gateway/defaults",
        id: "sample",
        model: "new-model",
        makeDefault: true,
        expectedRevision: initial.revision,
        expectedDefaultRevision: initial.revisions["gateway-default:sample"],
      };
      const saved = await Promise.race([
        action(payload, operation),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(Error("default save waited for discovery")),
            1000,
          ).unref(),
        ),
      ]);
      assert.equal(saved.statusCode, 200, saved.body);
      assert.equal(saved.json().configuration.defaults.model, "new-model");
      assert.ok(Date.now() - started < 1000);
      assert.deepEqual(
        codex.calls
          .slice(nativeBefore)
          .filter((c) =>
            ["thread/start", "thread/resume", "turn/start"].includes(c.method),
          ),
        [],
      );
      const repeated = await action(payload, operation);
      assert.equal(repeated.statusCode, 200, repeated.body);
      assert.equal(
        repeated.json().configuration.revision,
        saved.json().configuration.revision,
      );
      const receipt = await ctx.app.inject({
        url: `/api/config/operations/${operation}`,
        headers,
      });
      assert.equal(receipt.json().state, "saved");
      assert.equal(
        receipt.json().result.configuration.defaults.model,
        "new-model",
      );
      release();
      await discovery;
      codex.state = "offline";
      assert.equal(
        (await get()).json().configuration.defaults.model,
        "new-model",
      );
    } finally {
      release();
      await ctx.app.close();
      upstream.closeAllConnections();
      await new Promise<void>((r) => upstream.close(() => r()));
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test("HTML and malformed JSON responses never leak parser errors or HTML bodies", async () => {
  await assert.rejects(
    () =>
      responseJson(
        new Response("<!DOCTYPE html>upstream secret", {
          status: 502,
          headers: { "content-type": "text/html" },
        }),
      ),
    /有效数据/,
  );
  await assert.rejects(
    () =>
      responseJson(
        new Response("{broken", {
          headers: { "content-type": "application/json" },
        }),
      ),
    /重新查询/,
  );
  assert.deepEqual(
    await responseJson(
      new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      }),
    ),
    { ok: true },
  );
});

test("object revisions allow unrelated edits but reject a stale edit of the same gateway", async () => {
  const codex = new ConfigCodex();
  codex.config = { model_providers: {}, mcp_servers: {} };
  const runtime = new ProviderRuntime({
    model_providers: {
      alpha: {
        name: "Alpha",
        base_url: "https://alpha.example",
        wire_api: "responses",
      },
      beta: {
        name: "Beta",
        base_url: "https://beta.example",
        wire_api: "responses",
      },
    },
  });
  const core = configuration(codex, "/tmp", runtime);
  const first = await core.read();
  const rename = (id: string, name: string, revision: string) =>
    core.mutate(
      revision,
      async () => ({
        edits: [
          {
            keyPath: `model_providers.${id}.name`,
            value: name,
            mergeStrategy: "replace",
          },
        ],
        effective: (after) =>
          (after.response.config.model_providers as any)[id].name === name,
      }),
      `provider:${id}`,
    );
  await rename("beta", "Other", first.publicView.revisions!["provider:beta"]);
  const saved = await rename(
    "alpha",
    "Changed",
    first.publicView.revisions!["provider:alpha"],
  );
  assert.equal(
    saved.configuration.providers.find((p) => p.id === "alpha")?.name,
    "Changed",
  );
  await assert.rejects(
    () =>
      rename("alpha", "Stale", first.publicView.revisions!["provider:alpha"]),
    /已被其他操作修改/,
  );
});
