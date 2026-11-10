import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { appRegistry } from "../server/mcp-apps.js";
import { FakeCodex } from "./fixture.js";
import { AppFailure, publicAppIssue } from "../server/app-error.js";
import { appHostPolicy } from "../shared/mcp-app-host.js";
const item = (id = "app-item", cpu = 25) =>
  ({
    id,
    type: "mcpToolCall",
    server: "test-server",
    tool: "metrics",
    arguments: { source: id },
    status: "completed",
    result: {
      content: [],
      structuredContent: { cpu, source: id },
      _meta: { private: "SYNTHETIC_APP_PRIVATE" },
    },
  }) as any;
async function fixture(fn: (f: any) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "newbot-app-lifecycle-")),
    codex = new FakeCodex(),
    ctx = await createServer({
    providerRuntime: null,
      directory: dir,
      cwd: join(dir, "work"),
      codex,
      password: "app-lifecycle-password",
      origins: ["http://127.0.0.1:3100"],
    });
  try {
    const thread: any = await ctx.service.handle("thread/start", {
      model: "fixture-model",
      provider: "fixture",
    });
    const turn = {
      id: "source-turn",
      status: "completed",
      items: [item()],
      error: null,
    };
    codex.threads.get(thread.id)!.turns.push(turn);
    await fn({ ...ctx, codex, threadId: thread.id, turnId: turn.id });
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
async function login(app: any) {
  const origin = "http://127.0.0.1:3100",
    r = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "app-lifecycle-password" },
    });
  return { origin, cookie: r.headers["set-cookie"].split(";")[0] };
}
const nativeOpen = (f: any, extra: any = {}) =>
  f.service.handle("app/open", {
    threadId: f.threadId,
    turnId: f.turnId,
    itemId: "app-item",
    requestId: randomUUID(),
    ...extra,
  });
