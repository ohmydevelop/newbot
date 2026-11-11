class JsonResponse extends Response {
  constructor(body: BodyInit | null, init?: ResponseInit) {
    super(body, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  }
}
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { EventType, type Event } from "@ag-ui/core";
import type { Thread } from "../shared/types.js";
import { turnFeedback } from "../web/chat-presentation.js";
const prior = new Map(
  ["window", "localStorage", "sessionStorage", "fetch"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) || null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
Object.assign(globalThis, {
  window: { innerWidth: 1280 },
  localStorage: storage(),
  sessionStorage: storage(),
});
const { useApp, consume, loadThread, disconnect } = await import(
  "../web/store.js"
);
after(() => {
  for (const [key, descriptor] of prior) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});
function thread(id = "selected"): Thread {
  return { id, turns: [{ id: "turn", status: "inProgress", items: [] }] };
}
function reset() {
  disconnect();
  useApp.setState({
    selectedId: "selected",
    thread: thread(),
    loading: false,
    error: "",
    backgroundFailure: null,
  });
  globalThis.fetch = (async () =>
    new JsonResponse("[]", {
      headers: { "content-type": "application/json" },
    })) as any;
}
const failure = (id = "selected", runId = "turn"): Event => ({
  type: EventType.RUN_ERROR,
  message: "任务失败，请检查配置",
  code: "CODEX_TURN_FAILED",
  metadata: { threadId: id, runId, revision: 20 },
});
test("selected turn owns its failure without duplicating or replacing an independent operation error", () => {
  reset();
  useApp.setState({ error: "附件上传失败" });
  consume(failure());
  const s = useApp.getState();
  assert.equal(s.thread!.turns[0].status, "failed");
  assert.equal(s.error, "附件上传失败");
  assert.equal(s.backgroundFailure, null);
  assert.equal(turnFeedback(s.thread!.turns[0])?.text, "本次任务未完成。");
});
test("scoped native notice stays in its running turn and final failure never becomes a global duplicate", () => {
  reset();
  consume({
    type: EventType.CUSTOM,
    name: "newbot.notice",
    value: { message: "请检查任务状态" },
    metadata: { threadId: "selected", runId: "turn", revision: 19 },
  });
  assert.equal(useApp.getState().thread!.turns[0].status, "inProgress");
  assert.equal(useApp.getState().error, "");
  assert.equal(turnFeedback(useApp.getState().thread!.turns[0])?.canRead, true);
  consume(failure());
  assert.equal(useApp.getState().error, "");
  assert.equal(useApp.getState().thread!.turns[0].status, "failed");
});
test("confirmed completion clears a transient task notice while an unscoped notice remains a global operation error", () => {
  reset();
  consume({
    type: EventType.CUSTOM,
    name: "newbot.notice",
    value: { message: "待确认" },
    metadata: { threadId: "selected", runId: "turn", revision: 19 },
  });
  consume({
    type: EventType.RUN_FINISHED,
    threadId: "selected",
    runId: "turn",
    result: { status: "completed" },
    metadata: { threadId: "selected", runId: "turn", revision: 20 },
  });
  assert.equal(turnFeedback(useApp.getState().thread!.turns[0]), null);
  consume({
    type: EventType.CUSTOM,
    name: "newbot.notice",
    value: { message: "配置操作未完成" },
  });
  assert.equal(useApp.getState().error, "配置操作未完成");
});
test("background failure leaves the visible turn alone, offers its own target and does not reappear on replay", () => {
  reset();
  const event = failure("background", "other-turn");
  consume(event);
  assert.equal(useApp.getState().thread!.turns[0].status, "inProgress");
  assert.equal(useApp.getState().error, "");
  assert.equal(useApp.getState().backgroundFailure?.threadId, "background");
  useApp.setState({ backgroundFailure: null });
  consume(event);
  assert.equal(useApp.getState().backgroundFailure, null);
});
test("failure buffered during history loading stays attached to the recovered turn", async () => {
  reset();
  let release!: (v: Response) => void;
  const gate = new Promise<Response>((resolve) => {
    release = resolve;
  });
  globalThis.fetch = (async (url: any) =>
    String(url).includes("/api/threads/selected")
      ? gate
      : new JsonResponse("[]")) as any;
  const loading = loadThread("selected");
  consume(failure());
  release(new JsonResponse(JSON.stringify(thread())));
  await loading;
  assert.equal(useApp.getState().thread!.turns[0].status, "failed");
  assert.equal(useApp.getState().error, "");
  assert.equal(useApp.getState().backgroundFailure, null);
});
test("successful read consumes only the matching background notice and never creates a turn", async () => {
  reset();
  consume(failure("background"));
  const requests: string[] = [];
  globalThis.fetch = (async (url: any) => {
    requests.push(String(url));
    return new JsonResponse(JSON.stringify(thread("background")));
  }) as any;
  await loadThread("background");
  assert.equal(useApp.getState().thread!.id, "background");
  assert.equal(useApp.getState().backgroundFailure, null);
  assert.deepEqual(requests, ["/api/threads/background"]);
});
test("local status read failure preserves the conversation and independent error without emitting a second banner", async () => {
  reset();
  useApp.setState({ error: "附件上传失败" });
  globalThis.fetch = (async () =>
    new JsonResponse('{"error":"读取失败"}', { status: 503 })) as any;
  await assert.rejects(() =>
    loadThread("selected", false, { localError: true }),
  );
  assert.equal(useApp.getState().thread!.id, "selected");
  assert.equal(useApp.getState().error, "附件上传失败");
  assert.equal(useApp.getState().loading, false);
});
test("unscoped run errors remain visible and failed restored turns have the same presentation as live failures", () => {
  reset();
  consume({ type: EventType.RUN_ERROR, message: "未能确认请求状态" });
  assert.equal(useApp.getState().error, "未能确认请求状态");
  const restored = { id: "turn", status: "failed", items: [], error: null };
  assert.deepEqual(
    turnFeedback(restored),
    turnFeedback({ ...restored, error: { message: "任务执行失败" } }),
  );
  assert.equal(turnFeedback({ ...restored, status: "completed" }), null);
});

test("late older-page responses cannot enter a different conversation", async () => {
  reset();
  useApp.setState({
    thread: { ...thread(), historyCursor: "next" },
    olderLoading: false,
    olderError: "",
  });
  let release!: (v: Response) => void;
  const gate = new Promise<Response>((r) => (release = r));
  globalThis.fetch = (async (url: any) =>
    String(url).includes("cursor=")
      ? gate
      : new JsonResponse(JSON.stringify(thread("other")))) as any;
  const { loadOlder } = await import("../web/store.js");
  const page = loadOlder();
  await loadThread("other");
  release(
    new JsonResponse(
      JSON.stringify({
        id: "selected",
        turns: [{ id: "old", status: "completed", items: [] }],
        historyCursor: null,
      }),
    ),
  );
  await page;
  assert.equal(useApp.getState().thread!.id, "other");
  assert.ok(!useApp.getState().thread!.turns.some((t) => t.id === "old"));
  assert.equal(useApp.getState().olderLoading, false);
});
test("older-page failure preserves cursor and retry uses one request per click", async () => {
  reset();
  useApp.setState({
    thread: { ...thread(), historyCursor: "next" },
    olderLoading: false,
    olderError: "",
  });
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return new JsonResponse("{}", { status: 503 });
  }) as any;
  const { loadOlder } = await import("../web/store.js");
  await Promise.all([loadOlder(), loadOlder()]);
  assert.equal(requests, 1);
  assert.equal(useApp.getState().thread!.historyCursor, "next");
  assert.ok(useApp.getState().olderError);
  globalThis.fetch = (async () =>
    new JsonResponse(
      JSON.stringify({
        id: "selected",
        turns: [{ id: "old", status: "completed", items: [] }],
        historyCursor: null,
      }),
    )) as any;
  await loadOlder();
  assert.equal(useApp.getState().thread!.turns[0].id, "old");
  assert.equal(useApp.getState().olderError, "");
});
test("an older thread-list request cannot undo a newer rename/archive refresh", async () => {
  reset();
  let release!: (v: Response) => void,
    calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (calls === 1) return new Promise<Response>((r) => (release = r));
    return new JsonResponse(
      JSON.stringify([{ id: "latest", title: "renamed" }]),
    );
  }) as any;
  const { loadThreads } = await import("../web/store.js");
  const old = loadThreads();
  await loadThreads();
  release(new JsonResponse(JSON.stringify([{ id: "archived", title: "old" }])));
  await old;
  assert.equal(useApp.getState().threads[0].id, "latest");
});

