import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { automationSchema } from "../shared/automations.js";

test("direct ingress without plugin: scoped auth, durable dedupe, same conversation, rotation and lifecycle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "direct-event-")),
    origin = "http://localhost:3100",
    codex = new FakeCodex();
  const options = {
    directory: dir,
    cwd: join(dir, "work"),
    origins: [origin],
    password: "direct-event-test",
    codex,
    providerRuntime: null,
    automationTimer: false,
  };
  let ctx = await createServer(options);
  async function login() {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: options.password },
    });
    assert.equal(res.statusCode, 200, res.body);
    return { origin, cookie: String(res.headers["set-cookie"]).split(";")[0] };
  }
  let headers = await login();
  const triggerId = randomUUID(),
    content = automationSchema.parse({
      name: "Direct event",
      prompt: "Summarize the event",
      triggers: [],
      eventTriggers: [
        { id: triggerId, source: "incoming", events: ["build.completed"] },
      ],
      notification: "none",
    });
  let task = await ctx.automations.save({
    id: randomUUID(),
    expectedRevision: 0,
    content,
  });
  async function config(rotate = false) {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/automations/incoming-connection",
      headers,
      payload: { taskId: task.id, triggerId, revision: task.revision, rotate },
    });
    assert.equal(res.statusCode, 200, res.body);
    return res.json();
  }
  const event = {
    specversion: "1.0",
    source: "urn:test:build",
    id: "one",
    type: "build.completed",
    time: new Date().toISOString(),
    data: { status: "success" },
  };
  let connection = await config();
  const send = (body = event, token = connection.token) =>
    ctx.app.inject({
      method: "POST",
      url: new URL(connection.url).pathname,
      headers: {
        authorization: "Bearer " + token,
        "content-type": "application/cloudevents+json",
      },
      payload: JSON.stringify(body),
    });
  try {
    assert.equal((await ctx.subscriptions.catalog()).providers.length, 0);
    await ctx.subscriptions.tick();
    assert(
      ctx.automations.list()[0].enabled,
      "direct task must not be paused for missing plugin account",
    );
    assert.equal((await send(event, "wrong")).statusCode, 401);
    const denied = await ctx.app.inject({
      method: "POST",
      url: "/api/automations/incoming-connection",
      headers: { origin, authorization: "Bearer " + connection.token },
      payload: { taskId: task.id, triggerId, revision: task.revision },
    });
    assert.equal(denied.statusCode, 401);
    assert.equal((await send({ ...event, type: "other" })).statusCode, 422);
    assert.equal(
      (await send({ ...event, data: "invalid" as any })).statusCode,
      400,
    );
    const first = await send();
    assert.equal(first.statusCode, 202, first.body);
    const repeats = await Promise.all(Array.from({ length: 8 }, () => send()));
    assert(
      repeats.every(
        (r) => r.statusCode === 200 && r.json().runId === first.json().runId,
      ),
    );
    assert.equal(ctx.automations.read(task.id).runs.length, 1);
    assert.equal((await send()).json().runId, first.json().runId);
    assert.equal(
      (await send({ ...event, data: { status: "different" } })).statusCode,
      409,
    );
    await ctx.service.settings();
    await ctx.automations.tick();
    const run = ctx.automations.read(task.id).runs[0];
    assert.equal(run.state, "running");
    assert(run.threadId);
    codex.finish(run.threadId);
    await ctx.automations.tick();
    assert.equal((await send({ ...event, id: "two" })).statusCode, 202);
    await ctx.automations.tick();
    const second = ctx.automations.read(task.id).runs[0];
    assert.equal(second.threadId, run.threadId);
    assert.notEqual(second.id, run.id);
    codex.finish(second.threadId!);
    await ctx.automations.tick();
    const oldToken = connection.token;
    connection = await config(true);
    assert.notEqual(connection.token, oldToken);
    assert.equal((await send(event, oldToken)).statusCode, 401);
    assert(
      !JSON.stringify(
        ctx.db.raw
          .prepare("SELECT * FROM automation_incoming_credentials")
          .all(),
      ).includes(connection.token),
    );
    await ctx.app.close();
    ctx = await createServer(options);
    headers = await login();
    assert.equal((await config()).token, connection.token);
    assert.equal((await send()).json().runId, first.json().runId);
    assert.equal(ctx.automations.read(task.id).runs.length, 2);
    task = ctx.automations.control(task.id, task.revision, "pause")!;
    assert.equal((await send({ ...event, id: "paused" })).statusCode, 409);
    task = await ctx.automations.resume(task.id, task.revision);
    assert.equal((await send({ ...event, id: "old-config" })).statusCode, 409);
    connection = await config();
    task = await ctx.automations.save({
      id: task.id,
      expectedRevision: task.revision,
      content: { ...content, prompt: "Updated prompt" },
    });
    assert.equal((await send({ ...event, id: "stale" })).statusCode, 409);
    connection = await config();
    assert.equal((await send({ ...event, id: "updated" })).statusCode, 202);
    ctx.automations.control(task.id, task.revision, "delete");
    assert.equal((await send({ ...event, id: "deleted" })).statusCode, 404);
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
