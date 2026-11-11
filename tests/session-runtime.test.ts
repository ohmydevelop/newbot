import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { codexEnvironment } from "../server/codex.js";
import { ConfigCodex } from "./config-fixture.js";
import type { Method, Params, Result } from "../server/protocol.js";
import { approvalParameters } from "../shared/runtime-settings.js";
class RuntimeCodex extends ConfigCodex {
  unloaded: string[] = [];
  failResume = false;
  denied = false;
  restarts = 0;
  restoredModel: string | undefined;
  constructor() {
    super();
    this.config.profiles = {
      newbot_gateway_secondary: {
        model_provider: "secondary",
        model: "fixture-model",
      },
    };
    this.config.model_providers.secondary = {
      name: "Second",
      wire_api: "responses",
    };
  }
  override async unload(id: string) {
    this.unloaded.push(id);
    this.loaded.delete(id);
  }
  override async restart() {
    this.restarts++;
  }
  override async call<M extends Method>(
    method: M,
    params: Params<M>,
  ): Promise<Result<M>> {
    const p = params as any;
    if (method === "configRequirements/read")
      return {
        requirements: this.denied
          ? {
              allowedApprovalPolicies: ["on-request"],
              allowedApprovalsReviewers: ["user"],
              allowedSandboxModes: ["workspace-write"],
            }
          : null,
      } as any;
    if (method === "thread/resume" && this.failResume)
      throw Error("synthetic resume failure");
    const result = (await super.call(method, params)) as any;
    if (method === "thread/resume") {
      result.modelProvider = p.modelProvider;
      result.thread.modelProvider = p.modelProvider;
      if (this.restoredModel) result.model = this.restoredModel;
    }
    return result;
  }
}
async function fixture(fn: (f: any) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), "newbot-runtime-contract-")),
    codex = new RuntimeCodex(),
    origin = "http://127.0.0.1:3100";
  const options = {
    providerRuntime: null,
    directory,
    cwd: join(directory, "work"),
    codex,
    password: "runtime-test-login",
    origins: [origin],
  };
  let ctx = await createServer(options);
  const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "runtime-test-login" },
    }),
    headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
  const post = (url: string, payload: object) =>
    ctx.app.inject({ method: "POST", url, headers, payload });
  try {
    const f = {
      ...ctx,
      codex,
      headers,
      post,
      run: (payload = {}) =>
        post("/api/agent/run", {
          text: "test",
          requestId: randomUUID(),
          ...payload,
        }),
      action: (payload: object) => post("/api/agent/action", payload),
      async restart() {
        await ctx.app.close();
        codex.active.clear();
        codex.loaded.clear();
        ctx = await createServer(options);
        Object.assign(f, ctx);
      },
    };
    await fn(f);
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
test("cross-provider session changes preserve native identity and another running task; revisions reject stale updates", async () =>
  fixture(async (f) => {
    const first = (await f.run()).json();
    f.codex.finish(first.threadId);
    const other = (await f.run()).json();
    const update = await f.action({
      action: "session/update",
      threadId: first.threadId,
      expectedRevision: 0,
      provider: "secondary",
      model: "fixture-model",
      effort: "medium",
      approval: "full",
    });
    assert.equal(update.statusCode, 200, update.body);
    assert.equal(update.json().revision, 1);
    assert.equal(f.codex.restarts, 0);
    assert.deepEqual(f.codex.unloaded, [first.threadId]);
    assert.ok(f.codex.active.has(other.threadId));
    assert.equal(f.db.list().length, 2);
    assert.equal(f.db.provider(first.threadId), "secondary");
    const stale = await f.action({
      action: "session/update",
      threadId: first.threadId,
      expectedRevision: 0,
      approval: "ask",
    });
    assert.equal(stale.statusCode, 400);
    const denied = await f.run({
      threadId: first.threadId,
      runtimeRevision: 0,
    });
    assert.equal(denied.statusCode, 400);
    assert.equal(
      f.codex.calls.filter((c: any) => c.method === "turn/start").length,
      2,
    );
    f.codex.finish(other.threadId);
    const next = await f.run({
      threadId: first.threadId,
      provider: "secondary",
      runtimeRevision: 1,
    });
    assert.equal(next.statusCode, 200, next.body);
    const call = f.codex.calls
      .filter((c: any) => c.method === "turn/start")
      .at(-1);
    assert.equal(call.params.approvalPolicy, "never");
    assert.equal(call.params.sandboxPolicy.type, "dangerFullAccess");
    const context = f.db.raw
      .prepare("SELECT context FROM run_context WHERE request_id=?")
      .get(next.json().requestId);
    assert.equal(JSON.parse(context.context).provider, "secondary");
  }));
test("active choices are saved without altering pending approval; failed application preserves intent and confirmed binding", async () =>
  fixture(async (f) => {
    const first = (await f.run()).json();
    f.codex.approvals.set(501, {
      id: 501,
      method: "item/commandExecution/requestApproval",
      params: { threadId: first.threadId },
    });
    const saved = await f.action({
      action: "session/update",
      threadId: first.threadId,
      expectedRevision: 0,
      approval: "full",
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.equal(saved.json().pending.state, "pending");
    assert.equal(saved.json().applied.approval, "ask");
    assert.ok(f.codex.approvals.has(501));
    assert.equal(
      f.codex.calls.filter((c: any) => c.method === "thread/settings/update")
        .length,
      0,
    );
    f.codex.finish(first.threadId);
    f.codex.approvals.clear();
    f.codex.denied = true;
    const denied = await f.action({
      action: "session/update",
      threadId: first.threadId,
      expectedRevision: 1,
      approval: "full",
    });
    assert.equal(denied.statusCode, 400);
    f.codex.denied = false;
    f.codex.failResume = true;
    const failed = await f.action({
      action: "session/update",
      threadId: first.threadId,
      expectedRevision: 1,
      provider: "secondary",
      model: "fixture-model",
    });
    assert.equal(failed.statusCode, 200, failed.body);
    assert.equal(failed.json().pending.state, "failed");
    assert.equal(failed.json().provider, "secondary");
    assert.equal(f.db.provider(first.threadId), "fixture");
    const count = f.codex.calls.filter(
      (c: any) => c.method === "turn/start",
    ).length;
    assert.equal((await f.run({ threadId: first.threadId })).statusCode, 400);
    assert.equal(
      f.codex.calls.filter((c: any) => c.method === "turn/start").length,
      count,
    );
    f.codex.failResume = false;
    const cancelled = await f.action({
      action: "session/update",
      threadId: first.threadId,
      expectedRevision: 2,
      cancel: true,
    });
    assert.equal(cancelled.statusCode, 200, cancelled.body);
    assert.equal(cancelled.json().pending, undefined);
    assert.equal(cancelled.json().approval, "ask");
    assert.equal(cancelled.json().revision, 3);
  }));
test("session settings survive restart and model catalog discovery is not reported as verified compatibility", async () =>
  fixture(async (f) => {
    const first = (await f.run()).json();
    f.codex.finish(first.threadId);
    const update = await f.action({
      action: "session/update",
      threadId: first.threadId,
      expectedRevision: 0,
      approval: "review",
    });
    assert.equal(update.statusCode, 200, update.body);
    const read = await f.app.inject({
      url: "/api/threads/" + first.threadId,
      headers: f.headers,
    });
    assert.equal(read.json().runtime.approval, "review");
    const entries = (await f.action({ action: "gateway/catalog" })).json();
    assert.equal(
      entries.find((g: any) => g.id === "secondary").models[0].compatibility,
      "unverified",
    );
    const a = approvalParameters("review", "/workspace");
    assert.equal(a.approvalsReviewer, "auto_review");
    assert.equal(a.sandboxPolicy.type, "workspaceWrite");
  }));

test("independent Codex does not inherit the launching agent's tool pipe, identity or Bridge secrets", () => {
  const env = codexEnvironment({
    CODEX_APP_TOOLS_PIPE_PATH: "private-parent-pipe",
    CODEX_SESSION_ID: "parent",
    CODEX_THREAD_ID: "parent-thread",
    ADMIN_PASSWORD: "private-login",
    NEWBOT_CREDENTIAL_KEY_V1: "private-master",
    CODEX_HOME: "dedicated-home",
    CODEX_API_KEY: "configured-provider-key",
    PATH: "/bin",
  });
  assert.deepEqual(env, {
    CODEX_HOME: "dedicated-home",
    CODEX_API_KEY: "configured-provider-key",
    PATH: "/bin",
  });
});

test("a managed policy change blocks a previously saved full-access session before dispatch", async () =>
  fixture(async (f) => {
    const first = (await f.run()).json();
    f.codex.finish(first.threadId);
    assert.equal(
      (
        await f.action({
          action: "session/update",
          threadId: first.threadId,
          expectedRevision: 0,
          approval: "full",
        })
      ).statusCode,
      200,
    );
    f.codex.denied = true;
    const before = f.codex.calls.filter(
      (c: any) => c.method === "turn/start",
    ).length;
    const result = await f.run({
      threadId: first.threadId,
      runtimeRevision: 1,
    });
    assert.equal(result.statusCode, 400, result.body);
    assert.equal(
      f.codex.calls.filter((c: any) => c.method === "turn/start").length,
      before,
    );
  }));

test("legacy sessions recover the native saved model instead of adopting a changed global default", async () =>
  fixture(async (f) => {
    const first = (await f.run()).json();
    f.codex.finish(first.threadId);
    f.db.raw
      .prepare("DELETE FROM session_runtime WHERE thread_id=?")
      .run(first.threadId);
    f.codex.loaded.delete(first.threadId);
    f.codex.restoredModel = "native-legacy-model";
    f.codex.config.model = "different-global-default";
    const response = await f.action({
      action: "thread/resume",
      threadId: first.threadId,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().runtime.model, "native-legacy-model");
    assert.equal(response.json().runtime.approval, "ask");
    assert.equal(f.codex.restarts, 0);
    assert.equal(
      f.codex.calls.filter((c: any) => c.method === "turn/start").length,
      1,
    );
  }));

test("reading legacy history uses saved native metadata without restoring the execution environment", async () =>
  fixture(async (f) => {
    const first = (await f.run()).json();
    f.codex.finish(first.threadId);
    f.db.raw
      .prepare(
        "UPDATE session_runtime SET revision=3,model='',effort='',approval='review' WHERE thread_id=?",
      )
      .run(first.threadId);
    f.codex.loaded.delete(first.threadId);
    Object.assign(f.codex.threads.get(first.threadId), {
      model: "saved-native-model",
      reasoningEffort: "high",
    });
    f.codex.failResume = true;
    const before = f.codex.calls.filter(
      (c: any) => c.method === "thread/resume",
    ).length;
    const response = await f.app.inject({
      url: "/api/threads/" + first.threadId,
      headers: f.headers,
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().runtime.model, "saved-native-model");
    assert.equal(response.json().runtime.effort, "high");
    assert.equal(response.json().runtime.revision, 3);
    assert.equal(response.json().runtime.approval, "review");
    assert.equal(
      f.codex.calls.filter((c: any) => c.method === "thread/resume").length,
      before,
    );
  }));

test("latest candidate survives restart and changes only the next native turn", async () =>
  fixture(async (f) => {
    const first = (await f.run()).json(),
      id = first.threadId;
    const firstCall = structuredClone(
      f.codex.calls.filter((c: any) => c.method === "turn/start").at(-1),
    );
    for (const [revision, effort] of [
      [0, "low"],
      [1, "high"],
    ] as const) {
      const r = await f.action({
        action: "session/update",
        threadId: id,
        expectedRevision: revision,
        provider: "secondary",
        model: "fixture-model",
        effort,
        approval: "review",
      });
      assert.equal(r.statusCode, 200, r.body);
      assert.equal(r.json().pending.state, "pending");
    }
    assert.equal(f.codex.unloaded.length, 0);
    assert.deepEqual(
      f.codex.calls.filter((c: any) => c.method === "turn/start").at(-1),
      firstCall,
    );
    f.codex.finish(id);
    await f.restart();
    assert.equal(f.service.runtimeSettings.get(id).effort, "high");
    assert.equal(f.service.runtimeSettings.applied(id).provider, "fixture");
    const next = await f.run({ threadId: id, runtimeRevision: 2 });
    assert.equal(next.statusCode, 200, next.body);
    assert.equal(next.json().threadId, id);
    const call = f.codex.calls
      .filter((c: any) => c.method === "turn/start")
      .at(-1);
    assert.equal(call.params.effort, "high");
    assert.equal(call.params.approvalsReviewer, "auto_review");
    assert.equal(f.service.runtimeSettings.get(id).pending, undefined);
    assert.equal(f.service.runtimeSettings.applied(id).provider, "secondary");
    const before = JSON.parse(
      f.db.raw
        .prepare("SELECT context FROM run_context WHERE request_id=?")
        .get(first.requestId).context,
    );
    assert.equal(before.approval, "ask");
    assert.equal(before.provider, "fixture");
  }));

test("competing saves use CAS after asynchronous validation", async () =>
  fixture(async (f) => {
    const first = (await f.run()).json();
    const results = await Promise.all(
      ["low", "high"].map((effort) =>
        f.action({
          action: "session/update",
          threadId: first.threadId,
          expectedRevision: 0,
          effort,
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 400]);
    assert.equal(f.service.runtimeSettings.get(first.threadId).revision, 1);
    assert.equal(
      f.codex.calls.filter((c: any) => c.method === "thread/settings/update")
        .length,
      0,
    );
  }));

test("an edit arriving during native application is retained for the following turn", async () =>
  fixture(async (f) => {
    const first = (await f.run()).json(),
      id = first.threadId;
    f.codex.finish(id);
    const original = f.codex.call.bind(f.codex);
    let release!: () => void, entered!: () => void;
    const ready = new Promise<void>((resolve) => (entered = resolve)),
      gate = new Promise<void>((resolve) => (release = resolve));
    let blocked = false;
    f.codex.call = async (method: any, params: any) => {
      if (method === "thread/settings/update" && !blocked) {
        blocked = true;
        entered();
        await gate;
      }
      return original(method, params);
    };
    const older = f.action({
      action: "session/update",
      threadId: id,
      expectedRevision: 0,
      effort: "low",
    });
    await ready;
    const newer = await f.action({
      action: "session/update",
      threadId: id,
      expectedRevision: 1,
      effort: "high",
    });
    assert.equal(newer.statusCode, 200, newer.body);
    release();
    await older;
    const saved = f.service.runtimeSettings.get(id);
    assert.equal(saved.effort, "high");
    assert.equal(saved.applied.effort, "low");
    assert.equal(saved.pending.state, "pending");
    assert.equal(
      (await f.run({ threadId: id, runtimeRevision: 2 })).statusCode,
      200,
    );
    assert.equal(
      f.codex.calls.filter((c: any) => c.method === "turn/start").at(-1).params
        .effort,
      "high",
    );
  }));