test("concurrent submissions from one draft reserve only one execution", async () => {
  reset();
  useApp.setState({ pendingRuns: {} });
  const { submitRun } = await import("../web/store.js");
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return new JsonResponse(
      JSON.stringify({ threadId: "selected", turn: { id: "one-turn" } }),
    );
  }) as any;
  const results = await Promise.allSettled([
    submitRun({ threadId: "selected", text: "same" }),
    submitRun({ threadId: "selected", text: "same" }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(calls, 1);
});

test("a late submission response cannot clear the next pending request after explicit recovery", async () => {
  reset();
  const { submitRun, clearPendingRun } = await import("../web/store.js");
  clearPendingRun();
  let release!: (v: Response) => void;
  const gate = new Promise<Response>((r) => (release = r));
  globalThis.fetch = (async () => gate) as any;
  const pending = submitRun({ threadId: "selected", text: "original" });
  while (!useApp.getState().pendingRun)
    await new Promise((r) => setImmediate(r));
  const old = useApp.getState().pendingRun!;
  clearPendingRun(old);
  useApp.setState({
    pendingRuns: {
      "next-request": {
        id: "next-request",
        origin: "selected",
        fingerprint: "next-fingerprint",
        state: "unknown",
      },
    },
  });
  release(
    new JsonResponse(
      JSON.stringify({ threadId: "old-thread", turn: { id: "old-turn" } }),
    ),
  );
  await pending;
  assert.equal(useApp.getState().pendingRun, "next-request");
  assert.equal(
    JSON.parse(sessionStorage.getItem("ma_pending_runs")!)["next-request"]
      .fingerprint,
    "next-fingerprint",
  );
  clearPendingRun();
});
