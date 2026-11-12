import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  credentialFixture,
  credentialTestSecret,
} from "./credential-fixture.js";
import { testSudo, sudoTestSecret } from "./sudo-fixture.js";
import { ProviderCodex } from "./provider-fixture.js";
const mcpSecret = "D65_MCP_PRIVATE_ONLY_TEST",
  diagnostic = "D65_DIAGNOSTIC_PRIVATE_ONLY_TEST";
const controls = { mode: "success" };
const sudo = testSudo(controls);
const c = await credentialFixture(
  "http://127.0.0.1:3130",
  false,
  (ctx) => {
    (ctx.runtime as ProviderCodex).config.mcp_servers.secure = {
      url: "https://mcp.fixture.invalid/mcp",
      enabled: true,
    };
    ctx.app.get("/api/test/error", async () => {
      throw Object.assign(new Error("连接失败：" + diagnostic), {
        name: diagnostic,
        cause: diagnostic,
        statusCode: 502,
      });
    });
  },
  { sudoIdentity: sudo },
);
const responses: string[] = [],
  events: string[] = [];
c.service.events.on("event", (event) => events.push(JSON.stringify(event)));
const markers = [
  credentialTestSecret,
  mcpSecret,
  sudoTestSecret,
  diagnostic,
  "private-fixture-password",
];
function clean(value: string) {
  for (const marker of markers)
    assert.ok(
      !value.includes(marker),
      "Private marker reached a public channel",
    );
}
async function request(
  url: string,
  payload?: any,
  extra: Record<string, string> = {},
) {
  const response = await c.app.inject({
    url,
    method: payload === undefined ? "GET" : "POST",
    headers: { ...c.headers, ...extra },
    ...(payload === undefined ? {} : { payload }),
  });
  responses.push(response.body);
  return response;
}
async function store(
  scope: "provider" | "mcp",
  value: string,
  retention = "encrypted",
) {
  const settings = await c.service.settings(),
    targetId = scope === "provider" ? "secondary" : "secure";
  const row = (
    scope === "provider"
      ? settings.configuration!.providers
      : settings.configuration!.mcp
  ).find((v: { id: string; managedCredential?: any }) => v.id === targetId)!;
  const created = await request("/api/credentials/requests", {
    requestId: randomUUID(),
    operation: "credential.save",
    scope,
    targetId,
    retention,
    expectedRevision: settings.configuration!.revision,
    expectedVaultVersion: row.managedCredential!.version,
  });
  assert.equal(created.json().state, "waiting");
  const result = await request(
    `/api/credentials/${created.json().id}/input`,
    Buffer.from(value),
    { "content-type": "application/octet-stream" },
  );
  assert.equal(result.json().state, "succeeded");
  return result.json();
}
try {
  for (const mode of ["ok", "reject", "redirect", "error"] as const) {
    c.mode(mode);
    const ticket = await c.request();
    const response = await c.input(ticket.id);
    responses.push(response.body);
    assert.equal(response.json().state, mode === "ok" ? "succeeded" : "failed");
  }
  c.mode("ok");
  await store("provider", credentialTestSecret, "memory");
  await store("provider", credentialTestSecret, "encrypted");
  await store("mcp", mcpSecret);
  c.codex.failRestart = true;
  assert.equal((await store("provider", credentialTestSecret)).applied, false);
  const recover = await request("/api/agent/action", {
    action: "configuration/recover",
    mode: "reconnect",
  });
  assert.equal(recover.statusCode, 200);
  await request("/api/config");
  for (const mode of ["success", "echo", "hang"]) {
    controls.mode = mode;
    const create = await request("/api/credentials/requests", {
      requestId: randomUUID(),
      operation: "sudo.identity",
      expectedPolicy: sudo.capability().policy,
    });
    const result = await request(
      `/api/credentials/${create.json().id}/input`,
      Buffer.from(sudoTestSecret),
      { "content-type": "application/octet-stream" },
    );
    assert.equal(
      result.json().state,
      mode === "success" ? "succeeded" : "failed",
    );
  }
  await request("/api/test/error?private=" + diagnostic, undefined, {
    "x-request-id": diagnostic,
    "x-private": diagnostic,
  });
  const malformed = await request(
    "/api/credentials/requests",
    '{"private":"' + diagnostic + '", invalid}',
    { "content-type": "application/json" },
  );
  assert.equal(malformed.statusCode, 400);
  // Exercise an actual traced product operation with a poisoned native exception.
  const call = c.codex.call.bind(c.codex);
  c.codex.call = (async (method: any, params: any) => {
    if (method === "mcpServer/oauth/login")
      throw Object.assign(new Error("认证失败：" + diagnostic), {
        name: diagnostic,
      });
    return call(method, params);
  }) as any;
  const oauth = await request("/api/agent/action", {
    action: "mcp/oauth",
    name: "test-server",
  });
  assert.equal(oauth.statusCode, 400);
  assert.ok(!oauth.body.includes(diagnostic));
  c.codex.call = call;
  const run = await request("/api/agent/run", {
    requestId: randomUUID(),
    text: "Synthetic safe task",
    provider: "fixture",
    model: "fixture-model",
  });
  assert.equal(run.statusCode, 200);
  const { threadId, turn } = run.json();
  c.codex.item(
    threadId,
    turn.id,
    {
      id: "failed-mcp",
      type: "mcpToolCall",
      server: "secure",
      tool: "check",
      status: "failed",
      arguments: {},
      error: { message: diagnostic },
      result: {
        content: [{ type: "text", text: mcpSecret }],
        structuredContent: { private: credentialTestSecret },
        _meta: { private: sudoTestSecret },
      },
    },
    true,
  );
  c.codex.finish(threadId, "failed");
  await request("/api/agent/events?transport=poll");
  assert.equal((await request(`/api/threads/${threadId}`)).statusCode, 200);
  const settings = await c.service.settings();
  for (const scope of ["provider", "mcp"] as const) {
    const targetId = scope === "provider" ? "secondary" : "secure";
    const current = await c.service.settings();
    const row = (
      scope === "provider"
        ? current.configuration!.providers
        : current.configuration!.mcp
    ).find((v: { id: string; managedCredential?: any }) => v.id === targetId)!;
    const clear = await request("/api/credentials/clear", {
      scope,
      targetId,
      expectedRevision: current.configuration!.revision,
      expectedVaultVersion: row.managedCredential!.version,
      confirm: true,
    });
    assert.equal(clear.json().state, "cleared");
  }
  for (const value of [
    ...responses,
    ...events,
    JSON.stringify(settings),
    JSON.stringify(c.codex.calls),
  ])
    clean(value);
  const tables = c.db.raw
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all() as { name: string }[];
  for (const { name } of tables)
    clean(JSON.stringify(c.db.raw.prepare(`SELECT * FROM "${name}"`).all()));
  for (const name of readdirSync(c.directory).filter((v) =>
    v.startsWith("newbot.sqlite"),
  ))
    clean(readFileSync(join(c.directory, name)).toString("utf8"));
  console.log(
    "D65_RESULT " +
      JSON.stringify({
        apiResponses: responses.length,
        events: events.length,
        tables: tables.length,
        providerReflectionDiscarded: true,
        mcpSaveClear: true,
        sudoFailureDiscarded: true,
        nativeArgumentsClean: true,
        dbClean: true,
        syntheticTurns: 1,
      }),
  );
} finally {
  await c.close();
}
