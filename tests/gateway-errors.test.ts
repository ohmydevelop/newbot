import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicFailure } from "../server/failure.js";
import { captureFailure, restoreFailures } from "../server/failure-store.js";
import { database } from "../server/db.js";
import { publicTurn } from "../server/view.js";
import { AgentEvents } from "../server/ag-ui.js";
import { turnFeedback } from "../web/chat-presentation.js";
import { liveSettingsError, nativeRequestError } from "../server/codex.js";
import type { Thread } from "../shared/types.js";

const native = (message: string, status = 429) => ({
  message,
  codexErrorInfo: { httpConnectionFailed: { httpStatusCode: status } },
  additionalDetails:
    "Authorization: Bearer secret-request; https://private.invalid/key",
  misalignment: null,
});
test("billing, quota, rate, permission and authorization preserve different remedies without leaking provider text", () => {
  for (const [error, category] of [
    [native("insufficient_balance secret-balance", 403), "billing"],
    [native("insufficient_quota"), "quota"],
    [native("busy"), "rate_limit"],
    [native("rejected", 403), "permission"],
    [native("rejected", 401), "authentication"],
    [native("rejected", 502), "upstream"],
    [native("rejected", 402), "billing"],
    [{ message: "unexpected status 402 Payment Required" }, "billing"],
    [{ message: "quota", codexErrorInfo: "usageLimitExceeded" }, "quota"],
    [
      { message: "context", codexErrorInfo: "contextWindowExceeded" },
      "context",
    ],
    [
      {
        message: "secret https://user:password@example.com",
        codexErrorInfo: { "secret-code": {} },
      },
      "unknown",
    ],
  ] as const) {
    const result = publicFailure(error);
    assert.equal(result.category, category);
    assert.doesNotMatch(
      JSON.stringify(result),
      /secret|Bearer|private.invalid|password|user:/,
    );
    assert.ok(result.action);
  }
  assert.doesNotMatch(publicFailure(native("busy")).message, /欠费|余额/);
});

test("retry cause remains visible, terminal missing cause retains it, completion clears it and history projects identically", () => {
  const events = new AgentEvents();
  events.seed({
    id: "thread",
    turns: [{ id: "turn", status: "inProgress", items: [] }],
  });
  events.notification({
    method: "error",
    params: {
      threadId: "thread",
      turnId: "turn",
      error: native("insufficient_balance", 403),
      willRetry: true,
    },
  } as any);
  const retry = events.threads.get("thread")!.turns[0];
  assert.equal(retry.status, "inProgress");
  assert.equal(retry.error?.category, "billing");
  assert.match(turnFeedback(retry)!.action!, /自动重试/);
  events.notification({
    method: "turn/completed",
    params: {
      threadId: "thread",
      turn: { id: "turn", status: "failed", error: null },
    },
  } as any);
  const failed = events.threads.get("thread")!.turns[0];
  assert.equal(failed.status, "failed");
  assert.equal(failed.error?.category, "billing");
  assert.ok(!failed.error?.retrying);
  assert.equal(
    turnFeedback(failed)?.text,
    publicTurn({
      id: "turn",
      status: "failed",
      items: [],
      error: native("insufficient_balance", 403),
    } as any).error?.message,
  );
  events.notification({
    method: "turn/completed",
    params: { threadId: "thread", turn: { id: "turn", status: "completed" } },
  } as any);
  assert.equal(events.threads.get("thread")!.turns[0].error, null);
});

test("safe diagnostics survive database restart, remain turn scoped and clear on success", () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-errors-"));
  let db = database(dir);
  try {
    db.raw
      .prepare(
        "INSERT INTO threads(id,title,provider,updated) VALUES (?,?,?,?)",
      )
      .run("thread", "test", "test", Date.now());
    captureFailure(db, "error", {
      threadId: "thread",
      turnId: "turn",
      error: native("insufficient_balance", 403),
      willRetry: true,
    });
    captureFailure(db, "turn/completed", {
      threadId: "thread",
      turn: { id: "turn", status: "failed", error: null },
    });
    db.raw.close();
    db = database(dir);
    const thread: Thread = {
      id: "thread",
      turns: [
        { id: "turn", status: "failed", items: [] },
        { id: "other", status: "failed", items: [] },
      ],
    };
    restoreFailures(db, thread);
    assert.equal(thread.turns[0].error?.category, "billing");
    assert.equal(thread.turns[0].error?.retrying, false);
    assert.equal(thread.turns[1].error, undefined);
    assert.doesNotMatch(
      db.get("turn-failure:thread:turn")!,
      /secret|Bearer|https/,
    );
    captureFailure(db, "turn/completed", {
      threadId: "thread",
      turn: { id: "turn", status: "completed" },
    });
    assert.ok(!db.get("turn-failure:thread:turn"));
  } finally {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("live switch rejects missing current or destination metadata with distinct actions, without removing guard", () => {
  assert.match(
    liveSettingsError("the active model has only fallback metadata"),
    /当前任务/,
  );
  assert.match(
    liveSettingsError("the destination model has only fallback metadata"),
    /目标模型/,
  );
  assert.match(
    liveSettingsError("the destination model has only fallback metadata"),
    /聊天与工具/,
  );
  assert.doesNotMatch(liveSettingsError("Bearer secret"), /secret/);
});

test("catalog and connection probes preserve safe billing/status diagnostics for JSON, HTML and oversize failures", async () => {
  const { boundedJson } = await import("../server/providers.js");
  for (const [body, status, type, expected] of [
    [
      JSON.stringify({
        error: { message: "insufficient_balance Bearer secret", code: "x" },
      }),
      403,
      "application/json",
      /余额/,
    ],
    ["<html>secret proxy page</html>", 502, "text/html", /HTTP 502/],
    ["secret".repeat(6000), 401, "application/json", /认证失败/],
  ] as const) {
    await assert.rejects(
      boundedJson(
        new Response(body, { status, headers: { "content-type": type } }),
      ),
      (e: Error) => {
        assert.match(e.message, expected);
        assert.doesNotMatch(e.message, /secret|Bearer|html/);
        return true;
      },
    );
  }
});

test("confirmed cancellation clears a retry diagnostic instead of asking to confirm stopped state", () => {
  const events = new AgentEvents();
  events.seed({
    id: "t",
    turns: [{ id: "r", status: "inProgress", items: [] }],
  });
  events.notification({
    method: "error",
    params: {
      threadId: "t",
      turnId: "r",
      error: native("busy"),
      willRetry: true,
    },
  } as any);
  events.notification({
    method: "turn/completed",
    params: { threadId: "t", turn: { id: "r", status: "interrupted" } },
  } as any);
  assert.equal(events.threads.get("t")!.turns[0].error, null);
  assert.equal(
    turnFeedback(events.threads.get("t")!.turns[0])?.text,
    "你已停止本次回答",
  );
});

test("model request failures are actionable without inventing turn diagnostics or mislabeling MCP auth as model gateway auth", () => {
  assert.match(
    nativeRequestError("turn/start", native("insufficient_balance", 403)),
    /余额/,
  );
  assert.doesNotMatch(
    nativeRequestError("turn/start", { message: "secret" }),
    /展开|secret/,
  );
  assert.doesNotMatch(
    nativeRequestError("mcpServer/tool/call", native("unauthorized", 401)),
    /网关|secret/,
  );
});
