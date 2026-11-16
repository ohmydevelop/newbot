import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHmac } from "node:crypto";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import {
  automationSchema,
  type AutomationEventTrigger,
} from "../shared/automations.js";
const origin = "http://localhost:3100";
async function fixture(fn: (v: any) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "newbot-events-"));
  let now = Date.parse("2026-11-17T00:00:00Z");
  const codex = new FakeCodex();
  codex.unload = async (id: string) => {
    codex.loaded.delete(id);
  };
  const nativeCall = codex.call.bind(codex);
  codex.call = async (method: any, params: any) => {
    const result: any = await nativeCall(method, params);
    if (method === "thread/resume") result.modelProvider = params.modelProvider;
    return result;
  };
  const ctx = await createServer({
    directory,
    cwd: join(directory, "work"),
    codex,
    providerRuntime: null,
    password: "event-test-password",
    origins: [origin],
    automationClock: () => now,
    automationTimer: false,
  });
  try {
    await ctx.service.settings();
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "event-test-password" },
    });
    const headers = {
      origin,
      cookie: String(login.headers["set-cookie"]).split(";")[0],
    };
    const create = async (
      source: AutomationEventTrigger["source"],
      patch = {},
    ) => {
      const trigger = {
        id: randomUUID(),
        source,
        events: [],
        repository: "",
        actions: [],
        ...patch,
      };
      const task = await ctx.automations.save({
        id: randomUUID(),
        expectedRevision: 0,
        content: automationSchema.parse({
          name: "事件验收",
          prompt: "汇总事件",
          triggers: [],
          eventTriggers: [trigger],
        }),
      });
      const auth = (
        await ctx.app.inject({
          method: "POST",
          url: "/api/automations/event-settings",
          headers,
          payload: {
            taskId: task.id,
            triggerId: trigger.id,
            revision: task.revision,
          },
        })
      ).json();
      assert(auth.secret);
      return { task, trigger, auth };
    };
    const post = async (
      url: string,
      payload: any,
      headers: Record<string, string>,
    ) =>
      ctx.app.inject({
        method: "POST",
        url,
        headers: { "content-type": "application/json", ...headers },
        payload: JSON.stringify(payload),
      });
    await fn({
      ctx,
      codex,
      create,
      post,
      headers,
      now: () => now,
      clock: (v: number) => (now = v),
    });
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
function signed(
  source: string,
  secret: string,
  payload: any,
  now: number,
  id = randomUUID(),
): Record<string, string> {
  const raw = JSON.stringify(payload),
    stamp = String(Math.floor(now / 1000));
  const mac = (
    text: string,
    key: string | Buffer = secret,
    encoding: "hex" | "base64" = "hex",
  ) => createHmac("sha256", key).update(text).digest(encoding);
  if (source === "github")
    return {
      "x-hub-signature-256": "sha256=" + mac(raw),
      "x-github-delivery": id,
      "x-github-event": "issues",
    };
  if (source === "openclaw")
    return { authorization: "Bearer " + secret, "idempotency-key": id };
  if (source === "hermes")
    return {
      "x-webhook-timestamp": stamp,
      "x-webhook-signature-v2": mac(stamp + "." + raw),
    };
  return {
    "webhook-id": id,
    "webhook-timestamp": stamp,
    "webhook-signature":
      "v1," +
      mac(
        id + "." + stamp + "." + raw,
        Buffer.from(secret, "base64"),
        "base64",
      ),
  };
}
for (const source of ["webhook", "github", "hermes", "openclaw"] as const)
  test(`${source}: authenticated raw bytes, durable duplicate receipt, single task thread and independent turns`, () =>
    fixture(async ({ ctx, codex, create, post, now }: any) => {
      const { task, auth } = await create(source);
      const payload = {
        message: "first event",
        ...(source === "openclaw"
          ? {}
          : { repository: { full_name: "example/repo" } }),
        event_type: "issues",
      };
      const headers = signed(source, auth.secret, payload, now());
      const bad = await post(auth.path, payload, {});
      assert.equal(bad.statusCode, 404);
      const responses = await Promise.all([
        post(auth.path, payload, headers),
        post(auth.path, payload, headers),
      ]);
      assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 202]);
      const runId = responses[0].json().runId;
      assert.equal(responses[1].json().runId, runId);
      await ctx.automations.tick();
      const r = ctx.automations.result(runId);
      assert.equal(r.state, "running", JSON.stringify(r));
      codex.finish(r.threadId);
      await ctx.automations.tick();
      const second = { ...payload, message: "second event" };
      const response = await post(
        auth.path,
        second,
        signed(source, auth.secret, second, now()),
      );
      assert.equal(response.statusCode, 202, response.body);
      await ctx.automations.tick();
      const r2 = ctx.automations.result(response.json().runId);
      assert.equal(r2.threadId, r.threadId);
      assert.notEqual(r2.turnId, r.turnId);
      assert.equal(ctx.automations.list()[0].threadId, r.threadId);
      assert.equal(
        ctx.db.raw.prepare("SELECT COUNT(*) n FROM threads").get().n,
        1,
      );
      assert.equal(
        (await post(auth.path, payload, headers)).json().runId,
        runId,
      );
      const list = JSON.stringify(ctx.automations.list());
      assert(!list.includes(auth.secret));
      const run = ctx.db.raw
        .prepare("SELECT snapshot FROM automation_runs WHERE id=?")
        .get(runId);
      assert(!run.snapshot.includes(auth.secret));
    }));
