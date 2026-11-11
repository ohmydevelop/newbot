import { EventType, type Event } from "@ag-ui/core";
import type { Store } from "./db.js";
import type { Thread, Json } from "../shared/types.js";
import type {
  ActivityState,
  ThreadActivity,
  WaitingSummary,
} from "../shared/thread-activity.js";
type Row = {
  thread_id: string;
  state: ActivityState;
  turn_id: string | null;
  request_id: string | null;
  revision: number;
  updated: number;
  seen_revision: number;
  recent: string;
};
const active = new Set<ActivityState>(["preparing", "running", "waiting"]);
/** Lightweight durable lifecycle, independent of run dispatch acknowledgements and chat history. */
export function threadActivity(db: Store, publish: (event: Event) => void) {
  const approvals = new Map<
    string,
    {
      threadId: string;
      turnId: string;
      reason: "approval" | "input";
      target: WaitingSummary["target"];
    }
  >();
  const pending = (id: string, turn?: string | null) =>
    [...approvals.values()].filter(
      (a) => a.threadId === id && a.turnId === turn,
    );
  const savedWaiting = (id: string) =>
    (
      db.raw
        .prepare("SELECT summary FROM thread_waits WHERE thread_id=?")
        .get(id) as { summary: string } | undefined
    )?.summary || "";
  function summary(
    id: string,
    turn?: string | null,
  ): WaitingSummary | undefined {
    const rows = pending(id, turn);
    if (!rows.length) return;
    return {
      reason: rows.every((r) => r.reason === rows[0].reason)
        ? rows[0].reason
        : "mixed",
      count: rows.length,
      target: rows[0].target,
    };
  }
  const get = (id: string) =>
    db.raw
      .prepare("SELECT * FROM thread_activity WHERE thread_id=?")
      .get(id) as Row | undefined;
  const view = (r: Row): ThreadActivity => ({
    state: r.state,
    turnId: r.turn_id,
    revision: r.revision,
    updated: r.updated,
    seenRevision: r.seen_revision,
    ...(savedWaiting(r.thread_id)
      ? { waiting: JSON.parse(savedWaiting(r.thread_id)) }
      : {}),
  });
  const emit = (r: Row) =>
    publish({
      type: EventType.CUSTOM,
      name: "newbot.activity",
      value: { threadId: r.thread_id, activity: view(r) },
    });
  function write(
    id: string,
    state: ActivityState,
    turnId?: string | null,
    requestId?: string | null,
  ) {
    if (!db.owns(id)) return;
    const old = get(id);
    const waiting =
      state === "waiting"
        ? summary(id, turnId === undefined ? old?.turn_id : turnId)
        : undefined;
    const encoded = waiting ? JSON.stringify(waiting) : "";
    if (
      old &&
      old.state === state &&
      savedWaiting(id) === encoded &&
      (turnId === undefined || turnId === old.turn_id) &&
      (requestId === undefined || requestId === old.request_id)
    )
      return;
    const previous: string[] = old ? JSON.parse(old.recent) : [];
    if (
      old?.turn_id &&
      old.turn_id !== turnId &&
      turnId !== undefined &&
      !previous.includes(old.turn_id)
    )
      previous.push(old.turn_id);
    db.raw
      .prepare(
        `INSERT INTO thread_activity(thread_id,state,turn_id,request_id,revision,updated,seen_revision,recent) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(thread_id) DO UPDATE SET state=excluded.state,turn_id=excluded.turn_id,request_id=excluded.request_id,revision=excluded.revision,updated=excluded.updated,recent=excluded.recent`,
      )
      .run(
        id,
        state,
        turnId === undefined ? old?.turn_id || null : turnId,
        requestId === undefined ? old?.request_id || null : requestId,
        (old?.revision || 0) + 1,
        Date.now(),
        old?.seen_revision || 0,
        JSON.stringify(previous.slice(-32)),
      );
    if (encoded)
      db.raw
        .prepare("INSERT OR REPLACE INTO thread_waits VALUES(?,?)")
        .run(id, encoded);
    else db.raw.prepare("DELETE FROM thread_waits WHERE thread_id=?").run(id);
    emit(get(id)!);
  }
  function prepare(id: string, requestId: string) {
    const old = get(id);
    if (old && active.has(old.state)) return;
    write(id, "preparing", null, requestId);
  }
  function rejected(id: string, requestId: string, dispatched: boolean) {
    const r = get(id);
    if (r?.request_id === requestId && r.state === "preparing")
      write(id, dispatched ? "unknown" : "failed");
  }
  function notification(message: { method: string; params: any }) {
    const p = message.params,
      id = p.threadId || p.thread?.id,
      turn = p.turnId || p.turn?.id;
    if (!id || !db.owns(id)) return;
    const old = get(id);
    if (message.method === "turn/started") {
      if (!turn || (old && JSON.parse(old.recent).includes(turn))) return;
      if (
        old &&
        old.turn_id === turn &&
        !active.has(old.state) &&
        old.state !== "unknown"
      )
        return;
      if (old?.turn_id !== turn) clear(id);
      write(id, pending(id, turn).length ? "waiting" : "running", turn);
      return;
    }
    if (message.method === "turn/completed") {
      if (old?.turn_id !== turn) return;
      const status = p.turn.status;
      if (["completed", "failed", "interrupted"].includes(status)) {
        clear(id);
        write(id, status, turn);
      }
    }
    if (message.method === "error" && !p.willRetry && old?.turn_id === turn) {
      clear(id);
      write(id, "failed", turn);
    }
  }
  function clear(threadId: string, kind?: "a2ui") {
    for (const [key, row] of approvals)
      if (row.threadId === threadId && (!kind || row.target.kind === kind))
        approvals.delete(key);
  }
  function approval(
    id: string | number,
    params: Json,
    method = "requestApproval",
  ) {
    const r = get(params.threadId);
    if (
      r &&
      ["running", "waiting"].includes(r.state) &&
      (!params.turnId || params.turnId === r.turn_id)
    ) {
      approvals.set(`native:${id}`, {
        threadId: params.threadId,
        turnId: r.turn_id!,
        reason: /requestUserInput|elicitation/.test(method)
          ? "input"
          : "approval",
        target: { kind: "approval", id: String(id) },
      });
      write(params.threadId, "waiting");
    }
  }
  function resolved(id: string | number) {
    const item = approvals.get(`native:${id}`);
    approvals.delete(`native:${id}`);
    if (!item) return;
    const r = get(item.threadId);
    if (r?.state === "waiting")
      write(
        item.threadId,
        pending(item.threadId, r.turn_id).length ? "waiting" : "running",
      );
  }
  function uiWaiting(threadId: string, rows: { id: string; turnId: string }[]) {
    clear(threadId, "a2ui");
    const r = get(threadId);
    if (!r || !["running", "waiting"].includes(r.state)) return;
    for (const row of rows)
      if (row.turnId === r.turn_id)
        approvals.set(`a2ui:${row.id}`, {
          threadId,
          turnId: row.turnId,
          reason: "input",
          target: { kind: "a2ui", id: row.id },
        });
    write(
      threadId,
      pending(threadId, r.turn_id).length ? "waiting" : "running",
    );
  }
  function offline() {
    approvals.clear();
    for (const r of db.raw
      .prepare(
        "SELECT * FROM thread_activity WHERE state IN ('preparing','running','waiting')",
      )
      .all() as Row[])
      write(r.thread_id, "unknown");
  }
  function reconcile(
    thread: Thread,
    loadedActive: boolean,
    markRead = false,
    observedRevision?: number,
  ) {
    const old = get(thread.id),
      last = thread.turns.at(-1);
    if (
      observedRevision !== undefined &&
      observedRevision !== (old?.revision || 0)
    )
      return;
    if (
      old?.state !== "preparing" &&
      last &&
      (!old?.turn_id ||
        old.turn_id === last.id ||
        !JSON.parse(old.recent).includes(last.id))
    ) {
      if (["completed", "failed", "interrupted"].includes(last.status)) {
        clear(thread.id);
        write(thread.id, last.status as ActivityState, last.id);
      } else if (last.status === "inProgress") {
        const waiting = pending(thread.id, last.id).length > 0;
        write(
          thread.id,
          loadedActive ? (waiting ? "waiting" : "running") : "unknown",
          last.id,
        );
      }
    }
    if (markRead) {
      const r = get(thread.id);
      if (r && r.state === "completed" && r.seen_revision < r.revision) {
        db.raw
          .prepare(
            "UPDATE thread_activity SET seen_revision=revision WHERE thread_id=?",
          )
          .run(thread.id);
        emit(get(thread.id)!);
      }
    }
  }
  function snapshot(): Event {
    return {
      type: EventType.CUSTOM,
      name: "newbot.activity.snapshot",
      value: (
        db.raw
          .prepare(
            "SELECT a.* FROM thread_activity a JOIN threads t ON t.id=a.thread_id WHERE t.archived=0",
          )
          .all() as Row[]
      ).map((r) => ({ threadId: r.thread_id, activity: view(r) })),
    };
  }
  return {
    revision: (id: string) => get(id)?.revision || 0,
    prepare,
    rejected,
    notification,
    approval,
    uiWaiting,
    resolved,
    offline,
    reconcile,
    snapshot,
  };
}
