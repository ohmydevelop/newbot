import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { EventSchema } from "@ag-ui/core/schemas";
import { createServer } from "../server/index.js";
import { A2uiFixtureCodex, formMessages } from "./a2ui-fixture.js";
import type { A2uiView } from "../shared/a2ui-chat.js";
import type { Thread } from "../shared/types.js";

const origin = "http://127.0.0.1:3124";
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "newbot-a2ui-agent-")),
    codex = new A2uiFixtureCodex();
  const ctx = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "workspace"),
    codex,
    password: "a2ui-fixture-password",
    origins: [origin],
  });
  await ctx.app.ready();
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password: "a2ui-fixture-password" },
  });
  const headers = {
    origin,
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
  };
  const run = await ctx.app.inject({
    method: "POST",
    url: "/api/agent/run",
    headers,
    payload: { requestId: randomUUID(), text: "显示表单" },
  });
  assert.equal(run.statusCode, 200);
  const { threadId, turn } = run.json();
  const show = (waitForAction = true, messages = formMessages()) =>
    codex.tool(threadId, turn.id, { messages, waitForAction });
  const view = () =>
    ctx.service.events.threads
      .get(threadId)!
      .turns.flatMap((turn) => turn.items)
      .find((item) => item.a2ui)?.a2ui as A2uiView;
  const post = (payload: unknown, customHeaders = headers) =>
    ctx.app.inject({
      method: "POST",
      url: "/api/a2ui/action",
      headers: { ...customHeaders, "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
  const body = (v = view()) => ({
    id: v.id,
    threadId: v.threadId,
    turnId: v.turnId,
    itemId: v.itemId,
    surfaceId: v.surfaceId,
    revision: v.revision,
    token: v.token,
    requestId: randomUUID(),
    sourceComponentId: "submit",
    values: {
      name: "User value",
      server: ["host-b"],
      metrics: ["cpu", "memory"],
      notes: "ordinary information",
    },
  });
  return {
    ...ctx,
    directory,
    codex,
    headers,
    threadId,
    turnId: turn.id,
    show,
    view,
    post,
    body,
    async close() {
      await ctx.app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("native thread registers generated dynamic tool contract and waits without a second model turn", async () => {
  const ctx = await setup();
  try {
    const events: unknown[] = [];
    ctx.service.events.on("event", (event) => {
      EventSchema.parse(event);
      events.push(event);
    });
    const request = ctx.show();
    const start = ctx.codex.calls.find(
      (call) => call.method === "thread/start",
    )!;
    assert.equal(start.params.dynamicTools[0].name, "newbot_ui");
    const v = ctx.view();
    assert.equal(v.state, "waiting");
    assert.equal(v.itemId, request.params.callId);
    assert.equal(v.threadId, ctx.threadId);
    assert.equal(v.turnId, ctx.turnId);
    assert.ok(v.token);
    assert.equal(ctx.codex.toolResponses.length, 0);
    assert.equal(ctx.service.ui.pending, 1);
    assert.ok(events.length);
    assert.equal(
      ctx.codex.calls.filter((call) => call.method === "turn/start").length,
      1,
    );
    const history = (
      await ctx.app.inject({
        url: `/api/threads/${ctx.threadId}`,
        headers: ctx.headers,
      })
    ).json() as Thread;
    assert.equal(
      history.turns[0].items.find((item) => item.a2ui)?.a2ui?.id,
      v.id,
    );
  } finally {
    await ctx.close();
  }
});
test("model updates remain attached to the original native message and stream as AG-UI snapshots", async () => {
  const ctx = await setup();
  try {
    const first = ctx.show(false);
    assert.equal(ctx.codex.toolResponses[0].response.success, true);
    const before = ctx.view();
    ctx.show(true, [
      {
        version: "v0.9",
        updateDataModel: {
          surfaceId: "monitor-demo",
          path: "/status",
          value: "incrementally updated",
        },
      },
    ]);
    const after = ctx.view();
    assert.equal(after.id, before.id);
    assert.equal(after.itemId, first.params.callId);
    assert.ok(after.revision > before.revision);
    assert.equal(after.state, "waiting");
    assert.match(JSON.stringify(after.messages), /incrementally updated/);
    assert.equal(
      ctx.service.events.threads
        .get(ctx.threadId)!
        .turns[0].items.filter((item) => item.a2uiUpdate).length,
      1,
    );
  } finally {
    await ctx.close();
  }
});
test("bad model UI is rejected to the native tool without browser rendering or exposing rejected values", async () => {
  const ctx = await setup();
  try {
    const events: unknown[] = [];
    ctx.service.events.on("event", (event) => events.push(event));
    for (const messages of [
      [
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "bad",
            catalogId: "https://secret.example",
          },
        },
      ],
      [
        ...formMessages().slice(0, 2),
        {
          version: "v0.9",
          updateComponents: {
            surfaceId: "monitor-demo",
            components: [
              {
                id: "root",
                component: "Text",
                text: "secret-marker",
                onClick: "evil()",
              },
            ],
          },
        },
      ],
      [
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "monitor-demo",
            catalogId: "newbot:ui/v1",
          },
        },
      ],
    ])
      ctx.show(true, messages);
    assert.equal(ctx.service.ui.pending, 0);
    assert.equal(ctx.view(), undefined);
    assert.ok(!JSON.stringify(events).includes("secret-marker"));
    assert.equal(ctx.codex.toolResponses.length, 3);
    assert.ok(ctx.codex.toolResponses.every((r) => !r.response.success));
    assert.ok(
      !JSON.stringify(ctx.codex.toolResponses.map((r) => r.response)).includes(
        "secret-marker",
      ),
    );
  } finally {
    await ctx.close();
  }
});
test("invalid client fields and forged context fail before consuming a pending native request", async () => {
  const ctx = await setup();
  try {
    ctx.show();
    const original = ctx.body();
    for (const payload of [
      { ...original, context: { command: "forged" } },
      { ...original, values: { ...original.values, extra: "not-a-field" } },
      { ...original, values: { ...original.values, server: ["missing"] } },
      { ...original, values: { ...original.values, name: 42 } },
      { ...original, values: {} },
      { ...original, sourceComponentId: "name" },
    ])
      assert.equal((await ctx.post(payload)).statusCode, 400);
    assert.equal(ctx.service.ui.pending, 1);
    assert.equal(ctx.codex.toolResponses.length, 0);
    assert.equal((await ctx.post(original)).statusCode, 200);
    const response = JSON.parse(
      (ctx.codex.toolResponses[0].response.contentItems[0] as { text: string })
        .text,
    );
    assert.equal(response.version, "v0.9");
    assert.equal(response.action.name, "submit");
    assert.deepEqual(response.action.context, {
      name: "User value",
      server: ["host-b"],
      metrics: ["cpu", "memory"],
      notes: "ordinary information",
    });
    assert.ok(Number.isFinite(Date.parse(response.action.timestamp)));
    assert.equal(
      ctx.codex.calls.filter((call) => call.method === "turn/start").length,
      1,
    );
    assert.equal(ctx.view().state, "submitted");
    assert.equal(ctx.view().token, undefined);
  } finally {
    await ctx.close();
  }
});
test("authentication, Origin, scope, revision and token are checked for every form action", async () => {
  const ctx = await setup();
  try {
    ctx.show();
    const body = ctx.body();
    assert.equal(
      (await ctx.post(body, { origin, cookie: "" })).statusCode,
      401,
    );
    assert.equal(
      (await ctx.post(body, { ...ctx.headers, origin: "https://evil.example" }))
        .statusCode,
      403,
    );
    for (const property of [
      "threadId",
      "turnId",
      "itemId",
      "surfaceId",
    ] as const)
      assert.equal(
        (await ctx.post({ ...body, [property]: "other" })).statusCode,
        403,
      );
    assert.equal(
      (await ctx.post({ ...body, revision: body.revision + 1 })).statusCode,
      409,
    );
    assert.equal(
      (await ctx.post({ ...body, token: randomUUID() })).statusCode,
      409,
    );
    assert.equal(ctx.codex.toolResponses.length, 0);
    assert.equal(
      (
        await ctx.app.inject({
          url: `/api/a2ui/${body.id}`,
          headers: ctx.headers,
        })
      ).statusCode,
      200,
    );
  } finally {
    await ctx.close();
  }
});
test("concurrent submission and exact retries return at most one native tool response", async () => {
  const ctx = await setup();
  try {
    ctx.show();
    const body = ctx.body();
    const results = await Promise.all([ctx.post(body), ctx.post(body)]);
    assert.ok(results.some((r) => r.statusCode === 200));
    assert.equal(ctx.codex.toolResponses.length, 1);
    assert.equal((await ctx.post(body)).statusCode, 200);
    assert.equal(
      (await ctx.post({ ...body, requestId: randomUUID() })).statusCode,
      409,
    );
    assert.equal(
      (
        await ctx.post({
          ...body,
          values: { ...body.values, name: "different" },
        })
      ).statusCode,
      409,
    );
    assert.equal(ctx.codex.toolResponses.length, 1);
  } finally {
    await ctx.close();
  }
});
test("host cancellation returns an ordinary cancel event with no user-provided context", async () => {
  const ctx = await setup();
  try {
    ctx.show();
    const body = { ...ctx.body(), sourceComponentId: "$cancel" };
    assert.equal((await ctx.post(body)).statusCode, 400);
    assert.equal((await ctx.post({ ...body, values: {} })).statusCode, 200);
    const response = JSON.parse(
      (ctx.codex.toolResponses[0].response.contentItems[0] as { text: string })
        .text,
    );
    assert.equal(response.version, "v0.9");
    assert.equal(response.action.name, "cancel");
    assert.equal(response.action.sourceComponentId, "$host");
    assert.deepEqual(response.action.context, {});
    assert.equal(ctx.view().state, "cancelled");
  } finally {
    await ctx.close();
  }
});
test("native interruption or process loss disables forms and rejects late submissions", async () => {
  for (const mode of ["interrupt", "offline"]) {
    const ctx = await setup();
    try {
      ctx.show();
      const body = ctx.body();
      if (mode === "interrupt") ctx.codex.finish(ctx.threadId, "interrupted");
      else ctx.codex.offline("fixture stopped");
      assert.equal(ctx.view().state, "unavailable");
      assert.equal(ctx.service.ui.pending, 0);
      assert.equal((await ctx.post(body)).statusCode, 409);
      assert.equal(ctx.view().token, undefined);
    } finally {
      await ctx.close();
    }
  }
});
test("only one pending form per thread and configuration maintenance remains blocked", async () => {
  const ctx = await setup();
  try {
    ctx.show();
    ctx.show();
    assert.equal(ctx.service.ui.pending, 1);
    assert.equal(ctx.codex.toolResponses.length, 1);
    assert.equal(ctx.codex.toolResponses[0].response.success, false);
    await assert.rejects(() =>
      ctx.service.handle("bridge/maintenance", { enabled: true }),
    );
    assert.equal(ctx.service.ui.pending, 1);
  } finally {
    await ctx.close();
  }
});
test("oversized action values are rejected by the product boundary without native dispatch", async () => {
  const ctx = await setup();
  try {
    ctx.show();
    const body = ctx.body();
    assert.equal(
      (
        await ctx.post({
          ...body,
          values: { ...body.values, notes: "x".repeat(4097) },
        })
      ).statusCode,
      400,
    );
    assert.equal(ctx.codex.toolResponses.length, 0);
    assert.equal(ctx.service.ui.pending, 1);
  } finally {
    await ctx.close();
  }
});

test("pending form timeout releases the native request and rejects late browser input", async (testContext) => {
  const ctx = await setup();
  try {
    testContext.mock.timers.enable({ apis: ["setTimeout"] });
    ctx.show();
    const body = ctx.body();
    testContext.mock.timers.tick(600_001);
    testContext.mock.timers.reset();
    assert.equal(ctx.service.ui.pending, 0);
    assert.equal(ctx.view().state, "unavailable");
    assert.equal(ctx.codex.toolResponses[0].response.success, false);
    assert.equal((await ctx.post(body)).statusCode, 409);
  } finally {
    testContext.mock.timers.reset();
    await ctx.close();
  }
});

const draftBody = (
  p: ReturnType<Awaited<ReturnType<typeof setup>>["body"]>,
  expectedVersion = 0,
) => {
  const { requestId: _requestId, sourceComponentId: _source, ...body } = p;
  return { ...body, expectedVersion };
};
async function restartFixture(ctx: Awaited<ReturnType<typeof setup>>) {
  const history = structuredClone(ctx.codex.threads);
  for (const thread of history.values())
    for (const turn of thread.turns) turn.status = "interrupted";
  await ctx.app.close();
  const codex = new A2uiFixtureCodex();
  codex.threads = history;
  const next = await createServer({
    providerRuntime: null,
    directory: ctx.directory,
    cwd: join(ctx.directory, "workspace"),
    codex,
    password: "a2ui-fixture-password",
    origins: [origin],
  });
  await next.app.ready();
  return { ...next, codex };
}

test("server drafts validate editable fields, preserve native waiting state and never reach model context", async () => {
  const ctx = await setup();
  try {
    ctx.show();
    const before = ctx.body(),
      p = draftBody(before);
    const request = (payload: unknown, headers = ctx.headers) =>
      ctx.app.inject({
        method: "POST",
        url: "/api/a2ui/draft",
        headers: { ...headers, "content-type": "application/json" },
        payload: JSON.stringify(payload),
      });
    assert.equal((await request(p, { origin, cookie: "" })).statusCode, 401);
    assert.equal(
      (await request(p, { ...ctx.headers, origin: "https://evil.example" }))
        .statusCode,
      403,
    );
    assert.equal((await request({ ...p, threadId: "other" })).statusCode, 403);
    assert.equal(
      (await request({ ...p, values: { ...p.values, hidden: "extra" } }))
        .statusCode,
      400,
    );
    assert.equal((await request(p)).statusCode, 200);
    const v = ctx.service.ui.read(before.id);
    assert.equal(v.revision, before.revision);
    assert.equal(v.token, before.token);
    assert.equal(v.draft?.values.name, "User value");
    assert.equal(v.draftVersion, 1);
    assert.equal(ctx.service.ui.pending, 1);
    assert.equal(ctx.codex.toolResponses.length, 0);
    const snapshot = ctx.db.raw
      .prepare("SELECT snapshot FROM a2ui_views WHERE id=?")
      .get(before.id) as any;
    assert.ok(!snapshot.snapshot.includes("User value"));
    assert.ok(!JSON.stringify(ctx.codex.calls).includes("User value"));
    const serialized = JSON.stringify(
      ctx.db.raw.prepare("SELECT * FROM a2ui_views").all(),
    );
    assert.ok(!serialized.includes(before.token!));
  } finally {
    await ctx.close();
  }
});

test("draft CAS and clear tombstones prevent another tab or late save from replacing the saved draft", async () => {
  const ctx = await setup();
  try {
    ctx.show();
    const p = draftBody(ctx.body());
    const request = (method: "POST" | "DELETE", payload: unknown) =>
      ctx.app.inject({
        method,
        url: "/api/a2ui/draft",
        headers: { ...ctx.headers, "content-type": "application/json" },
        payload: JSON.stringify(payload),
      });
    assert.equal((await request("POST", p)).statusCode, 200);
    assert.equal((await request("POST", p)).statusCode, 409);
    assert.equal(
      (await request("DELETE", { ...p, expectedVersion: 1, values: {} }))
        .statusCode,
      200,
    );
    assert.equal(ctx.service.ui.read(p.id).draft, undefined);
    assert.equal(ctx.service.ui.read(p.id).draftVersion, 2);
    assert.equal(
      (await request("POST", { ...p, expectedVersion: 1 })).statusCode,
      409,
    );
    assert.equal(
      (await request("POST", { ...p, expectedVersion: 2 })).statusCode,
      200,
    );
  } finally {
    await ctx.close();
  }
});

test("Bridge restart restores saved form and draft read-only without reviving native token or RPC", async () => {
  const ctx = await setup();
  let next: Awaited<ReturnType<typeof restartFixture>> | undefined;
  try {
    ctx.show();
    const p = ctx.body();
    ctx.service.ui.draft(draftBody(p));
    next = await restartFixture(ctx);
    const read = await next.app.inject({
      url: `/api/threads/${ctx.threadId}`,
      headers: ctx.headers,
    });
    assert.equal(read.statusCode, 200);
    const v = JSON.stringify(read.json());
    assert.ok(v.includes("User value"));
    const restored = next.service.ui.read(p.id);
    assert.equal(restored.state, "unavailable");
    assert.equal(restored.reason, "runtime_restarted");
    assert.equal(restored.token, undefined);
    assert.equal(restored.revision, p.revision + 1);
    assert.equal(restored.expiresAt, ctx.view().expiresAt);
    assert.equal(restored.draft?.values.name, "User value");
    assert.equal(next.service.ui.pending, 0);
    assert.equal(
      (
        await next.app.inject({
          method: "POST",
          url: "/api/a2ui/action",
          headers: ctx.headers,
          payload: p,
        })
      ).statusCode,
      409,
    );
    assert.equal(
      (
        await next.app.inject({
          method: "POST",
          url: "/api/a2ui/draft",
          headers: ctx.headers,
          payload: draftBody(p),
        })
      ).statusCode,
      409,
    );
    assert.equal(next.codex.toolResponses.length, 0);
  } finally {
    await next?.app.close();
    await ctx.close();
  }
});

test("accepted durable receipts acknowledge exact retries after restart without executing again", async () => {
  const ctx = await setup();
  let next: Awaited<ReturnType<typeof restartFixture>> | undefined;
  try {
    ctx.show();
    const p = ctx.body();
    ctx.service.ui.draft(draftBody(p));
    assert.equal((await ctx.post(p)).statusCode, 200);
    assert.equal(ctx.service.ui.read(p.id).draft, undefined);
    next = await restartFixture(ctx);
    const post = (payload: unknown) =>
      next!.app.inject({
        method: "POST",
        url: "/api/a2ui/action",
        headers: { ...ctx.headers, "content-type": "application/json" },
        payload: JSON.stringify(payload),
      });
    assert.equal((await post(p)).statusCode, 200);
    assert.equal(
      (await post({ ...p, requestId: randomUUID() })).statusCode,
      409,
    );
    assert.equal(
      (await post({ ...p, values: { ...p.values, name: "changed" } }))
        .statusCode,
      409,
    );
    const restored = next.service.ui.read(p.id);
    assert.equal(restored.state, "submitted");
    assert.ok(JSON.stringify(restored.messages).includes("User value"));
    assert.equal(restored.token, undefined);
    assert.equal(next.codex.toolResponses.length, 0);
  } finally {
    await next?.app.close();
    await ctx.close();
  }
});

test("unknown native pipe outcome is durably fenced and cannot be replayed after restart", async () => {
  const ctx = await setup();
  let next: Awaited<ReturnType<typeof restartFixture>> | undefined;
  try {
    ctx.show();
    const p = ctx.body();
    ctx.service.ui.draft({
      ...draftBody(p),
      values: { ...p.values, name: "older draft" },
    });
    let attempts = 0;
    ctx.codex.respondTool = () => {
      attempts++;
      throw new Error("fixture pipe failed");
    };
    assert.equal((await ctx.post(p)).statusCode, 409);
    assert.equal(attempts, 1);
    assert.equal((await ctx.post(p)).statusCode, 409);
    assert.equal(attempts, 1);
    next = await restartFixture(ctx);
    assert.equal(next.service.ui.read(p.id).reason, "submission_unconfirmed");
    assert.equal(next.service.ui.read(p.id).draft, undefined);
    assert.ok(
      JSON.stringify(next.service.ui.read(p.id).messages).includes(
        "User value",
      ),
    );
    assert.equal(
      (
        await next.app.inject({
          method: "POST",
          url: "/api/a2ui/action",
          headers: ctx.headers,
          payload: p,
        })
      ).statusCode,
      409,
    );
    assert.equal(next.codex.toolResponses.length, 0);
  } finally {
    await next?.app.close();
    await ctx.close();
  }
});

test("pending UI owner survives the bounded event item cache and restores from persisted indexes", async () => {
  const ctx = await setup();
  try {
    ctx.show();
    const p = ctx.body();
    for (let i = 0; i < 270; i++)
      ctx.codex.item(
        ctx.threadId,
        ctx.turnId,
        { id: `progress-${i}`, type: "agentMessage", text: "progress" },
        true,
      );
    assert.equal(ctx.view().id, p.id);
    assert.equal(ctx.view().token, p.token);
    assert.ok(
      ctx.service.events.threads.get(ctx.threadId)!.turns[0].items.length <=
        257,
    );
    assert.equal((await ctx.post(p)).statusCode, 200);
    const thread = structuredClone(
      ctx.service.events.threads.get(ctx.threadId)!,
    );
    for (const turn of thread.turns) turn.items = [];
    ctx.service.ui.decorate(thread);
    assert.equal(
      thread.turns[0].items.find((i) => i.a2ui)?.a2ui?.state,
      "submitted",
    );
  } finally {
    await ctx.close();
  }
});

test("expiry retains the saved ordinary draft but revokes submission and draft writes", async (t) => {
  const ctx = await setup();
  try {
    t.mock.timers.enable({ apis: ["setTimeout"] });
    ctx.show();
    const p = ctx.body();
    ctx.service.ui.draft(draftBody(p));
    t.mock.timers.tick(600_001);
    t.mock.timers.reset();
    const v = ctx.service.ui.read(p.id);
    assert.equal(v.reason, "expired");
    assert.equal(v.token, undefined);
    assert.equal(v.draft?.values.name, "User value");
    assert.equal((await ctx.post(p)).statusCode, 409);
    assert.throws(() => ctx.service.ui.draft(draftBody(p)), /表单已变化/);
    assert.equal(ctx.codex.toolResponses.length, 1);
  } finally {
    t.mock.timers.reset();
    await ctx.close();
  }
});

test("storage failure before native consume leaves the waiting request retryable", async () => {
  const ctx = await setup();
  try {
    ctx.show();
    const p = ctx.body();
    ctx.db.raw.exec(
      "CREATE TRIGGER ui_full BEFORE UPDATE ON a2ui_views WHEN NEW.reason='submission_unconfirmed' BEGIN SELECT RAISE(ABORT,'fixture storage full'); END",
    );
    assert.notEqual((await ctx.post(p)).statusCode, 200);
    assert.equal(ctx.codex.toolResponses.length, 0);
    assert.equal(ctx.service.ui.pending, 1);
    assert.equal(ctx.service.ui.read(p.id).token, p.token);
    ctx.db.raw.exec("DROP TRIGGER ui_full");
    assert.equal((await ctx.post(p)).statusCode, 200);
    assert.equal(ctx.codex.toolResponses.length, 1);
  } finally {
    await ctx.close();
  }
});

test("storage failure after native consume preserves an unknown durable fence", async () => {
  const ctx = await setup();
  let next: Awaited<ReturnType<typeof restartFixture>> | undefined;
  try {
    ctx.show();
    const p = ctx.body();
    ctx.db.raw.exec(
      "CREATE TRIGGER ui_final_full BEFORE UPDATE ON a2ui_views WHEN NEW.state='submitted' BEGIN SELECT RAISE(ABORT,'fixture storage full'); END",
    );
    assert.equal((await ctx.post(p)).statusCode, 409);
    assert.equal(ctx.codex.toolResponses.length, 1);
    assert.equal((await ctx.post(p)).statusCode, 409);
    ctx.db.raw.exec("DROP TRIGGER ui_final_full");
    next = await restartFixture(ctx);
    assert.equal(next.service.ui.read(p.id).reason, "submission_unconfirmed");
    assert.equal(
      (
        await next.app.inject({
          method: "POST",
          url: "/api/a2ui/action",
          headers: ctx.headers,
          payload: p,
        })
      ).statusCode,
      409,
    );
    assert.equal(next.codex.toolResponses.length, 0);
  } finally {
    await next?.app.close();
    await ctx.close();
  }
});
