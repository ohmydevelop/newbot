import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { database } from "../server/db.js";
import { fileStore } from "../server/files.js";
import { runStore } from "../server/runs.js";
import { auth } from "../server/auth.js";
import { FakeCodex } from "./fixture.js";
import type { Method, Params, Result } from "../server/protocol.js";
const origin = "http://127.0.0.1:3100";
const password = "stable-test-password-only";
async function server(directory: string, codex = new FakeCodex()) {
  const ctx = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "workspace"),
    codex,
    password,
    origins: [origin],
  });
  await ctx.app.ready();
  await ctx.service.settings();
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password },
  });
  const headers = {
    origin,
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
  };
  const post = (url: string, payload: any) =>
    ctx.app.inject({ method: "POST", url, headers, payload });
  return { ...ctx, codex, headers, post };
}
test("password rotation revokes sessions; identical restart does not; async rate limits bound parallel attempts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-auth-"));
  const db = database(dir);
  try {
    auth(db, dir, password);
    const token = db.createSession();
    auth(db, dir, password);
    assert.ok(db.validSession(token));
    const verify = auth(db, dir, "a-different-strong-test-password");
    assert.equal(db.validSession(token), false);
    assert.equal(await verify("ip", "wrong"), false);
    assert.equal(await verify("ip", "a-different-strong-test-password"), true);
    const outcomes = await Promise.allSettled(
      Array.from({ length: 20 }, () => verify("attacker", "wrong")),
    );
    assert.ok(outcomes.some((r) => r.status === "rejected"));
  } finally {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("unknown dispatch survives restart, rejects replay and never creates a second turn", async () => {
  class LostResponse extends FakeCodex {
    override async call<M extends Method>(
      method: M,
      p: Params<M>,
    ): Promise<Result<M>> {
      if (method === "turn/start") {
        this.calls.push({ method, params: p });
        throw new Error("upstream secret-key=DO-NOT-LEAK");
      }
      return super.call(method, p);
    }
  }
  const dir = mkdtempSync(join(tmpdir(), "newbot-unknown-"));
  const codex = new LostResponse();
  let ctx = await server(dir, codex);
  const payload = {
    text: "one task only",
    model: "fixture-model",
    requestId: randomUUID(),
  };
  try {
    const first = await ctx.post("/api/agent/run", payload);
    assert.equal(first.statusCode, 400);
    assert.ok(!first.body.includes("DO-NOT-LEAK"));
    await ctx.app.close();
    ctx = await server(dir, codex);
    const retry = await ctx.post("/api/agent/run", payload);
    assert.equal(retry.statusCode, 409);
    const status = (
      await ctx.app.inject({
        url: "/api/agent/runs/" + payload.requestId,
        headers: ctx.headers,
      })
    ).json();
    assert.equal(status.state, "unknown");
    assert.ok(status.threadId);
    assert.equal(
      codex.calls.filter((c) => c.method === "turn/start").length,
      1,
    );
    const changed = await ctx.post("/api/agent/run", {
      ...payload,
      text: "different task",
    });
    assert.equal(changed.statusCode, 400);
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("lost response can reconcile using native clientId, not the server item id", async () => {
  class LostAfterSubmission extends FakeCodex {
    override async call<M extends Method>(
      method: M,
      p: Params<M>,
    ): Promise<Result<M>> {
      const result = await super.call(method, p);
      if (method === "turn/start") throw new Error("timeout after accepted");
      return result;
    }
  }
  const dir = mkdtempSync(join(tmpdir(), "newbot-reconcile-"));
  const ctx = await server(dir, new LostAfterSubmission());
  try {
    const requestId = randomUUID();
    await ctx.post("/api/agent/run", { text: "accepted once", requestId });
    // Simulate crash between native execution and handling the notification/response.
    ctx.db.raw
      .prepare(
        "UPDATE runs SET state='unknown',turn_id=NULL WHERE request_id=?",
      )
      .run(requestId);
    const value = (
      await ctx.app.inject({
        url: "/api/agent/runs/" + requestId,
        headers: ctx.headers,
      })
    ).json();
    assert.equal(value.state, "accepted");
    assert.ok(value.turn.id);
    assert.equal(
      ctx.codex.calls.filter((c) => c.method === "turn/start").length,
      1,
    );
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("two concurrent turns are allowed; overload and maintenance reject new work before thread creation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-capacity-"));
  const ctx = await server(dir);
  try {
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await ctx.post("/api/agent/run", {
            text: "task",
            requestId: randomUUID(),
          })
        ).statusCode,
        200,
      );
    const count = ctx.codex.threads.size;
    assert.equal(
      (
        await ctx.post("/api/agent/run", {
          text: "busy",
          requestId: randomUUID(),
        })
      ).statusCode,
      429,
    );
    assert.equal(ctx.codex.threads.size, count);
    assert.equal(
      (
        await ctx.post("/api/agent/action", {
          action: "bridge/maintenance",
          enabled: true,
        })
      ).statusCode,
      400,
    );
    ctx.codex.active.clear();
    assert.equal(
      (
        await ctx.post("/api/agent/action", {
          action: "bridge/maintenance",
          enabled: true,
        })
      ).statusCode,
      200,
    );
    assert.equal((await ctx.app.inject({ url: "/api/ready" })).statusCode, 503);
    assert.equal(
      (
        await ctx.post("/api/agent/run", {
          text: "maintenance",
          requestId: randomUUID(),
        })
      ).statusCode,
      503,
    );
    await ctx.post("/api/agent/action", {
      action: "bridge/maintenance",
      enabled: false,
    });
    assert.equal((await ctx.app.inject({ url: "/api/ready" })).statusCode, 200);
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("message file references survive archive and cleanup; only unreferenced new uploads expire", () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-files-"));
  const db = database(dir);
  const files = fileStore(dir, db);
  const runs = runStore(db);
  try {
    const sent = files.save("keep.txt", Buffer.from("attached"));
    const unused = files.save("expire.txt", Buffer.from("unsent"));
    const requestId = randomUUID();
    const { run } = runs.reserve(requestId, {
      text: "with file",
      threadId: "owned",
    });
    db.addThread("owned", "fixture");
    files.bind(requestId, [sent.id]);
    runs.update(requestId, "accepted", "owned", "turn");
    db.archive("owned");
    assert.equal(files.cleanup(Date.now() + 86400001), 1);
    assert.equal(files.read(sent.id).data.toString(), "attached");
    assert.throws(() => files.read(unused.id));
    const thread = files.decorate({
      id: "owned",
      modelProvider: "fixture",
      status: { type: "idle" },
      turns: [
        {
          id: "turn",
          status: "completed",
          items: [
            {
              type: "userMessage",
              id: "server-item",
              clientId: run.client_message_id,
              content: [{ type: "text", text: "with file" }],
            },
          ],
        },
      ],
    });
    assert.equal(
      thread.turns[0].items[0].content?.[1].url,
      `/api/files/${sent.id}`,
    );
  } finally {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("provider changes are idle-only, rediscover models and resume using the saved provider", async () => {
  class Providers extends FakeCodex {
    provider = "fixture";
    restarts = 0;
    override async start() {
      this.restarts++;
      await super.start();
    }
    override async call<M extends Method>(
      method: M,
      params: Params<M>,
    ): Promise<Result<M>> {
      const result = (await super.call(method, params)) as any;
      if (method === "config/read") {
        result.config.model_provider = this.provider;
        result.config.model_providers.secondary = { name: "secondary" };
        result.config.model =
          this.provider === "fixture" ? "fixture-model" : "secondary-model";
      }
      if (method === "config/batchWrite")
        for (const edit of (params as any).edits)
          if (edit.keyPath === "model_provider") this.provider = edit.value;
      if (method === "model/list" && this.provider === "secondary") {
        result.data[0].id = "secondary-model";
        result.data[0].model = "secondary-model";
      }
      if (method === "thread/start") {
        result.thread.modelProvider = this.provider;
        this.threads.get(result.thread.id)!.modelProvider = this.provider;
      }
      return result;
    }
  }
  const dir = mkdtempSync(join(tmpdir(), "newbot-provider-"));
  const codex = new Providers();
  const ctx = await server(dir, codex);
  try {
    const first = (
      await ctx.post("/api/agent/run", {
        text: "first",
        requestId: randomUUID(),
      })
    ).json();
    assert.equal(
      (
        await ctx.post("/api/agent/action", {
          action: "provider/switch",
          provider: "secondary",
        })
      ).statusCode,
      400,
    );
    assert.equal(codex.restarts, 0);
    codex.finish(first.threadId);
    const switched = await ctx.post("/api/agent/action", {
      action: "provider/switch",
      provider: "secondary",
    });
    assert.equal(switched.statusCode, 200, switched.body);
    assert.equal(switched.json().models[0].model, "secondary-model");
    assert.equal(codex.restarts, 1);
    const resumed = await ctx.post("/api/agent/run", {
      threadId: first.threadId,
      text: "resume",
      model: "secondary-model",
      requestId: randomUUID(),
    });
    assert.equal(resumed.statusCode, 400, resumed.body);
    const correct = await ctx.post("/api/agent/run", {
      threadId: first.threadId,
      text: "resume with saved gateway",
      requestId: randomUUID(),
    });
    assert.equal(correct.statusCode, 200, correct.body);
    assert.equal(codex.provider, "secondary");
    assert.equal(
      codex.restarts,
      1,
      "resuming another gateway must not restart the shared runtime",
    );
    const resume = codex.calls
      .filter((c) => c.method === "thread/resume")
      .at(-1)!;
    assert.equal(resume.params.modelProvider, "fixture");
    const start = codex.calls.filter((c) => c.method === "turn/start").at(-1)!;
    assert.equal(
      start.params.model,
      "fixture-model",
      "must use the saved session model, not the other gateway model",
    );
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("OAuth callback proxies only to configured loopback and never forwards credentials or upstream body", async () => {
  const { createServer: httpServer } = await import("node:http");
  let received: any;
  const upstream = httpServer((req, res) => {
    received = {
      url: req.url,
      cookie: req.headers.cookie,
      authorization: req.headers.authorization,
    };
    res.end("secret upstream body MUST-NOT-LEAK");
  });
  await new Promise<void>((resolve) =>
    upstream.listen(0, "127.0.0.1", resolve),
  );
  const port = (upstream.address() as any).port;
  const oldPort = process.env.MCP_OAUTH_CALLBACK_PORT,
    oldUrl = process.env.MCP_OAUTH_CALLBACK_URL;
  process.env.MCP_OAUTH_CALLBACK_PORT = String(port);
  process.env.MCP_OAUTH_CALLBACK_URL = "https://agent.test/oauth/mcp/callback";
  const dir = mkdtempSync(join(tmpdir(), "newbot-oauth-"));
  const ctx = await createServer({
    providerRuntime: null,
    directory: dir,
    cwd: dir,
    codex: new FakeCodex(),
    password,
    origins: ["https://agent.test"],
  });
  try {
    const response = await ctx.app.inject({
      url: "/oauth/mcp/callback/server-id?code=synthetic-code&state=synthetic-state",
      headers: {
        cookie: "ma_session=not-forwarded",
        authorization: "Bearer not-forwarded",
      },
    });
    assert.equal(response.statusCode, 200);
    assert.ok(!response.body.includes("MUST-NOT-LEAK"));
    assert.equal(received.cookie, undefined);
    assert.equal(received.authorization, undefined);
    assert.equal(
      received.url,
      "/oauth/mcp/callback/server-id?code=synthetic-code&state=synthetic-state",
    );
    const invalid = await ctx.app.inject({
      url: "/oauth/mcp/callback/server-id/extra?code=x",
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await ctx.app.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
    rmSync(dir, { recursive: true, force: true });
    if (oldPort === undefined) delete process.env.MCP_OAUTH_CALLBACK_PORT;
    else process.env.MCP_OAUTH_CALLBACK_PORT = oldPort;
    if (oldUrl === undefined) delete process.env.MCP_OAUTH_CALLBACK_URL;
    else process.env.MCP_OAUTH_CALLBACK_URL = oldUrl;
  }
});
test("concurrent reconnect controls share one Codex restart", async () => {
  class SlowStart extends FakeCodex {
    starts = 0;
    override async start() {
      this.starts++;
      this.state = "starting";
      await new Promise((r) => setTimeout(r, 20));
      this.state = "ready";
    }
  }
  const runtime = new SlowStart();
  runtime.state = "offline";
  await Promise.all([runtime.restart(), runtime.restart(), runtime.restart()]);
  assert.equal(runtime.starts, 1);
  assert.equal(runtime.state, "ready");
});
test("pre-dispatch validation failure is rejected, releases unsent files and does not reserve an unknown turn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-rejected-"));
  const ctx = await server(dir);
  try {
    const upload = await ctx.app.inject({
      method: "POST",
      url: "/api/attachments?name=unsent.txt",
      headers: { ...ctx.headers, "Content-Type": "application/octet-stream" },
      payload: Buffer.from("not submitted"),
    });
    const requestId = randomUUID();
    const response = await ctx.post("/api/agent/run", {
      text: "invalid model",
      model: "not-discovered",
      attachments: [upload.json().id],
      requestId,
    });
    assert.equal(response.statusCode, 400);
    const run = ctx.db.raw
      .prepare("SELECT * FROM runs WHERE request_id=?")
      .get(requestId)!;
    assert.equal(run.state, "rejected");
    assert.equal(run.turn_id, null);
    assert.equal(
      ctx.db.raw
        .prepare("SELECT COUNT(*) AS n FROM run_attachments WHERE request_id=?")
        .get(requestId)!.n,
      0,
    );
    assert.equal(
      ctx.codex.calls.filter((c) => c.method === "turn/start").length,
      0,
    );
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Codex MCP tool consent accepts empty forms once; rejects real form input, URL mode and persistence", async () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-consent-"));
  const ctx = await server(dir);
  try {
    const started: any = await ctx.service.handle("thread/start", {});
    const sent: any[] = [];
    ctx.codex.child = {
      stdin: {
        writable: true,
        write: (line: string) => sent.push(JSON.parse(line)),
      },
    } as any;
    const base = {
      method: "mcpServer/elicitation/request",
      id: 12,
      params: {
        threadId: started.id,
        turnId: null,
        serverName: "test-server",
        mode: "form",
        message: "Allow get-time?",
        _meta: {
          codex_approval_kind: "mcp_tool_call",
          persist: ["session", "always"],
        },
        requestedSchema: { type: "object", properties: {} },
      },
    };
    ctx.codex.approvals.set(12, base as any);
    const accepted = await ctx.post("/api/agent/action", {
      action: "approval/respond",
      id: 12,
      allow: true,
    });
    assert.equal(accepted.statusCode, 200, accepted.body);
    assert.equal(ctx.codex.approvals.has(12), false);
    assert.deepEqual(sent[0], {
      id: 12,
      result: { action: "accept", content: {}, _meta: null },
    });
    assert.equal(
      (
        await ctx.post("/api/agent/action", {
          action: "approval/respond",
          id: 12,
          allow: true,
        })
      ).statusCode,
      400,
    );
    for (const change of [
      { mode: "url", url: "https://example.invalid/" },
      {
        requestedSchema: {
          type: "object",
          properties: { password: { type: "string" } },
        },
      },
      {
        requestedSchema: {
          type: "object",
          properties: {},
          required: ["password"],
        },
      },
      { _meta: { codex_approval_kind: "some_other_kind" } },
    ]) {
      ctx.codex.approvals.set(13, {
        ...base,
        id: 13,
        params: { ...base.params, ...change },
      } as any);
      const result = await ctx.post("/api/agent/action", {
        action: "approval/respond",
        id: 13,
        allow: true,
      });
      assert.equal(result.statusCode, 400);
      assert.ok(ctx.codex.approvals.has(13));
    }
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("blank optional provider uses the native default and never forwards an invalid empty provider ID", async () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-blank-provider-"));
  const ctx = await server(dir);
  const original = ctx.codex.call.bind(ctx.codex);
  ctx.codex.call = (async (method: any, params: any) => {
    if (method === "thread/start" && params.modelProvider === "")
      throw new Error("Unknown provider: empty ID");
    return original(method, params);
  }) as typeof ctx.codex.call;
  try {
    const response = await ctx.post("/api/agent/run", {
      requestId: randomUUID(),
      provider: "",
      model: "fixture-model",
      text: "use default provider",
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(ctx.codex.threads.size, 1);
    assert.equal(response.json().state, "accepted");
    assert.ok(response.json().turn.id);
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("clearing the database keeps the existing local password instead of rotating it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-auth-reuse-"));
  const previous = process.env.ADMIN_PASSWORD;
  delete process.env.ADMIN_PASSWORD;
  try {
    const first = database(dir);
    auth(first, dir);
    const file = join(dir, "initial-password");
    const original = readFileSync(file, "utf8").trim();
    assert.ok(original.length >= 12);
    assert.equal(await auth(first, dir)("ip", original), true);
    first.raw.close();

    // Operator clears the data directory's database only.
    rmSync(join(dir, "newbot.sqlite"), { force: true });
    const empty = database(dir);
    assert.equal(empty.get("password"), undefined);
    const verify = auth(empty, dir);
    assert.equal(readFileSync(file, "utf8").trim(), original);
    assert.equal(await verify("ip", original), true);
    empty.raw.close();
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
