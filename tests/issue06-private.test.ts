import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { ProviderRuntime } from "../server/provider-runtime.js";
import { ConfigCodex } from "./config-fixture.js";
import { privateFields } from "../server/private-fields.js";
import type { Json } from "../shared/types.js";
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "newbot-issue06-private-")),
    origin = "http://127.0.0.1:3100";
  const codex = new ConfigCodex();
  codex.config = { model_providers: {}, mcp_servers: {} };
  codex.unload = async (id) => {
    codex.loaded.delete(id);
  };
  const providerRuntime = new ProviderRuntime({
    model_provider: "fixture",
    model: "fixture-model",
    newbot_models: { fixture: ["fixture-model"] },
    model_providers: {
      fixture: {
        name: "Fixture",
        base_url: "http://127.0.0.1:1/v1",
        wire_api: "responses",
        requires_openai_auth: false,
      },
    },
  });
  const c = await createServer({
    directory,
    cwd: join(directory, "work"),
    codex,
    providerRuntime,
    password: "test-private-password",
    origins: [origin],
  });
  const login = await c.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password: "test-private-password" },
  });
  const headers = {
    origin,
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
  };
  const post = (url: string, payload: Json) =>
    c.app.inject({ method: "POST", url, headers, payload });
  const config = async () => (await c.service.settings(false)).configuration!;
  const input = (id: string, values: Json) =>
    c.app.inject({
      method: "POST",
      url: `/api/credentials/${id}/input`,
      headers: { ...headers, "content-type": "application/octet-stream" },
      payload: Buffer.from(JSON.stringify(values)).toString("base64"),
    });
  async function fields(
    scope: string,
    targetId: string,
    fields: Json[],
    values: Json = {},
  ) {
    const cfg = await config(),
      target = (scope === "mcp" ? cfg.mcp : cfg.providers).find(
        (v: Json) => v.id === targetId,
      )!;
    const ticket = await post("/api/credentials/requests", {
      operation: "credential.fields.save",
      requestId: randomUUID(),
      scope,
      targetId,
      expectedRevision: cfg.revisions![`${scope}:${targetId}`],
      expectedFieldsRevision: target.privateFields?.revision || "absent",
      fields,
    });
    assert.equal(ticket.statusCode, 200, ticket.body);
    const result = await input(ticket.json().id, values);
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().state, "succeeded", result.body);
    return result.json();
  }
  async function add(id: string, transport = "http") {
    const cfg = await config();
    const result = await post("/api/config", {
      action: "mcp/save",
      id,
      create: true,
      transport,
      expectedRevision: cfg.revision,
      patch: {
        name: id,
        ...(transport === "http"
          ? { url: "https://mcp.example/mcp" }
          : { command: "node", args: ["test-fixture.mjs"] }),
      },
    });
    assert.equal(result.statusCode, 200, result.body);
  }
  return {
    ...c,
    codex,
    directory,
    headers,
    post,
    config,
    input,
    fields,
    add,
    async close() {
      await c.app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
const marker = "issue06-private-synthetic-NEVER-PUBLIC";
test(
  "field vault injects only selected recipients, encrypts at rest and binds to endpoint",
  { timeout: 20000 },
  async () => {
    const c = await fixture();
    try {
      await c.add("http");
      await c.add("stdio", "stdio");
      await c.fields(
        "provider",
        "fixture",
        [{ kind: "bearer", name: "Authorization" }],
        { "bearer:Authorization": marker },
      );
      await c.fields("mcp", "http", [{ kind: "header", name: "X-Api-Key" }], {
        "header:X-Api-Key": marker,
      });
      await c.fields("mcp", "stdio", [{ kind: "env", name: "SERVICE_TOKEN" }], {
        "env:SERVICE_TOKEN": marker,
      });
      const cfg = (await c.service.configuration.read()).response
        .config as Json;
      const params = await c.privateFields.inject({
        modelProvider: "fixture",
        config: structuredClone(cfg),
      });
      assert.equal(
        params.config.model_providers.fixture.http_headers.Authorization,
        `Bearer ${marker}`,
      );
      assert.equal(
        params.config.mcp_servers.http.http_headers["X-Api-Key"],
        marker,
      );
      assert.equal(params.config.mcp_servers.stdio.env.SERVICE_TOKEN, marker);
      const other = await c.privateFields.inject({
        modelProvider: "different",
        config: structuredClone(cfg),
      });
      assert.equal(
        other.config.model_providers.fixture.http_headers,
        undefined,
      );
      assert.ok(!JSON.stringify(await c.config()).includes(marker));
      for (const table of [
        "private_field_sets",
        "provider_configuration",
        "extension_configuration",
        "audit",
      ])
        assert.ok(
          !JSON.stringify(
            c.db.raw.prepare(`SELECT * FROM ${table}`).all(),
          ).includes(marker),
          table,
        );
      assert.ok(
        !readFileSync(join(c.directory, "minimal-agent.sqlite")).includes(
          Buffer.from(marker),
        ),
      );
      const changed = await c.post("/api/config", {
        action: "mcp/save",
        id: "http",
        create: false,
        transport: "http",
        expectedRevision: (await c.config()).revisions!["mcp:http"],
        patch: { url: "https://different.example/mcp" },
      });
      assert.equal(changed.statusCode, 200, changed.body);
      const invalid = await c.privateFields.inject({
        modelProvider: "fixture",
        config: (await c.service.configuration.read()).response.config,
      });
      assert.equal(invalid.config.mcp_servers.http.enabled, false);
    } finally {
      await c.close();
    }
  },
);
test(
  "chat authorization holds dispatch, isolates run and thread grants, cancels and survives disconnect without replay",
  { timeout: 20000 },
  async () => {
    const c = await fixture();
    try {
      await c.fields("provider", "fixture", [
        { kind: "bearer", name: "Authorization" },
      ]);
      const requestId = randomUUID(),
        payload = {
          requestId,
          text: "test",
          provider: "fixture",
          model: "fixture-model",
        };
      const held = await c.post("/api/agent/run", payload);
      assert.equal(held.statusCode, 200, held.body);
      assert.equal(held.json().state, "awaiting_credentials", held.body);
      let threadId = held.json().threadId;
      assert.equal(
        c.codex.calls.filter((c) => c.method === "turn/start").length,
        0,
      );
      const again = await c.post("/api/agent/run", payload);
      assert.equal(again.json().threadId, threadId);
      const need = held.json().privateInputs[0];
      const ticket = await c.post("/api/credentials/requests", {
        operation: "credential.authorize",
        requestId: randomUUID(),
        runId: requestId,
        scope: need.scope,
        targetId: need.targetId,
        expectedFieldsRevision: need.revision,
        duration: "thread",
      });
      assert.equal(ticket.statusCode, 200, ticket.body);
      assert.equal(
        (
          await c.input(ticket.json().id, { "bearer:Authorization": marker })
        ).json().state,
        "succeeded",
      );
      let status: Json = {};
      for (let i = 0; i < 40; i++) {
        status = (
          await c.app.inject({
            url: `/api/agent/runs/${requestId}`,
            headers: c.headers,
          })
        ).json();
        if (status.turn?.id) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      assert.ok(status.turn?.id, JSON.stringify(status));
      assert.equal(
        c.codex.calls.filter((c) => c.method === "turn/start").length,
        1,
      );
      threadId = status.threadId;
      c.codex.finish(threadId);
      const base = (await c.service.configuration.read()).response
        .config as Json;
      const injected = await c.privateFields.inject({
        threadId,
        modelProvider: "fixture",
        config: base,
      });
      assert.equal(
        injected.config.model_providers.fixture.http_headers.Authorization,
        `Bearer ${marker}`,
      );
      const other = await c.privateFields.inject({
        threadId: "another",
        modelProvider: "fixture",
        config: base,
      });
      assert.equal(
        other.config.model_providers.fixture.http_headers,
        undefined,
      );
      const restarted = privateFields(c.db, c.vault, c.service.configuration);
      assert.equal(restarted.hasThreadGrant(threadId), false);
      await c.app.inject({
        method: "DELETE",
        url: `/api/credentials/threads/${threadId}`,
        headers: c.headers,
      });
      assert.equal(c.privateFields.hasThreadGrant(threadId), false);
      const parallel = await Promise.all(
        [0, 1].map(() =>
          c.post("/api/agent/run", {
            ...payload,
            threadId,
            requestId: randomUUID(),
          }),
        ),
      );
      assert.deepEqual(parallel.map((r) => r.statusCode).sort(), [200, 409]);
      const heldParallel = parallel.find((r) => r.statusCode === 200)!.json();
      assert.equal(heldParallel.state, "awaiting_credentials");
      await c.post(
        `/api/credentials/runs/${heldParallel.requestId}/cancel`,
        {},
      );
      const nextId = randomUUID(),
        next = await c.post("/api/agent/run", {
          ...payload,
          requestId: nextId,
        });
      assert.equal(next.json().state, "awaiting_credentials", next.body);
      await c.post(`/api/credentials/runs/${nextId}/cancel`, {});
      assert.equal(
        (
          await c.app.inject({
            url: `/api/agent/runs/${nextId}`,
            headers: c.headers,
          })
        ).json().state,
        "rejected",
      );
      assert.equal(
        c.codex.calls.filter((c) => c.method === "turn/start").length,
        1,
      );
      assert.ok(
        !JSON.stringify(
          c.db.raw.prepare("SELECT * FROM run_context").all(),
        ).includes(marker),
      );
    } finally {
      await c.close();
    }
  },
);

test(
  "manual reauthorization uses configured recipients without replay; revocation invalidates pending inputs",
  { timeout: 10000 },
  async () => {
    const c = await fixture();
    try {
      await c.fields(
        "provider",
        "fixture",
        [{ kind: "bearer", name: "Authorization" }],
        { "bearer:Authorization": marker },
      );
      const started = await c.post("/api/agent/run", {
        requestId: randomUUID(),
        text: "first",
        provider: "fixture",
        model: "fixture-model",
      });
      assert.equal(started.statusCode, 200, started.body);
      const threadId = started.json().threadId;
      c.codex.finish(threadId);
      const before = c.codex.calls.filter(
        (c) => c.method === "turn/start",
      ).length;
      const open = await c.post(
        `/api/credentials/threads/${threadId}/requests`,
        { scope: "provider", targetId: "fixture" },
      );
      assert.equal(open.statusCode, 200, open.body);
      const needs = open.json();
      const create = () =>
        c.post("/api/credentials/requests", {
          operation: "credential.authorize",
          requestId: randomUUID(),
          runId: needs.requestId,
          scope: "provider",
          targetId: "fixture",
          expectedFieldsRevision: needs.privateInputs[0].revision,
          duration: "thread",
        });
      const ticket = await create();
      assert.equal(ticket.statusCode, 200, ticket.body);
      assert.equal(
        (
          await c.input(ticket.json().id, {
            "bearer:Authorization": marker + "-new",
          })
        ).json().state,
        "succeeded",
      );
      assert.equal(
        c.codex.calls.filter((c) => c.method === "turn/start").length,
        before,
      );
      const cfg = (await c.service.configuration.read()).response.config;
      const injected = await c.privateFields.inject({
        threadId,
        modelProvider: "fixture",
        config: cfg,
      });
      assert.equal(
        injected.config.model_providers.fixture.http_headers.Authorization,
        `Bearer ${marker}-new`,
      );
      const next = await c.post(
        `/api/credentials/threads/${threadId}/requests`,
        { scope: "provider", targetId: "fixture" },
      );
      const pending = await c.post("/api/credentials/requests", {
        operation: "credential.authorize",
        requestId: randomUUID(),
        runId: next.json().requestId,
        scope: "provider",
        targetId: "fixture",
        expectedFieldsRevision: next.json().privateInputs[0].revision,
        duration: "thread",
      });
      await c.app.inject({
        method: "DELETE",
        url: `/api/credentials/threads/${threadId}`,
        headers: c.headers,
      });
      assert.equal(
        (
          await c.input(pending.json().id, { "bearer:Authorization": marker })
        ).json().state,
        "failed",
      );
      assert.equal(c.privateFields.hasThreadGrant(threadId), false);
      const archivedRequest = await c.post(
        `/api/credentials/threads/${threadId}/requests`,
        { scope: "provider", targetId: "fixture" },
      );
      const archivedTicket = await c.post("/api/credentials/requests", {
        operation: "credential.authorize",
        requestId: randomUUID(),
        runId: archivedRequest.json().requestId,
        scope: "provider",
        targetId: "fixture",
        expectedFieldsRevision:
          archivedRequest.json().privateInputs[0].revision,
        duration: "thread",
      });
      const archived = await c.post("/api/agent/action", {
        action: "thread/archive",
        threadId,
      });
      assert.equal(archived.statusCode, 200, archived.body);
      assert.equal(
        (
          await c.input(archivedTicket.json().id, {
            "bearer:Authorization": marker,
          })
        ).json().state,
        "failed",
      );
      assert.equal(c.privateFields.hasThreadGrant(threadId), false);
    } finally {
      await c.close();
    }
  },
);
test(
  "unsafe private field names and stale field revisions are rejected before private input",
  { timeout: 10000 },
  async () => {
    const c = await fixture();
    try {
      await c.add("stdio", "stdio");
      await c.add("http");
      for (const [targetId, field] of [
        ["stdio", { kind: "env", name: "NODE_OPTIONS" }],
        ["http", { kind: "header", name: "Host" }],
        ["http", { kind: "env", name: "TOKEN" }],
      ] as const) {
        const cfg = await c.config(),
          r = await c.post("/api/credentials/requests", {
            operation: "credential.fields.save",
            requestId: randomUUID(),
            scope: "mcp",
            targetId,
            expectedRevision: cfg.revisions![`mcp:${targetId}`],
            expectedFieldsRevision: "absent",
            fields: [field],
          });
        assert.equal(r.json().state, "failed", r.body);
      }
      await c.fields("mcp", "http", [{ kind: "header", name: "X-Token" }], {
        "header:X-Token": marker,
      });
      const cfg = await c.config(),
        stale = await c.post("/api/credentials/requests", {
          operation: "credential.fields.save",
          requestId: randomUUID(),
          scope: "mcp",
          targetId: "http",
          expectedRevision: cfg.revisions!["mcp:http"],
          expectedFieldsRevision: "absent",
          fields: [],
        });
      assert.equal(stale.json().state, "failed", stale.body);
    } finally {
      await c.close();
    }
  },
);
