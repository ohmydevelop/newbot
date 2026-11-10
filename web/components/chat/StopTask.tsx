import { useRef, useState } from "react";
import { loadThread, request, useApp } from "../../store";
export function useTaskStop(
  threadId: string | null,
  turnId: string | undefined,
) {
  const [entries, setEntries] = useState<
    Record<
      string,
      {
        stage: "pending" | "requested" | "unknown" | "retry";
        message: string;
        reading?: boolean;
      }
    >
  >({});
  const pending = useRef(new Set<string>()),
    key = JSON.stringify([threadId, turnId]);
  const entry = entries[key];
  const update = (key: string, value: typeof entry | undefined) =>
    setEntries((prior) => {
      const next = { ...prior };
      if (value) next[key] = value;
      else delete next[key];
      return Object.fromEntries(Object.entries(next).slice(-32));
    });
  async function read(target: string, turn: string, k: string) {
    const current = useApp.getState();
    if (current.selectedId !== target) return;
    update(k, {
      stage: "unknown",
      message: "正在核对停止状态…",
      reading: true,
    });
    try {
      await loadThread(target, false, { localError: true });
      if (
        useApp.getState().thread?.id === target &&
        useApp.getState().thread?.turns.find((t) => t.id === turn)?.status ===
          "inProgress"
      )
        update(k, {
          stage: "retry",
          message: "任务仍在执行，如有需要可再次请求停止。",
        });
      else update(k, undefined);
    } catch {
      update(k, {
        stage: "unknown",
        message: "停止状态未能读取，请恢复连接后重试。",
      });
    }
  }
  return {
    entry,
    disabled: !!entry && entry.stage !== "retry",
    stop: async () => {
      if (
        !threadId ||
        !turnId ||
        pending.current.has(key) ||
        (entry && entry.stage !== "retry")
      )
        return;
      pending.current.add(key);
      update(key, { stage: "pending", message: "正在请求停止…" });
      try {
        await request("turn/interrupt", { threadId, turnId });
        update(key, {
          stage: "requested",
          message: "已请求停止，等待任务状态更新。",
        });
      } catch {
        update(key, {
          stage: "unknown",
          message: "停止请求未确认，请读取状态；不会自动重发。",
        });
      } finally {
        pending.current.delete(key);
      }
    },
    read: () =>
      threadId && turnId ? read(threadId, turnId, key) : Promise.resolve(),
  };
}