test("signature family and timestamp cannot be swapped; changed duplicate id rejects; queue bound and FIFO; pause fences queued events", () =>
  fixture(async ({ ctx, codex, create, post, now }: any) => {
    const { task, auth } = await create("webhook");
    const payload = { type: "deploy", message: "sample" };
    assert.equal(
      (
        await post(
          auth.path,
          payload,
          signed("hermes", auth.secret, payload, now()),
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await post(
          auth.path,
          payload,
          signed("webhook", auth.secret, payload, now() - 301000),
        )
      ).statusCode,
      404,
    );
    const id = randomUUID();
    const first = await post(
      auth.path,
      payload,
      signed("webhook", auth.secret, payload, now(), id),
    );
    assert.equal(first.statusCode, 202);
    assert.equal(
      (
        await post(
          auth.path,
          { type: "changed" },
          signed("webhook", auth.secret, { type: "changed" }, now(), id),
        )
      ).statusCode,
      409,
    );
    await ctx.automations.tick();
    const running = ctx.automations.result(first.json().runId);
    const ids = [];
    for (let i = 0; i < 31; i++) {
      const p = { type: "deploy", index: i };
      const r = await post(
        auth.path,
        p,
        signed("webhook", auth.secret, p, now()),
      );
      assert.equal(r.statusCode, 202, r.body);
      ids.push(r.json().runId);
    }
    const over = await post(
      auth.path,
      payload,
      signed("webhook", auth.secret, payload, now()),
    );
    assert.equal(over.statusCode, 429);
    const other = await create("webhook");
    const independent = ctx.automations.runNow(other.task.id, 1, randomUUID());
    await ctx.automations.tick();
    assert.equal(ctx.automations.result(ids[0]).state, "queued");
    assert.equal(ctx.automations.result(independent.id).state, "running");
    codex.finish(running.threadId);
    await ctx.automations.tick();
    assert.equal(ctx.automations.result(ids[0]).state, "running");
    assert.equal(ctx.automations.result(ids[1]).state, "queued");
    ctx.automations.control(task.id, 1, "pause");
    assert.equal(ctx.automations.result(ids[1]).state, "cancelled");
    assert.equal(
      (
        await post(
          auth.path,
          payload,
          signed("webhook", auth.secret, payload, now()),
        )
      ).statusCode,
      409,
    );
  }));
test("GitHub filters and ping; key rotation revokes old key; deletion and removed trigger revoke ingress", () =>
  fixture(async ({ ctx, create, post, headers, now }: any) => {
    const { task, trigger, auth } = await create("github", {
      repository: "owner/repo",
      events: ["issues"],
      actions: ["opened"],
    });
    const ignored = {
      repository: { full_name: "other/repo" },
      action: "opened",
    };
    assert.equal(
      (
        await post(
          auth.path,
          ignored,
          signed("github", auth.secret, ignored, now()),
        )
      ).json().ignored,
      true,
    );
    const p = { repository: { full_name: "owner/repo" }, action: "opened" };
    assert.equal(
      (
        await post(auth.path, p, {
          ...signed("github", auth.secret, p, now()),
          "x-github-event": "ping",
        })
      ).json().reason,
      "ping",
    );
    const rotation = await ctx.app.inject({
      method: "POST",
      url: "/api/automations/event-settings",
      headers,
      payload: {
        taskId: task.id,
        triggerId: trigger.id,
        revision: 1,
        rotate: true,
        expectedVersion: auth.version,
      },
    });
    assert.equal(rotation.statusCode, 200);
    const stale = await ctx.app.inject({
      method: "POST",
      url: "/api/automations/event-settings",
      headers,
      payload: {
        taskId: task.id,
        triggerId: trigger.id,
        revision: 1,
        rotate: true,
        expectedVersion: auth.version,
      },
    });
    assert.equal(stale.statusCode, 400);
    assert.equal(
      (await post(auth.path, p, signed("github", auth.secret, p, now())))
        .statusCode,
      404,
    );
    const next = rotation.json();
    assert.equal(
      (await post(auth.path, p, signed("github", next.secret, p, now())))
        .statusCode,
      202,
    );
    const edited = await ctx.automations.save({
      id: task.id,
      expectedRevision: 1,
      content: { ...task, eventTriggers: [{ ...trigger, id: randomUUID() }] },
    });
    assert.equal(
      (await post(auth.path, p, signed("github", next.secret, p, now())))
        .statusCode,
      404,
    );
    ctx.automations.control(task.id, edited.revision, "delete");
    assert.equal(ctx.automations.list().length, 0);
  }));
test("OpenClaw ingress cannot choose a thread, model, permission or outgoing channel", () =>
  fixture(async ({ create, post, now }: any) => {
    const { auth } = await create("openclaw");
    for (const patch of [
      { threadId: "another" },
      { model: "other" },
      { approval: "full" },
      { deliver: true },
      { channel: "slack" },
    ]) {
      const p = { message: "input", ...patch };
      assert.equal(
        (await post(auth.path, p, signed("openclaw", auth.secret, p, now())))
          .statusCode,
        400,
      );
    }
  }));
test("real HTTP accepts signed JSON without cookie and rejects oversized bodies", () =>
  fixture(async ({ ctx, create, now }: any) => {
    const { auth } = await create("hermes");
    await ctx.app.listen({ port: 0, host: "127.0.0.1" });
    const address = ctx.app.server.address();
    assert(address && typeof address !== "string");
    const endpoint = `http://127.0.0.1:${address.port}${auth.path}`,
      payload = { event_type: "test", message: "HTTP" };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...signed("hermes", auth.secret, payload, now()),
      },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 202);
    const big = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "x".repeat(65000) }),
    });
    assert.equal(big.status, 413);
  }));
