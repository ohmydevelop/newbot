import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../../server/index.js";
import { FakeCodex } from "../../tests/fixture.js";
import { mountCopilotRuntime } from "./fastify-runtime.js";
import { HttpAgent } from "@ag-ui/client";

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "newbot-copilot-"));
  const codex = new FakeCodex();
  const origin = "http://localhost:3100";
  const ctx = await createServer({
    directory,
    cwd: directory,
    codex,
    password: "synthetic-lab-password",
    providerRuntime: null,
    origins: [origin],
    webDirectory: join(directory, "no-web"),
  });
  const mounted = mountCopilotRuntime(ctx);
  await ctx.app.listen({ host: "127.0.0.1", port: 0 });
  const address = ctx.app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ password: "synthetic-lab-password" }),
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const headers = { origin, cookie, "content-type": "application/json" };
  const thread = (await ctx.service.handle("thread/start", {})) as {
    id: string;
  };
  const post = (path: string, body: unknown, overrides = {}) =>
    fetch(base + path, {
      method: "POST",
      headers: { ...headers, ...overrides },
      body: JSON.stringify(body),
    });
  return {
    ctx,
    codex,
    mounted,
    threadId: thread.id,
    headers,
    post,
    base,
    close: async () => {
      await ctx.app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
const input = (
  threadId: string,
  runId = randomUUID(),
  text = "synthetic message",
) => ({
  threadId,
  runId,
  state: {},
  context: [],
  tools: [],
  forwardedProps: {},
  messages: [{ id: randomUUID(), role: "user", content: text }],
});
const runPath = "/api/copilot/agent/newbot/run";
const connectPath = "/api/copilot/agent/newbot/connect";
function events(text: string) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)));
}
async function until(condition: () => boolean) {
  for (let i = 0; i < 500; i++) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail("condition timed out");
}
const starts = (codex: FakeCodex) =>
  codex.calls.filter((call) => call.method === "turn/start");

test("Fastify keeps cookie, Origin, body limits and thread ownership around the new runtime", async () => {
  const s = await setup();
  try {
    const body = input(s.threadId);
    assert.equal((await s.post(runPath, body, { cookie: "" })).status, 401);
    assert.equal(
      (await s.post(runPath, body, { origin: "https://invalid.example" }))
        .status,
      403,
    );
    assert.equal((await s.post(runPath, body, { origin: "" })).status, 403);
    assert.equal(
      (await s.post("/api/v1/threads", {}, { cookie: "" })).status,
      401,
    );
    assert.equal(
      (await s.post("/api/v1/threads", {}, { origin: "" })).status,
      403,
    );
    const created = await (await s.post("/api/v1/threads", {})).json();
    assert.equal(s.ctx.agentCommands.owns(created.id), true);
    // Upstream conceals inaccessible thread existence with 404.
    assert.equal((await s.post(runPath, input(randomUUID()))).status, 404);
    assert.equal(
      (
        await s.post(
          runPath,
          input(s.threadId, randomUUID(), "x".repeat(270000)),
        )
      ).status,
      413,
    );
    const unsupported = await s.post(runPath, {
      ...body,
      forwardedProps: { ownerId: "another-bot" },
    });
    assert.ok(
      events(await unsupported.text()).some((e) => e.type === "RUN_ERROR"),
    );
    assert.equal(starts(s.codex).length, 0);
  } finally {
    await s.close();
  }
});

test("native process loss closes the stream with an error instead of an endless spinner", async () => {
  const s = await setup();
  try {
    const response = await s.post(runPath, input(s.threadId));
    s.codex.offline("synthetic process failure");
    const stream = events(await response.text());
    assert.equal(stream.at(-1).type, "RUN_ERROR");
    assert.equal(
      stream.some((event) => event.type === "RUN_FINISHED"),
      false,
    );
    assert.equal(starts(s.codex).length, 1);
    await until(() => s.mounted.activeStreams() === 0);
  } finally {
    await s.close();
  }
});

test("duplicate sends, disconnected clients, reconnect and completed replay dispatch one native turn", async () => {
  const s = await setup();
  try {
    const body = input(s.threadId);
    body.forwardedProps = { __copilotkitRequestId: randomUUID() };
    const [first, second] = await Promise.all([
      s.post(runPath, body),
      s.post(runPath, body),
    ]);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    await until(() => starts(s.codex).length === 1);
    const turnId = s.ctx.agentCommands.receipt(
      s.threadId,
      body.runId,
    )!.turn_id!;
    const itemId = randomUUID();
    s.codex.item(s.threadId, turnId, {
      id: itemId,
      type: "agentMessage",
      text: "",
    });
    s.codex.delta(s.threadId, turnId, itemId, "before reconnect ");
    const reconnect = await s.post(connectPath, body);
    await first.body!.cancel();
    assert.equal(
      s.codex.calls.filter((c) => c.method === "turn/interrupt").length,
      0,
    );
    s.codex.delta(s.threadId, turnId, itemId, "after reconnect");
    s.codex.finish(s.threadId);
    const streamed = events(await second.text());
    assert.equal(streamed.filter((e) => e.type === "RUN_STARTED").length, 1);
    assert.equal(streamed.at(-1).type, "RUN_FINISHED");
    assert.equal(streamed.at(-1).runId, body.runId);
    const resumed = events(await reconnect.text());
    const snapshot = resumed.find((e) => e.type === "MESSAGES_SNAPSHOT");
    assert.equal(
      snapshot.messages.find((m: { id: string }) => m.id === itemId).content,
      "before reconnect ",
    );
    assert.deepEqual(
      resumed
        .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
        .map((e) => e.delta),
      ["after reconnect"],
    );
    const replay = events(await (await s.post(runPath, body)).text());
    assert.equal(replay.at(-1).type, "RUN_FINISHED");
    assert.equal(starts(s.codex).length, 1);
    const changed = events(
      await (
        await s.post(runPath, {
          ...body,
          messages: [
            { id: randomUUID(), role: "user", content: "different payload" },
          ],
        })
      ).text(),
    );
    assert.ok(changed.some((e) => e.type === "RUN_ERROR"));
    assert.equal(starts(s.codex).length, 1);
    await until(() => s.mounted.activeStreams() === 0);
  } finally {
    await s.close();
  }
});

