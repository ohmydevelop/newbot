import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventType, type Event } from "@ag-ui/core";
import { EventSchema } from "@ag-ui/core/schemas";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { reduceAgentEvent } from "../shared/events.js";
const origin = "http://127.0.0.1:3100";
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "minimal-agent-test-"));
  const codex = new FakeCodex();
  const ctx = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "workspace"),
    password: "test-password-very-long",
    codex,
    origins: [origin],
  });
  await ctx.app.ready();
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password: "test-password-very-long" },
  });
  const cookie = login.headers["set-cookie"]!.toString().split(";")[0];
  const headers = { origin, cookie };
  await ctx.service.settings();
  return {
    ...ctx,
    codex,
    headers,
    async close() {
      await ctx.app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("authentication, origin checks, safe configuration, method boundaries", async () => {
  const ctx = await setup();
  try {
    assert.equal(
      (await ctx.app.inject({ url: "/api/config" })).statusCode,
      401,
    );
    assert.equal(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/agent/action",
          headers: { ...ctx.headers, origin: "https://evil.example" },
          payload: { action: "command/exec" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/agent/action",
          headers: ctx.headers,
          payload: { action: "command/exec" },
        })
      ).statusCode,
      400,
    );
    const config = await ctx.app.inject({
      url: "/api/config",
      headers: ctx.headers,
    });
    assert.equal(config.statusCode, 200);
    assert.ok(!config.body.includes("super-secret"));
    assert.ok(!config.body.includes("HIDDEN_KEY"));
    const foreign = await ctx.app.inject({
      url: "/api/threads/not-owned",
      headers: ctx.headers,
    });
    assert.equal(foreign.statusCode, 400);
    const capabilities = (
      await ctx.app.inject({
        url: "/api/runtime/capabilities",
        headers: ctx.headers,
      })
    ).json();
    assert.equal(capabilities.webTransport, "sse");
    assert.equal(capabilities.capabilities.privateCredentials, true);
    assert.equal(capabilities.capabilities.trustedInput.apiKeyProbe, true);
    assert.equal(capabilities.capabilities.trustedInput.persistence, true);
    assert.equal(capabilities.capabilities.trustedInput.agentRequests, false);
    assert.equal(capabilities.capabilities.trustedInput.sudo, false);
    assert.equal(capabilities.mcp.protocolVersion, null);
  } finally {
    await ctx.close();
  }
});
test("AG-UI text and tool event contracts; one run; snapshot survives disconnect", async () => {
  const ctx = await setup();
  try {
    const events: Event[] = [];
    ctx.service.events.on("event", (e) => {
      EventSchema.parse(e);
      events.push(e);
    });
    const requestId = randomUUID();
    const payload = {
      text: "test",
      model: "fixture-model",
      effort: "medium",
      requestId,
    };
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: ctx.headers,
      payload,
    });
    assert.equal(response.statusCode, 200, response.body);
    const { threadId, turn } = response.json();
    const duplicate = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: ctx.headers,
      payload,
    });
    assert.equal(duplicate.json().turn.id, turn.id);
    assert.equal(
      ctx.codex.calls.filter((c) => c.method === "turn/start").length,
      1,
    );
    await ctx.app.listen({ host: "127.0.0.1", port: 0 });
    const address = ctx.app.server.address() as { port: number };
    const stream = await fetch(
      `http://127.0.0.1:${address.port}/api/agent/events`,
      { headers: ctx.headers },
    );
    assert.equal(
      stream.headers.get("content-type"),
      "text/event-stream; charset=utf-8",
    );
    await stream.body!.cancel();
    assert.ok(ctx.codex.active.has(threadId));
    const itemId = randomUUID();
    ctx.codex.item(threadId, turn.id, {
      id: itemId,
      type: "agentMessage",
      text: "",
    });
    ctx.codex.delta(threadId, turn.id, itemId, "你好");
    ctx.codex.delta(threadId, turn.id, itemId, "，世界");
    ctx.codex.item(
      threadId,
      turn.id,
      { id: itemId, type: "agentMessage", text: "你好，世界" },
      true,
    );
    ctx.codex.item(
      threadId,
      turn.id,
      {
        id: "cmd",
        type: "commandExecution",
        command: "pwd",
        status: "inProgress",
      },
      false,
    );
    ctx.codex.emit("event", {
      method: "item/commandExecution/outputDelta",
      params: { threadId, turnId: turn.id, itemId: "cmd", delta: " chunk" },
    });
    ctx.codex.item(
      threadId,
      turn.id,
      {
        id: "cmd",
        type: "commandExecution",
        command: "pwd",
        status: "completed",
        aggregatedOutput: "/workspace",
      },
      true,
    );
    ctx.codex.finish(threadId);
    assert.ok(events.some((e) => e.type === EventType.TEXT_MESSAGE_START));
    assert.ok(events.some((e) => e.type === EventType.TOOL_CALL_RESULT));
    assert.ok(events.some((e) => e.type === EventType.ACTIVITY_DELTA));
    const altered = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers: ctx.headers,
      payload: { ...payload, text: "different" },
    });
    assert.equal(altered.statusCode, 400);
    const toolEnd = events.findIndex((e) => e.type === EventType.TOOL_CALL_END);
    assert.equal(events[toolEnd + 1].type, EventType.TOOL_CALL_RESULT);
    const snapshot = await ctx.service.read(threadId);
    assert.equal(
      snapshot.turns[0].items.find((i) => i.id === itemId)?.text,
      "你好，世界",
    );
    assert.equal(snapshot.turns[0].status, "completed");
    const canonical = ctx.service.events.threads.get(threadId)!;
    const oldEvent = events.find(
      (e) => e.type === EventType.TEXT_MESSAGE_CONTENT,
    )!;
    assert.equal(
      reduceAgentEvent(canonical, oldEvent).turns[0].items.find(
        (i) => i.id === itemId,
      )?.text,
      "你好，世界",
    );
  } finally {
    await ctx.close();
  }
});
test("pending native approval persists without clients and cannot be replayed", async () => {
  const ctx = await setup();
  try {
    const thread: any = await ctx.service.handle("thread/start", {
      model: "fixture-model",
      provider: "fixture",
    });
    const approval = {
      id: 42,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: thread.id,
        turnId: "turn",
        itemId: "command",
        command: "pwd",
      },
    };
    ctx.codex.approvals.set(42, approval as any);
    ctx.codex.emit("approval", approval);
    assert.equal(
      ((await ctx.service.handle("approval/list", {})) as any[]).length,
      1,
    );
    // Use the real response transport stub; it must consume the pending request exactly once.
    (ctx.codex as any).send = () => {};
    await ctx.service.handle("approval/respond", { id: 42, allow: false });
    assert.equal(ctx.codex.approvals.size, 0);
    await assert.rejects(() =>
      ctx.service.handle("approval/respond", { id: 42, allow: true }),
    );
  } finally {
    await ctx.close();
  }
});
test("MCP App tool grants bind server/tool/arguments, deny bypass and replay", async () => {
  const ctx = await setup();
  try {
    const thread: any = await ctx.service.handle("thread/start", {
      model: "fixture-model",
      provider: "fixture",
    });
    const run: any = await ctx.service.handle("turn/start", {
      threadId: thread.id,
      text: "app",
    });
    ctx.codex.item(
      thread.id,
      run.turn.id,
      {
        id: "app-item",
        type: "mcpToolCall",
        server: "test-server",
        tool: "metrics",
        arguments: {},
        mcpAppUi: { resourceUri: "ui://metrics" },
        status: "completed",
        result: {
          content: [],
          structuredContent: { cpu: 25 },
          _meta: { private: true },
        },
      },
      true,
    );
    const app: any = await ctx.service.handle("app/open", {
      threadId: thread.id,
      itemId: "app-item",
    });
    assert.ok(app.html.includes("connect-src 'none'"));
    await assert.rejects(() =>
      ctx.service.handle("app/call/request", {
        token: app.token,
        tool: "danger",
        arguments: {},
      }),
    );
    const grant: any = await ctx.service.handle("app/call/request", {
      token: app.token,
      tool: "metrics",
      arguments: { range: "1h" },
    });
    await ctx.service.handle("app/call/approve", {
      grant: grant.grant,
      allow: true,
    });
    assert.deepEqual(
      ctx.codex.calls.find((c) => c.method === "mcpServer/tool/call")!.params
        .arguments,
      { range: "1h" },
    );
    await assert.rejects(() =>
      ctx.service.handle("app/call/approve", {
        grant: grant.grant,
        allow: true,
      }),
    );
  } finally {
    await ctx.close();
  }
});
test("attachments reject traversal, unsupported active content and oversized text", async () => {
  const ctx = await setup();
  try {
    const upload = await ctx.app.inject({
      method: "POST",
      url: "/api/attachments?name=notes.md",
      headers: { ...ctx.headers, "content-type": "application/octet-stream" },
      payload: Buffer.from("# Notes"),
    });
    assert.equal(upload.statusCode, 200);
    const id = upload.json().id;
    const file = await ctx.app.inject({
      url: `/api/files/${id}`,
      headers: ctx.headers,
    });
    assert.equal(file.body, "# Notes");
    assert.match(file.headers["content-disposition"]!, /^attachment/);
    const svg = await ctx.app.inject({
      method: "POST",
      url: "/api/attachments?name=bad.svg",
      headers: { ...ctx.headers, "content-type": "application/octet-stream" },
      payload: Buffer.from('<svg onload="alert(1)"/>'),
    });
    assert.equal(svg.statusCode, 400);
    assert.equal(
      (
        await ctx.app.inject({
          url: "/api/files/unknown",
          headers: ctx.headers,
        })
      ).statusCode,
      400,
    );
  } finally {
    await ctx.close();
  }
});