test("task edits apply mode and expert to the same thread; manual conversation holds its queue; archive pauses", () =>
  fixture(async ({ ctx, codex, create }: any) => {
    const { task } = await create("webhook");
    const first = ctx.automations.runNow(task.id, 1, randomUUID());
    await ctx.automations.tick();
    const r = ctx.automations.result(first.id);
    codex.finish(r.threadId);
    await ctx.automations.tick();
    const expert = await ctx.service.experts.save({
      name: "事件专家",
      description: "测试",
      instructions: "只读测试",
      pluginIds: [],
      skillIds: [],
      connectorIds: [],
    });
    const edited = await ctx.automations.save({
      id: task.id,
      expectedRevision: 1,
      content: {
        ...task,
        mode: "work",
        approval: "review",
        expertId: expert.id,
      },
    });
    codex.active.add(r.threadId);
    const next = ctx.automations.runNow(task.id, edited.revision, randomUUID());
    await ctx.automations.tick();
    assert.equal(ctx.automations.result(next.id).state, "queued");
    codex.active.delete(r.threadId);
    await ctx.automations.tick();
    const second = ctx.automations.result(next.id);
    assert.equal(second.state, "running", JSON.stringify(second));
    assert.equal(second.threadId, r.threadId);
    assert.equal(ctx.service.runtimeSettings.get(r.threadId).mode, "work");
    assert.equal(
      ctx.service.runtimeSettings.get(r.threadId).approval,
      "review",
    );
    assert.equal(ctx.service.experts.session(r.threadId).expertId, expert.id);
    codex.finish(r.threadId);
    await ctx.automations.tick();
    ctx.db.archive(r.threadId);
    ctx.automations.archiveThread(r.threadId);
    const paused = ctx.automations.read(task.id).task;
    assert.equal(paused.enabled, false);
    await ctx.automations.resume(task.id, paused.revision);
    assert.equal(
      ctx.db.raw
        .prepare("SELECT archived FROM threads WHERE id=?")
        .get(r.threadId).archived,
      0,
    );
  }));