test("old or missing run IDs cannot cancel a new native turn", async () => {
  const s = await setup();
  try {
    const old = input(s.threadId);
    const first = await s.post(runPath, old);
    s.codex.finish(s.threadId);
    await first.text();
    const next = input(s.threadId);
    const second = await s.post(runPath, next);
    const stopPath = `/api/copilot/agent/newbot/stop/${s.threadId}`;
    for (const body of [{}, { runId: old.runId }, { runId: randomUUID() }])
      assert.equal(
        (await (await s.post(stopPath, body)).json()).stopped,
        false,
      );
    assert.equal(
      s.codex.calls.filter((c) => c.method === "turn/interrupt").length,
      0,
    );
    const nextTurn = s.ctx.agentCommands.receipt(
      s.threadId,
      next.runId,
    )!.turn_id;
    assert.equal(
      (await (await s.post(stopPath, { runId: next.runId })).json()).stopped,
      true,
    );
    assert.deepEqual(
      s.codex.calls
        .filter((c) => c.method === "turn/interrupt")
        .map((c) => c.params.turnId),
      [nextTurn],
    );
    assert.equal(events(await second.text()).at(-1).outcome.type, "cancelled");
  } finally {
    await s.close();
  }
});

test("client history is never replayed as execution, and expired login detaches without cancelling", async () => {
  const s = await setup();
  try {
    const body = input(s.threadId);
    body.messages.unshift({
      id: randomUUID(),
      role: "user",
      content: "old input must not execute",
    });
    const response = await s.post(runPath, body);
    const consumed = response.text().catch(() => "closed");
    assert.equal(starts(s.codex).length, 1);
    assert.equal(starts(s.codex)[0].params.input[0].text, "synthetic message");
    s.ctx.db.logout(s.headers.cookie.slice("ma_session=".length));
    await until(() => s.mounted.activeStreams() === 0);
    await consumed;
    assert.equal(
      s.codex.calls.filter((c) => c.method === "turn/interrupt").length,
      0,
    );
    assert.equal(s.codex.active.has(s.threadId), true);
    s.codex.finish(s.threadId);
  } finally {
    await s.close();
  }
});

test("official AG-UI client reconstructs the streamed assistant message", async () => {
  const s = await setup();
  try {
    const client = new HttpAgent({
      url: s.base + runPath,
      headers: { origin: s.headers.origin, cookie: s.headers.cookie },
      threadId: s.threadId,
    });
    const runId = randomUUID();
    client.addMessage({
      id: randomUUID(),
      role: "user",
      content: "client protocol proof",
    });
    const done = client.runAgent({ runId });
    await until(
      () => !!s.ctx.agentCommands.receipt(s.threadId, runId)?.turn_id,
    );
    const turnId = s.ctx.agentCommands.receipt(s.threadId, runId)!.turn_id!;
    const itemId = randomUUID();
    s.codex.item(s.threadId, turnId, {
      id: itemId,
      type: "agentMessage",
      text: "",
    });
    s.codex.delta(s.threadId, turnId, itemId, "first ");
    s.codex.delta(s.threadId, turnId, itemId, "second");
    s.codex.item(
      s.threadId,
      turnId,
      { id: itemId, type: "agentMessage", text: "first second" },
      true,
    );
    s.codex.finish(s.threadId);
    await done;
    assert.equal(
      client.messages.filter((message) => message.role === "user").length,
      1,
    );
    assert.equal(
      client.messages.find((message) => message.id === itemId)?.content,
      "first second",
    );
    const restored = new HttpAgent({
      url: s.base + connectPath,
      headers: { origin: s.headers.origin, cookie: s.headers.cookie },
      threadId: s.threadId,
    });
    await restored.runAgent({ runId });
    assert.equal(
      restored.messages.find((message) => message.id === itemId)?.content,
      "first second",
    );
    assert.equal(starts(s.codex).length, 1);
  } finally {
    await s.close();
  }
});

test("streams and request receipts cannot cross native thread boundaries", async () => {
  const s = await setup();
  try {
    const other = (await s.ctx.service.handle("thread/start", {})) as {
      id: string;
    };
    const one = input(s.threadId),
      two = input(other.id);
    const first = await s.post(runPath, one);
    const second = await s.post(runPath, two);
    const otherTurn = s.ctx.agentCommands.receipt(
      other.id,
      two.runId,
    )!.turn_id!;
    const itemId = randomUUID();
    s.codex.item(other.id, otherTurn, {
      id: itemId,
      type: "agentMessage",
      text: "",
    });
    s.codex.delta(other.id, otherTurn, itemId, "other-thread-only");
    s.codex.finish(s.threadId);
    const firstEvents = await first.text();
    assert.equal(firstEvents.includes("other-thread-only"), false);
    const crossing = await s.post(runPath, input(s.threadId, two.runId));
    assert.ok(
      events(await crossing.text()).some((event) => event.type === "RUN_ERROR"),
    );
    assert.equal(starts(s.codex).length, 2);
    s.codex.finish(other.id);
    assert.ok((await second.text()).includes("other-thread-only"));
  } finally {
    await s.close();
  }
});