test("MCP HTML uses separate origin and its own CSP, without main-session access", async () => {
  const ctx = await setup();
  try {
    const thread: any = await ctx.service.handle("thread/start", {
      model: "fixture-model",
      provider: "fixture",
    });
    const run: any = await ctx.service.handle("turn/start", {
      threadId: thread.id,
      text: "app",
    });
    ctx.codex.item(
      thread.id,
      run.turn.id,
      {
        id: "sandbox-item",
        type: "mcpToolCall",
        server: "test-server",
        tool: "metrics",
        arguments: {},
        mcpAppUi: { resourceUri: "ui://metrics" },
        status: "completed",
        result: { content: [], structuredContent: { cpu: 25 } },
      },
      true,
    );
    const opened = await ctx.app.inject({
      method: "POST",
      url: "/api/mcp-apps/open",
      headers: ctx.headers,
      payload: { threadId: thread.id, itemId: "sandbox-item" },
    });
    assert.equal(opened.statusCode, 200, opened.body);
    const data = opened.json();
    assert.equal(data.html, undefined);
    const url = new URL(data.url);
    assert.equal(url.origin, "http://localhost:3100");
    const document = await ctx.app.inject({
      url: url.pathname,
      headers: { host: "localhost:3100" },
    });
    assert.equal(document.statusCode, 200);
    assert.match(
      document.headers["content-security-policy"]!,
      /script-src 'unsafe-inline'/,
    );
    assert.match(
      document.headers["content-security-policy"]!,
      /frame-ancestors http:\/\/127\.0\.0\.1:3100/,
    );
    assert.equal(document.headers["x-frame-options"], undefined);
    const main = await ctx.app.inject({ url: "/api/session" });
    assert.match(
      main.headers["content-security-policy"]!,
      /script-src 'self';/,
    );
    const access = await ctx.app.inject({
      url: "/api/config",
      headers: { host: "localhost:3100" },
    });
    assert.equal(access.statusCode, 403);
    const directMain = await ctx.app.inject({
      url: url.pathname,
      headers: { host: "127.0.0.1:3100" },
    });
    assert.equal(directMain.statusCode, 403);
    assert.match(
      document.headers["content-security-policy"]!,
      /sandbox allow-scripts/,
    );
  } finally {
    await ctx.close();
  }
});

