import type { Thread } from "./types.js";
import { runtimeIsNewer } from "./runtime-settings.js";
// A recent authoritative window replaces overlapping turns; an explicitly
// loaded older prefix stays in the reader until the conversation is left.
export function mergeRecentHistory(current: Thread, incoming: Thread): Thread {
  if (current.id === incoming.id) {
    if (
      current.runtime &&
      (!incoming.runtime || !runtimeIsNewer(incoming.runtime, current.runtime))
    )
      incoming = { ...incoming, runtime: current.runtime };
    if (
      (current.nextInput?.revision || 0) > (incoming.nextInput?.revision || 0)
    )
      incoming = { ...incoming, nextInput: current.nextInput };
  }
  if (
    current.id === incoming.id &&
    (current.extensions?.revision || 0) > (incoming.extensions?.revision || 0)
  )
    incoming = { ...incoming, extensions: current.extensions };
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
