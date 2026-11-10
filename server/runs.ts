import { PublicError } from "./public-error.js";
import { randomUUID } from "node:crypto";
import { hash, type Store } from "./db.js";
import type { Json } from "../shared/types.js";
export type Run = {
  request_id: string;
  fingerprint: string;
  state: string;
  thread_id: string | null;
  turn_id: string | null;
  client_message_id: string;
  created: number;
  updated: number;
};
export function runStore(db: Store) {
  function get(id: string) {
    return db.raw.prepare("SELECT * FROM runs WHERE request_id=?").get(id) as
      | Run
      | undefined;
  }
  return {
    get,
    abandon(id: string) {
      const prior = get(id);
      if (prior) return prior;
      const now = Date.now();
      db.raw
        .prepare("INSERT INTO runs VALUES(?,?,'abandoned',NULL,NULL,?,?,?)")
        .run(id, "abandoned", randomUUID(), now, now);
      return get(id)!;
    },
    reserve(requestId: string, payload: Json) {
      const fingerprint = hash(
        JSON.stringify({ ...payload, requestId: undefined }),
      );
      const old = get(requestId);
      if (old && old.fingerprint !== fingerprint)
        throw new PublicError("同一 requestId 不能用于不同的请求");
      if (old) return { run: old, fresh: false };
      const now = Date.now();
      db.raw
        .prepare("INSERT INTO runs VALUES(?,?,'reserved',?,NULL,?,?,?)")
        .run(
          requestId,
          fingerprint,
          payload.threadId || null,
          randomUUID(),
          now,
          now,
        );
      return { run: get(requestId)!, fresh: true };
    },
    update(id: string, state: string, threadId?: string, turnId?: string) {
      db.raw
        .prepare(
          "UPDATE runs SET state=?,thread_id=COALESCE(?,thread_id),turn_id=COALESCE(?,turn_id),updated=? WHERE request_id=?",
        )
        .run(state, threadId || null, turnId || null, Date.now(), id);
    },
    view(run: Run): Json {
      return {
        requestId: run.request_id,
        state: run.state,
        threadId: run.thread_id,
        clientUserMessageId: run.client_message_id,
        ...(run.turn_id ? { turn: { id: run.turn_id } } : {}),
      };
    },
  };
}