test("failed and interrupted runs have valid terminal events and recoverable state", async () => {
  const ctx = await setup();
  try {
    const events: Event[] = [];
    ctx.service.events.on("event", (event) => {
      EventSchema.parse(event);
      events.push(event);
    });
    const thread: any = await ctx.service.handle("thread/start", {
      model: "fixture-model",
      provider: "fixture",
    });
    await ctx.service.handle("turn/start", {
      threadId: thread.id,
      text: "test failure",
    });
    ctx.codex.finish(thread.id, "failed");
    assert.ok(events.some((e) => e.type === EventType.RUN_ERROR));
    assert.equal(
      ctx.service.events.threads.get(thread.id)!.turns.at(-1)!.status,
      "failed",
    );
    const run: any = await ctx.service.handle("turn/start", {
      threadId: thread.id,
      text: "test cancellation",
    });
    await ctx.service.handle("turn/interrupt", {
      threadId: thread.id,
      turnId: run.turn.id,
    });
    const terminal = events.findLast((e) => e.type === EventType.RUN_FINISHED);
    assert.ok(
      terminal &&
        terminal.type === EventType.RUN_FINISHED &&
        terminal.outcome?.type === "cancelled",
    );
    assert.equal(
      ctx.service.events.threads.get(thread.id)!.turns.at(-1)!.status,
      "interrupted",
    );
  } finally {
    await ctx.close();
  }
});

