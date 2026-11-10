import { EventType, type Event } from "@ag-ui/core";
import type { Item, Turn } from "../shared/types";
// Product presentation only. Native Agent events remain AG-UI/Codex-owned.
export function messageKind(item: Item) {
  if (item.a2uiUpdate) return "hidden";
  if (item.a2ui) return "form";
  if (item.a2uiUnavailable) return "form-unavailable";
  if (item.a2uiLoading) return "form-loading";
  if (item.type === "userMessage") return "user";
  if (item.type === "agentMessage") return "assistant";
  return "tool";
}
export function toolStatus(item: Item) {
  if (item.status === "declined")
    return { label: "未执行", failed: false, running: false };
  const failed = item.status === "failed" || !!item.error;
  const running = ["inProgress", "running"].includes(item.status);
  return {
    failed,
    running,
    label: failed
      ? "失败"
      : running
        ? "执行中"
        : typeof item.exitCode === "number" && item.exitCode !== 0
          ? `退出码 ${item.exitCode}`
          : "已完成",
  };
}
export function turnFeedback(turn: Turn) {
  if (turn.status === "failed")
    return { tone: "error", text: "本次任务未完成。", canRead: true };
  if (turn.status === "interrupted")
    return turn.error
      ? {
          tone: "error",
          text: "本次任务已中断，请确认当前状态。",
          canRead: true,
        }
      : { tone: "muted", text: "你已停止本次回答", canRead: false };
  if (turn.error)
    return {
      tone: "error",
      text: "本次任务的状态需要重新确认。",
      canRead: true,
    };
  return null;
}
export function failureTarget(event: Event) {
  if (
    event.type !== EventType.RUN_ERROR &&
    !(
      event.type === EventType.CUSTOM &&
      event.name === "newbot.notice" &&
      typeof event.metadata?.runId === "string"
    )
  )
    return null;
  const threadId = event.metadata?.threadId;
  return typeof threadId === "string" && threadId.length > 0
    ? {
        threadId,
        runId:
          typeof event.metadata?.runId === "string"
            ? event.metadata.runId
            : null,
      }
    : null;
}
