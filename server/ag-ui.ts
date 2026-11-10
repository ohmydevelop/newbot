import { EventEmitter } from "node:events";
import { EventType, type Event } from "@ag-ui/core";
import type { ServerNotification } from "../generated/codex/ServerNotification.js";
import type { ThreadItem } from "../generated/codex/v2/ThreadItem.js";
import type { Thread, Json, Item, Approval } from "../shared/types.js";
import { reduceAgentEvent } from "../shared/events.js";
import { publicItem } from "./view.js";
import { A2UI_TOOL } from "../shared/a2ui-chat.js";
const toolTypes = new Set([
  "commandExecution",
  "fileChange",
  "mcpToolCall",
  "dynamicToolCall",
  "webSearch",
]);
export class AgentEvents extends EventEmitter {
  constructor(
    private readonly decorateItem: (
      threadId: string,
      turnId: string,
      item: Item,
    ) => Item = (_threadId, _turnId, item) => item,
  ) {
    super();
  }
  readonly threads = new Map<string, Thread>();
  private revision = 0;
  private texts = new Map<string, { text: string; ended: boolean }>();
  private tools = new Set<string>();
  private bound() {
    let bytes = 0;
    for (const thread of this.threads.values())
      bytes += Buffer.byteLength(JSON.stringify(thread));
    for (const [id, thread] of this.threads) {
      if (this.threads.size <= 32 && bytes <= 16 * 1024 * 1024) break;
      if (thread.turns.some((t) => t.status === "inProgress")) continue;
      bytes -= Buffer.byteLength(JSON.stringify(thread));
      this.threads.delete(id);
    }
  }
  resetTransient() {
    this.texts.clear();
    this.tools.clear();
  }
  seed(thread: Thread) {
    if (
      !this.threads.has(thread.id) ||
      !this.threads.get(thread.id)?.turns.some((t) => t.status === "inProgress")
    )
      this.threads.set(thread.id, {
        ...thread,
        revision: this.threads.get(thread.id)?.revision || this.revision,
      });
    const result = this.threads.get(thread.id)!;
    this.bound();
    return result;
  }
  publish(event: Event) {
    const id =
      event.metadata?.threadId ||
      ("threadId" in event ? event.threadId : undefined);
    const revision = ++this.revision;
    event = { ...event, metadata: { ...event.metadata, revision } };
    if (id && this.threads.has(id))
      this.threads.set(id, {
        ...reduceAgentEvent(this.threads.get(id)!, event),
        revision,
      });
    this.emit("event", { ...event, timestamp: Date.now() });
    this.bound();
  }
  snapshot(threadId: string): Event {
    return {
      type: EventType.STATE_SNAPSHOT,
      snapshot: { thread: this.threads.get(threadId) },
      metadata: {
        threadId,
        revision: this.threads.get(threadId)?.revision || 0,
      },
    };
  }
  runtime(state: string, reason: string) {
    this.publish({
      type: EventType.CUSTOM,
      name: "newbot.runtime",
      value: { state, reason },
    });
  }
  approval(request: Approval) {
    this.publish({
      type: EventType.CUSTOM,
      name: "newbot.approval.request",
      value: request,
      metadata: { threadId: (request.params as Json).threadId },
    });
  }
  resolved(id: string | number) {
    this.publish({
      type: EventType.CUSTOM,
      name: "newbot.approval.resolved",
      value: { id },
    });
  }
  notification(message: ServerNotification) {
    const p = message.params as Json;
    const threadId = p.threadId || p.thread?.id;
    if (!threadId) return;
    const runId = p.turnId || p.turn?.id;
    const metadata = {
      threadId,
      runId,
      ...(p.turn
        ? {
            turnTiming: {
              startedAt: p.turn.startedAt,
              completedAt: p.turn.completedAt,
              durationMs: p.turn.durationMs,
            },
          }
        : {}),
    };
    const emit = (event: Event) => this.publish({ ...event, metadata });
    const textStart = (messageId: string, role: "user" | "assistant") => {
      if (!this.texts.has(messageId)) {
        this.texts.set(messageId, { text: "", ended: false });
        emit({ type: EventType.TEXT_MESSAGE_START, messageId, role });
      }
    };
    if (message.method === "turn/started") {
      emit({ type: EventType.RUN_STARTED, threadId, runId });
      return;
    }
    if (message.method === "turn/completed") {
      if (p.turn.status === "failed")
        emit({
          type: EventType.RUN_ERROR,
          message: "任务失败，请检查对话状态和 Provider 配置",
          code: "CODEX_TURN_FAILED",
        });
      else
        emit({
          type: EventType.RUN_FINISHED,
          threadId,
          runId,
          result: { status: p.turn.status },
          ...(p.turn.status === "interrupted"
            ? { outcome: { type: "cancelled" as const } }
            : {}),
        });
      if (this.threads.has(threadId)) this.publish(this.snapshot(threadId));
      for (const item of this.threads
        .get(threadId)
        ?.turns.find((t) => t.id === runId)?.items || []) {
        this.texts.delete(item.id);
        this.tools.delete(item.id);
      }
      return;
    }
    if (message.method === "item/agentMessage/delta") {
      textStart(p.itemId, "assistant");
      const state = this.texts.get(p.itemId)!;
      state.text = (state.text + p.delta).slice(-262144);
      if (p.delta)
        emit({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: p.itemId,
          delta: p.delta,
        });
      return;
    }
    if (
      message.method === "item/started" ||
      message.method === "item/completed"
    ) {
      const item = p.item as ThreadItem;
      const completed = message.method === "item/completed";
      if (item.type === "agentMessage" || item.type === "userMessage") {
        textStart(item.id, item.type === "userMessage" ? "user" : "assistant");
        const text =
          item.type === "agentMessage"
            ? item.text
            : item.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n");
        const state = this.texts.get(item.id)!;
        if (text.length > state.text.length && text.startsWith(state.text)) {
          const delta = text.slice(state.text.length);
          state.text = text;
          emit({
            type: EventType.TEXT_MESSAGE_CONTENT,
            messageId: item.id,
            delta,
          });
        }
        if (completed && !state.ended) {
          state.ended = true;
          emit({ type: EventType.TEXT_MESSAGE_END, messageId: item.id });
        }
        if (completed)
          emit({
            type: EventType.ACTIVITY_SNAPSHOT,
            messageId: item.id,
            activityType: "newbot.item",
            content: {
              item: this.decorateItem(threadId, runId, publicItem(item)),
              output: [],
            },
          });
        return;
      }
      if (toolTypes.has(item.type)) {
        const obj = item as Json;
        if (!this.tools.has(item.id)) {
          this.tools.add(item.id);
          emit({
            type: EventType.TOOL_CALL_START,
            toolCallId: item.id,
            toolCallName:
              item.type === "mcpToolCall"
                ? `${item.server}/${item.tool}`
                : item.type,
          });
          emit({
            type: EventType.TOOL_CALL_ARGS,
            toolCallId: item.id,
            delta: JSON.stringify(
              item.type === "dynamicToolCall" && item.tool === A2UI_TOOL
                ? {}
                : obj.arguments || {
                    command: obj.command,
                    changes: obj.changes,
                  },
            ),
          });
        }
        if (completed) {
          emit({ type: EventType.TOOL_CALL_END, toolCallId: item.id });
          emit({
            type: EventType.TOOL_CALL_RESULT,
            toolCallId: item.id,
            messageId: `result:${item.id}`,
            content: JSON.stringify(
              item.type === "mcpToolCall" &&
                (item.status === "failed" || item.error)
                ? { message: "工具执行失败" }
                : obj.result
                  ? {
                      content: obj.result.content,
                      structuredContent: obj.result.structuredContent,
                    }
                  : obj.aggregatedOutput ||
                    (obj.error
                      ? { message: "工具执行失败" }
                      : { status: obj.status }),
            ),
          });
        }
      }
      emit({
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId: item.id,
        activityType: "newbot.item",
        content: {
          item: this.decorateItem(threadId, runId, publicItem(item)),
          output: [],
        },
      });
      return;
    }
    if (message.method === "item/commandExecution/outputDelta") {
      const turn = this.threads
        .get(threadId)
        ?.turns.find((t) => t.id === runId);
      const item = turn?.items.find((i) => i.id === p.itemId);
      if (item)
        emit({
          type: EventType.ACTIVITY_DELTA,
          activityType: "newbot.item",
          messageId: item.id,
          patch: [{ op: "add", path: "/output/-", value: p.delta }],
        });
      return;
    }
    if (message.method === "error" && !p.willRetry)
      emit({
        type: EventType.CUSTOM,
        name: "newbot.notice",
        value: { message: "Codex 操作失败，请检查 Provider 和执行权限" },
      });
  }
}