test("polling is authenticated and returns the same AG-UI events with reconnect snapshots", async () => {
  const ctx = await setup();
  try {
    assert.equal(
      (await ctx.app.inject({ url: "/api/agent/events?transport=poll" }))
        .statusCode,
      401,
    );
    const first = (
      await ctx.app.inject({
        url: "/api/agent/events?transport=poll",
        headers: ctx.headers,
      })
    ).json();
    assert.equal(first.reset, true);
    for (const event of first.events) EventSchema.parse(event);
    const thread: any = await ctx.service.handle("thread/start", {
      model: "fixture-model",
      provider: "fixture",
    });
    const run: any = await ctx.service.handle("turn/start", {
      threadId: thread.id,
      text: "poll test",
    });
    const delta = (
      await ctx.app.inject({
        url: `/api/agent/events?transport=poll&cursor=${encodeURIComponent(first.cursor)}`,
        headers: ctx.headers,
      })
    ).json();
    assert.equal(delta.reset, false);
    assert.ok(
      delta.events.some((event: Event) => event.type === EventType.RUN_STARTED),
    );
    for (const event of delta.events) EventSchema.parse(event);
    const reconnect = (
      await ctx.app.inject({
        url: "/api/agent/events?transport=poll&cursor=old-process:0",
        headers: ctx.headers,
      })
    ).json();
    assert.equal(reconnect.reset, true);
    assert.ok(
      reconnect.events.some((e: Event) => e.type === EventType.STATE_SNAPSHOT),
    );
    const quiet = (
      await ctx.app.inject({
        url: `/api/agent/events?transport=poll&cursor=${encodeURIComponent(delta.cursor)}`,
        headers: ctx.headers,
      })
    ).json();
    assert.deepEqual(quiet.events, []);
  } finally {
    await ctx.close();
  }
});

test("HTTPS logins always set Secure cookies when local HTTP is also allowed", async () => {
  const directory = mkdtempSync(join(tmpdir(), "minimal-agent-https-"));
  const ctx = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "workspace"),
    password: "test-password-very-long",
    codex: new FakeCodex(),
    origins: [origin, "https://share.example.com"],
  });
  try {
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "https://share.example.com" },
      payload: { password: "test-password-very-long" },
    });
    assert.equal(login.statusCode, 200);
    const cookie = login.headers["set-cookie"]!.toString();
    assert.match(cookie, /; Secure/);
    assert.match(cookie, /; HttpOnly/);
    assert.match(cookie, /; SameSite=Strict/);
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
