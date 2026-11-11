import type { Store } from "./db.js";
import type { Approval, Item, Json } from "../shared/types.js";
import {
  connectorLabel,
  displayLabel,
  type ToolDisplay,
} from "../shared/tool-display.js";

// Keep only non-secret labels for history/reconnect. The native catalog and App
// registry remain the authorities for availability, identity and permissions.
export function toolDisplay(
  db: Store,
  serverTitle: (threadId: string, server: string) => unknown,
) {
  const cache = new Map<string, Map<string, string>>();
  const key = (server: string, tool: string) => JSON.stringify([server, tool]);
  function labels(threadId: string) {
    let saved = cache.get(threadId);
    if (!saved) {
      saved = new Map();
      try {
        const rows = JSON.parse(db.get(`tool-display:${threadId}`) || "[]");
        if (Array.isArray(rows))
          for (const row of rows.slice(0, 2048))
            if (
              Array.isArray(row) &&
              typeof row[0] === "string" &&
              row[0].length <= 1024 &&
              displayLabel(row[1])
            )
              saved.set(row[0], displayLabel(row[1])!);
      } catch {
        /* Older histories simply use real identifiers until discovery. */
      }
      cache.set(threadId, saved);
      while (cache.size > 32) cache.delete(cache.keys().next().value!);
    }
    return saved;
  }
  function get(threadId: string, server: string, tool?: string): ToolDisplay {
    return {
      serverTitle:
        displayLabel(serverTitle(threadId, server)) || connectorLabel(server),
      ...(tool && labels(threadId).has(key(server, tool))
        ? { toolTitle: labels(threadId).get(key(server, tool)) }
        : {}),
    };
  }
  return {
    get,
    remember(threadId: string, servers: Json[]) {
      if (!threadId || !db.owns(threadId)) return;
      const rows = new Map<string, string>();
      for (const server of servers) {
        if (typeof server.name !== "string" || server.toolsError) continue;
        for (const [name, tool] of Object.entries(server.tools || {}) as [
          string,
          Json,
        ][]) {
          const title =
            displayLabel(tool?.title) || displayLabel(tool?.annotations?.title);
          const id = key(server.name, name);
          if (title && id.length <= 1024 && rows.size < 2048)
            rows.set(id, title);
        }
      }
      const serialized = JSON.stringify([...rows]);
      if (Buffer.byteLength(serialized) > 512 * 1024) return;
      if (db.get(`tool-display:${threadId}`) !== serialized)
        db.set(`tool-display:${threadId}`, serialized);
      cache.delete(threadId);
    },
    item(threadId: string, item: Item): Item {
      if (item.type === "mcpToolCall" && typeof item.server === "string")
        item.display = get(threadId, item.server, item.tool);
      return item;
    },
    approval(a: Approval): Approval {
      if (typeof a.params.serverName !== "string") return a;
      return {
        ...a,
        display: {
          ...get(a.params.threadId, a.params.serverName),
          ...(displayLabel(a.params._meta?.tool_title)
            ? { toolTitle: displayLabel(a.params._meta?.tool_title) }
            : {}),
        },
      };
    },
  };
}
