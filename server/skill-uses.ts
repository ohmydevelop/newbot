import type { Store } from "./db.js";
import type { SkillReference, Thread } from "../shared/types.js";
export function skillUses(db: Store) {
  function unbind(requestId: string) {
    db.raw.prepare("DELETE FROM run_skills WHERE request_id=?").run(requestId);
  }
  function bind(requestId: string, refs: SkillReference[]) {
    db.raw.exec("BEGIN IMMEDIATE");
    try {
      unbind(requestId);
      const insert = db.raw.prepare(
        "INSERT INTO run_skills VALUES(?,?,?,?,?,?,?)",
      );
      refs.forEach((r, index) =>
        insert.run(
          requestId,
          index,
          r.id,
          r.name,
          r.displayName,
          r.scope,
          r.sha256,
        ),
      );
      db.raw.exec("COMMIT");
    } catch (error) {
      db.raw.exec("ROLLBACK");
      throw error;
    }
  }
  function decorate(thread: Thread) {
    const rows = db.raw
      .prepare(
        `SELECT r.turn_id,r.client_message_id,s.* FROM runs r JOIN run_skills s ON s.request_id=r.request_id WHERE r.thread_id=? ORDER BY s.position`,
      )
      .all(thread.id) as unknown as (SkillReference & {
      skill_id: string;
      display_name: string;
      turn_id: string | null;
      client_message_id: string;
    })[];
    for (const turn of thread.turns) {
      const first = turn.items.find((i) => i.type === "userMessage");
      for (const item of turn.items.filter((i) => i.type === "userMessage")) {
        const refs = rows.filter(
          (r) =>
            r.client_message_id === item.clientId ||
            r.client_message_id === item.id ||
            (!item.clientId && r.turn_id === turn.id && first?.id === item.id),
        );
        if (refs.length)
          item.skillRefs = refs.map((r) => ({
            id: r.skill_id,
            name: r.name,
            displayName: r.display_name,
            scope: r.scope,
            sha256: r.sha256,
          }));
      }
    }
    return thread;
  }
  return { bind, unbind, decorate };
}
