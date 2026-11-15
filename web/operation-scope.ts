export type Operation = {
  signal: AbortSignal;
  isCurrent: () => boolean;
  finish: () => void;
};

/** Page-local ownership only. The server remains responsible for write receipts
 * and revisions; losing ownership never means a write was rolled back. */
export function createOperationScope(onBusy: (key: string) => void) {
  let live = false;
  let current: {
    kind: "read" | "write";
    key: string;
    controller: AbortController;
  } | null = null;
  function invalidate() {
    if (current?.kind === "read") current.controller.abort();
    current = null;
  }
  return {
    activate() {
      live = true;
      onBusy("");
    },
    dispose() {
      live = false;
      invalidate();
    },
    start(kind: "read" | "write", key: string): Operation | null {
      if (!live || current?.kind === "write") return null;
      if (kind === "read" && current?.key === key) return null;
      invalidate();
      const owner = { kind, key, controller: new AbortController() };
      current = owner;
      onBusy(key);
      const isCurrent = () => live && current === owner;
      return {
        signal: owner.controller.signal,
        isCurrent,
        finish() {
          if (!isCurrent()) return;
          current = null;
          onBusy("");
        },
      };
    },
  };
}