test("history descriptors carry no live permissions; each explicit view gets an independent lease", async () => {
  const codex = new FakeCodex(),
    registry = appRegistry(codex);
  await registry.refresh("thread");
  const d = registry.register("thread", item());
  assert.ok(d);
  assert.equal(registry.records.size, 0);
  const a = registry.open("thread", item(), "turn", "a", "session-a"),
    b = registry.open("thread", item(), "turn", "b", "session-b");
  assert.notEqual(a.token, b.token);
  registry.close(a.token, "session-a");
  assert.equal(registry.live(a.token), undefined);
  assert.ok(registry.live(b.token));
  assert.throws(
    () => registry.validate(b.token, "metrics", "session-a"),
    /浏览器会话/,
  );
});
test("incidental history reads cannot extend or revive expired App permissions", async () => {
  const codex = new FakeCodex();
  let clock = 100;
  const registry = appRegistry(codex, { now: () => clock, ttlMs: 100 });
  await registry.refresh("thread");
  const a = registry.open("thread", item(), "turn");
  clock = 190;
  registry.register("thread", item());
  assert.equal(a.expires, 200);
  clock = 201;
  assert.throws(
    () => registry.status(a.token),
    (e: any) => e.appIssue.code === "expired",
  );
  assert.equal(registry.records.size, 0);
  const b = registry.open("thread", item(), "turn");
  assert.notEqual(a.token, b.token);
  assert.equal(b.expires, 301);
});
test("view limits fail explicitly without silently evicting active views", async () => {
  const registry = appRegistry(new FakeCodex(), { maxViews: 2 });
  await registry.refresh("thread");
  const a = registry.open("thread", item("a")),
    b = registry.open("thread", item("b"));
  assert.throws(
    () => registry.open("thread", item("c")),
    (e: any) => e.appIssue.code === "limit",
  );
  assert.ok(registry.live(a.token));
  registry.close(a.token);
  registry.open("thread", item("c"));
  assert.ok(registry.live(b.token));
});
test("opening paginates the requested Turn and uses its original result rather than another matching item", async () => {
  await fixture(async (f) => {
    const original = f.codex.call.bind(f.codex),
      queries: any[] = [];
    f.codex.call = async (m: any, p: any) => {
      if (m === "thread/items/list") {
        queries.push(p);
        return p.cursor
          ? {
              data: [{ turnId: f.turnId, item: item("app-item", 75) }],
              nextCursor: null,
            }
          : {
              data: [{ turnId: "wrong-turn", item: item("app-item", 99) }],
              nextCursor: "older",
            };
      }
      return original(m, p);
    };
    const opened = await nativeOpen(f);
    assert.equal(opened.result.structuredContent.cpu, 75);
    assert.equal(opened.source.turnId, f.turnId);
    assert.equal(opened.source.itemId, "app-item");
    assert.equal(queries.length, 2);
    assert.ok(queries.every((q) => q.turnId === f.turnId));
    assert.equal(
      f.codex.calls.find((c: any) => c.method === "mcpServer/resource/read")
        .params.originCallId,
      "app-item",
    );
  });
});
test("metadata-only App discovery adds a safe view hint and is restored from history without tool execution", async () => {
  await fixture(async (f) => {
    f.service.events.threads.delete(f.threadId);
    const thread = await f.service.read(f.threadId);
    const view = thread.turns[0].items[0];
    assert.equal(view.appAvailable, true);
    assert.equal(view.result._meta, undefined);
    const opened = await nativeOpen(f);
    assert.equal(opened.result._meta.private, "SYNTHETIC_APP_PRIVATE");
    assert.equal(opened.result.structuredContent.cpu, 25);
    assert.deepEqual(opened.hostPolicy, appHostPolicy(true));
    assert.equal(
      f.codex.calls.some((c: any) => c.method === "mcpServer/tool/call"),
      false,
    );
  });
});
test("resource and tool failures clean up permissions and never forward raw MCP diagnostics", async () => {
  await fixture(async (f) => {
    const original = f.codex.call.bind(f.codex);
    f.codex.call = async (m: any, p: any) => {
      if (m === "mcpServer/resource/read") throw Error("SYNTHETIC_APP_PRIVATE");
      return original(m, p);
    };
    await assert.rejects(
      nativeOpen(f),
      (e: any) =>
        e.appIssue.code === "resource" && !e.message.includes("SYNTHETIC"),
    );
    assert.equal(f.service.apps.records.size, 0);
    f.codex.call = async (m: any, p: any) => {
      if (m === "mcpServer/tool/call")
        throw Error("上游错误：SYNTHETIC_APP_PRIVATE");
      return original(m, p);
    };
    const opened = await nativeOpen(f),
      grant = await f.service.handle("app/call/request", {
        token: opened.token,
        tool: "metrics",
        arguments: {},
      });
    await assert.rejects(
      f.service.handle("app/call/approve", { grant: grant.grant, allow: true }),
      (e: any) =>
        e instanceof AppFailure &&
        e.appIssue.code === "unavailable" &&
        !e.message.includes("SYNTHETIC"),
    );
    await assert.rejects(
      f.service.handle("app/call/approve", { grant: grant.grant, allow: true }),
      (e: any) => e.appIssue.code === "approval_expired",
    );
    assert.equal(f.service.apps.status(opened.token).state, "active");
  });
});
test("malformed resources and oversized results fail before an active UI is exposed", async () => {
  await fixture(async (f) => {
    const original = f.codex.call.bind(f.codex);
    f.codex.call = async (m: any, p: any) =>
      m === "mcpServer/resource/read"
        ? {
            contents: [
              { uri: p.uri, mimeType: "image/svg+xml", text: "private" },
            ],
          }
        : original(m, p);
    await assert.rejects(
      nativeOpen(f),
      (e: any) => e.appIssue.code === "resource",
    );
    assert.equal(f.service.apps.records.size, 0);
  });
  const registry = appRegistry(new FakeCodex());
  await registry.refresh("thread");
  const oversized = item();
  oversized.result.structuredContent = { text: "x".repeat(2 * 1024 * 1024) };
  assert.throws(
    () => registry.open("thread", oversized),
    (e: any) => e.appIssue.code === "limit",
  );
  assert.equal(registry.records.size, 0);
});
test("closing during resource loading discards the late result and prevents a capability leak", async () => {
  await fixture(async (f) => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      gate = new Promise<void>((r) => (release = r)),
      original = f.codex.call.bind(f.codex);
    f.codex.call = async (m: any, p: any) => {
      if (m === "mcpServer/resource/read") {
        enter();
        await gate;
      }
      return original(m, p);
    };
    const requestId = randomUUID(),
      opening = nativeOpen(f, { requestId });
    await entered;
    await f.service.handle("app/close", { requestId });
    release();
    await assert.rejects(opening, (e: any) => e.appIssue.code === "expired");
    assert.equal(f.service.apps.records.size, 0);
    assert.equal(
      f.codex.calls.some((c: any) => c.method === "mcpServer/tool/call"),
      false,
    );
  });
});
test("cancel arriving before an open request prevents late creation", async () => {
  await fixture(async (f) => {
    const requestId = randomUUID();
    await f.service.handle("app/close", { requestId });
    const n = f.codex.calls.length;
    await assert.rejects(
      nativeOpen(f, { requestId }),
      (e: any) => e.appIssue.code === "expired",
    );
    assert.equal(f.codex.calls.length, n);
  });
});
test("closing revokes pending grants immediately and is allowed while maintenance is active", async () => {
  await fixture(async (f) => {
    const opened = await nativeOpen(f),
      grant = await f.service.handle("app/call/request", {
        token: opened.token,
        tool: "metrics",
        arguments: { range: "1h" },
      });
    await f.service.handle("app/close", { token: opened.token });
    await f.service.handle("bridge/maintenance", { enabled: true });
    await f.service.handle("app/close", { token: opened.token });
    await assert.rejects(
      f.service.handle("app/call/approve", { grant: grant.grant, allow: true }),
    );
    assert.equal(
      f.codex.calls.some((c: any) => c.method === "mcpServer/tool/call"),
      false,
    );
    await f.service.handle("bridge/maintenance", { enabled: false });
  });
});
test("permission changes are rechecked at approval and invalidate the former resource association", async () => {
  await fixture(async (f) => {
    const opened = await nativeOpen(f),
      grant = await f.service.handle("app/call/request", {
        token: opened.token,
        tool: "metrics",
        arguments: { range: "1h" },
      }),
      original = f.codex.call.bind(f.codex);
    f.codex.call = async (m: any, p: any) => {
      const r = await original(m, p);
      if (m === "mcpServerStatus/list")
        r.data[0].tools.metrics._meta.ui.resourceUri = "ui://changed";
      return r;
    };
    await assert.rejects(
      f.service.handle("app/call/approve", { grant: grant.grant, allow: true }),
      (e: any) => e.appIssue.code === "expired",
    );
    assert.equal(f.service.apps.live(opened.token), undefined);
    assert.equal(
      f.codex.calls.some((c: any) => c.method === "mcpServer/tool/call"),
      false,
    );
  });
});
test("denial and cancellation consume a grant without another MCP request", async () => {
  await fixture(async (f) => {
    const opened = await nativeOpen(f);
    const grant = await f.service.handle("app/call/request", {
        token: opened.token,
        tool: "metrics",
        arguments: {},
      }),
      before = f.codex.calls.length;
    await assert.rejects(
      f.service.handle("app/call/approve", {
        grant: grant.grant,
        allow: false,
      }),
      /拒绝/,
    );
    assert.equal(f.codex.calls.length, before);
    await f.service.handle("app/call/cancel", { grant: grant.grant });
    await assert.rejects(
      f.service.handle("app/call/approve", { grant: grant.grant, allow: true }),
    );
    assert.equal(
      f.codex.calls.some((c: any) => c.method === "mcpServer/tool/call"),
      false,
    );
  });
});
test("a call already approved may finish after closing, while future calls and replay remain denied", async () => {
  await fixture(async (f) => {
    const opened = await nativeOpen(f),
      grant = await f.service.handle("app/call/request", {
        token: opened.token,
        tool: "metrics",
        arguments: { range: "1h" },
      });
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>((r) => (enter = r)),
      gate = new Promise<void>((r) => (release = r)),
      original = f.codex.call.bind(f.codex);
    f.codex.call = async (m: any, p: any) => {
      if (m === "mcpServer/tool/call") {
        enter();
        await gate;
      }
      return original(m, p);
    };
    const running = f.service.handle("app/call/approve", {
      grant: grant.grant,
      allow: true,
    });
    await entered;
    await f.service.handle("app/close", { token: opened.token });
    release();
    await running;
    await assert.rejects(
      f.service.handle("app/call/request", {
        token: opened.token,
        tool: "metrics",
        arguments: {},
      }),
    );
    await assert.rejects(
      f.service.handle("app/call/approve", { grant: grant.grant, allow: true }),
    );
    assert.equal(
      f.codex.calls.filter((c: any) => c.method === "mcpServer/tool/call")
        .length,
      1,
    );
    assert.equal(
      f.codex.calls.some((c: any) => c.method === "turn/interrupt"),
      false,
    );
  });
});
test("App HTML, controls and grants are bound to the opening Web session and logout revokes its resources", async () => {
  await fixture(async (f) => {
    const a = await login(f.app),
      b = await login(f.app),
      post = (action: string, payload: any, headers = a) =>
        f.app.inject({
          method: "POST",
          url: `/api/mcp-apps/${action}`,
          headers,
          payload,
        });
    const first = (
        await post("open", {
          threadId: f.threadId,
          turnId: f.turnId,
          itemId: "app-item",
          requestId: randomUUID(),
        })
      ).json(),
      second = (
        await post(
          "open",
          {
            threadId: f.threadId,
            turnId: f.turnId,
            itemId: "app-item",
            requestId: randomUUID(),
          },
          b,
        )
      ).json();
    assert.notEqual(first.token, second.token);
    for (const action of ["status", "close"])
      assert.equal(
        (await post(action, { token: first.token }, b)).statusCode,
        403,
      );
    assert.equal(
      (
        await post(
          "call-request",
          { token: first.token, tool: "metrics", arguments: {} },
          b,
        )
      ).statusCode,
      403,
    );
    const url = new URL(first.url);
    assert.equal(
      (await f.app.inject({ url: url.pathname, headers: { host: url.host } }))
        .statusCode,
      200,
    );
    await f.app.inject({ method: "POST", url: "/api/logout", headers: a });
    assert.equal(
      (await f.app.inject({ url: url.pathname, headers: { host: url.host } }))
        .statusCode,
      404,
    );
    assert.equal(
      (await post("status", { token: second.token }, b)).statusCode,
      200,
    );
    assert.equal(
      (await post("status", { token: second.token })).statusCode,
      401,
    );
  });
});
test("expired or closed leases remove their sandbox document and cannot be revived by reopening history", async () => {
  await fixture(async (f) => {
    const headers = await login(f.app),
      response = await f.app.inject({
        method: "POST",
        url: "/api/mcp-apps/open",
        headers,
        payload: {
          threadId: f.threadId,
          turnId: f.turnId,
          itemId: "app-item",
          requestId: randomUUID(),
        },
      }),
      opened = response.json(),
      url = new URL(opened.url);
    f.service.apps.records.get(opened.token)!.expires = Date.now() - 1;
    assert.equal(
      (await f.app.inject({ url: url.pathname, headers: { host: url.host } }))
        .statusCode,
      404,
    );
    await f.service.read(f.threadId);
    assert.equal(f.service.apps.records.size, 0);
    const fresh = await f.app.inject({
      method: "POST",
      url: "/api/mcp-apps/open",
      headers,
      payload: {
        threadId: f.threadId,
        turnId: f.turnId,
        itemId: "app-item",
        requestId: randomUUID(),
      },
    });
    assert.equal(fresh.statusCode, 200, fresh.body);
    assert.notEqual(fresh.json().token, opened.token);
  });
});
test("App lifecycle controls enforce Origin and the independent App host cannot invoke them", async () => {
  await fixture(async (f) => {
    const headers = await login(f.app);
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/mcp-apps/open",
          headers: { ...headers, origin: "https://evil.example" },
          payload: { threadId: f.threadId, itemId: "app-item" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/mcp-apps/close",
          headers: {
            ...headers,
            host: "localhost:3100",
            origin: "http://localhost:3100",
          },
          payload: { requestId: randomUUID() },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: "/api/mcp-apps/close",
          headers,
          payload: { requestId: randomUUID(), server: "other" },
        })
      ).statusCode,
      400,
    );
  });
  assert.equal(
    publicAppIssue({ appIssue: { code: "expired", secret: "x" } }),
    null,
  );
  assert.deepEqual(
    publicAppIssue(
      new AppFailure("fixed", 410, { code: "expired", secret: "x" } as any),
    ),
    { code: "expired" },
  );
});
