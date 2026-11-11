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
export function isProcessItem(item: Item) {
  const kind = messageKind(item);
  return (
    kind === "tool" || (kind === "assistant" && item.phase === "commentary")
  );
}
export function hasItemOutput(item: Item, descriptor?: any) {
  return (
    item.type === "mcpToolCall" &&
    !!(
      item.appAvailable ||
      item.mcpAppUi?.resourceUri ||
      item.mcpAppResourceUri ||
      descriptor?._meta?.ui?.resourceUri
    ) &&
    !!item.result &&
    item.status === "completed" &&
    !item.error
  );
}
export type PresentationBlock =
  | { kind: "process"; id: string; items: Item[] }
  | { kind: "message" | "output"; id: string; item: Item };
/** Never move visible outputs into a disclosure. A result splits consecutive process items. */
export function presentationBlocks(
  items: Item[],
  outputs: Set<string>,
  status?: string,
): PresentationBlock[] {
  const blocks: PresentationBlock[] = [];
  let group: Extract<PresentationBlock, { kind: "process" }> | undefined;
  // Infer presentation only; never rewrite native phase or reorder the items.
  // A later tool is evidence that an unlabelled assistant item was intermediate.
  // A trailing streaming/failed response stays visible until there is such evidence.
  let laterActivity = false, trailingAssistant = true;
  const phases = new Map<string, string>();
  for (const item of [...items].reverse()) {
    const kind = messageKind(item);
    if (kind === "tool") laterActivity = true;
    if (kind === "assistant") {
      if (!item.phase && laterActivity) phases.set(item.id, "commentary");
      else if (!item.phase && trailingAssistant && status === "completed") phases.set(item.id, "final_answer");
      trailingAssistant = false;
    }
    if (kind === "user") laterActivity = false;
  }
  for (const original of items) {
    const item = phases.has(original.id) ? { ...original, phase: phases.get(original.id) } : original;
    if (messageKind(item) === "hidden") continue;
    if (isProcessItem(item)) {
      if (!group) {
        group = { kind: "process", id: `process:${item.id}`, items: [] };
        blocks.push(group);
      }
      group.items.push(item);
      if (outputs.has(item.id)) {
        blocks.push({ kind: "output", id: `output:${item.id}`, item });
        group = undefined;
      }
    } else {
      group = undefined;
      blocks.push({ kind: "message", id: `message:${item.id}`, item });
    }
  }
  return blocks;
}
export function toolTitle(item: Item, displayName?: string) {
  const labels: Record<string, string> = {
    commandExecution: "执行命令",
    fileChange: "修改文件",
    webSearch: "搜索网页",
    plan: "执行计划",
    imageView: "查看图片",
    imageGeneration: "生成图片",
    collabAgentToolCall: "协作任务",
    subAgentActivity: "协作进度",
    sleep: "等待",
    enteredReviewMode: "开始审查",
    exitedReviewMode: "结束审查",
    contextCompaction: "整理上下文",
    hookPrompt: "处理扩展钩子",
    functionCallOutput: "工具结果",
  };
  if (item.type === "mcpToolCall" || item.type === "dynamicToolCall")
    return `调用工具${displayName || item.tool ? ` · ${displayName || item.tool}` : ""}`;
  return labels[item.type] || "执行活动";
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
