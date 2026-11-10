import type { Thread } from "./types.js";
// A recent authoritative window replaces overlapping turns; an explicitly
// loaded older prefix stays in the reader until the conversation is left.
export function mergeRecentHistory(current: Thread, incoming: Thread): Thread {
  if (current.id !== incoming.id || !incoming.turns.length) return incoming;
  const first = current.turns.findIndex((t) => t.id === incoming.turns[0].id);
  if (first <= 0) return incoming;
  return {
    ...incoming,
    historyCursor: current.historyCursor,
    turns: [...current.turns.slice(0, first), ...incoming.turns],
  };
}
export function mergeOlderHistory(
  current: Thread,
  older: Thread,
  cursor: string,
): Thread {
  if (older.id !== current.id || current.historyCursor !== cursor)
    throw new Error("历史分页上下文已变化");
  if (older.historyCursor === cursor)
    throw new Error("历史分页未前进，请重新读取会话");
  const known = new Set(current.turns.map((t) => t.id));
  return {
    ...current,
    historyCursor: older.historyCursor,
    turns: [
      ...older.turns.filter((t) => {
        if (known.has(t.id)) return false;
        known.add(t.id);
        return true;
      }),
      ...current.turns,
    ],
  };
}
