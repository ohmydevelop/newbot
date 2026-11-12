import type { Store } from "./db.js";
import type { Failure } from "../shared/failure.js";
import type { Thread } from "../shared/types.js";
import { publicFailure } from "./failure.js";

const key = (thread: string, turn: string) => `turn-failure:${thread}:${turn}`;
export function retainedFailure(
  next: Failure,
  previous?: Failure | null,
): Failure {
  return next.category === "unknown" &&
    previous?.category &&
    previous.category !== "unknown"
    ? { ...previous, retrying: next.retrying }
    : next;
}
export function captureFailure(db: Store, method: string, p: any) {
  const threadId = p.threadId,
    turnId = p.turnId || p.turn?.id;
  if (!threadId || !turnId || !db.owns(threadId)) return;
  const id = key(threadId, turnId);
  if (method === "turn/completed" && p.turn.status !== "failed") {
    db.raw.prepare("DELETE FROM metadata WHERE key=?").run(id);
  } else if (
    method === "error" ||
    (method === "turn/completed" && p.turn.status === "failed")
  ) {
    const prior = db.get(id);
    const next = retainedFailure(
      publicFailure(
        p.turn?.error || p.error,
        method === "error" && p.willRetry === true,
      ),
      prior ? JSON.parse(prior) : null,
    );
    db.set(id, JSON.stringify(next));
  }
}
export function restoreFailures(db: Store, thread: Thread) {
  for (const turn of thread.turns) {
    if (turn.status !== "failed") continue;
    const saved = db.get(key(thread.id, turn.id));
    if (saved)
      turn.error = {
        ...retainedFailure(
          turn.error || publicFailure(null),
          JSON.parse(saved),
        ),
        retrying: false,
      };
  }
}
