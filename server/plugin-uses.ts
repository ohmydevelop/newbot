import type { Store } from "./db.js";
import type { PluginReference, Thread } from "../shared/types.js";
export function pluginUses(db: Store) {
  const unbind = (requestId: string) => {
    db.raw.prepare("DELETE FROM run_plugins WHERE request_id=?").run(requestId);
  };
  function bind(requestId: string, refs: PluginReference[]) {
    unbind(requestId);
    const insert = db.raw.prepare("INSERT INTO run_plugins VALUES(?,?,?,?,?)");
    refs.forEach((r, index) =>
      insert.run(requestId, index, r.id, r.name, r.displayName),
    );
  }
  function decorate(thread: Thread) {
    const rows = db.raw
      .prepare(
        "SELECT r.turn_id,r.client_message_id,p.* FROM runs r JOIN run_plugins p ON p.request_id=r.request_id WHERE r.thread_id=? ORDER BY p.position",
      )
      .all(thread.id) as {
      turn_id: string;
      client_message_id: string;
      plugin_id: string;
      name: string;
      display_name: string;
    }[];
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
          item.pluginRefs = refs.map((r) => ({
            id: r.plugin_id,
            name: r.name,
            displayName: r.display_name,
          }));
      }
    }
    return thread;
  }
  return { bind, unbind, decorate };
}
