import { publicFailure } from "./failure.js";
import type { ThreadItem } from "../generated/codex/v2/ThreadItem.js";
import type { Thread as CodexThread } from "../generated/codex/v2/Thread.js";
import type { Turn as CodexTurn } from "../generated/codex/v2/Turn.js";
import type { Item, Thread, Json, Turn } from "../shared/types.js";
// These are product view models. Provider-native fields and app-private _meta never cross by default.
export function publicItem(item: ThreadItem): Item {
  const view: Item = { id: item.id, type: item.type };
  for (const key of [
    "clientId",
    "text",
    "phase",
    "summary",
    "command",
    "status",
    "aggregatedOutput",
    "exitCode",
    "durationMs",
    "changes",
    "server",
    "tool",
    "arguments",
    "readOnlyHint",
    "mcpAppResourceUri",
    "mcpAppUi",
  ])
    if (key in item) view[key] = compact((item as Json)[key]);
  if (item.type === "userMessage")
    view.content = item.content
      .filter((c) => c.type === "text")
      .map((c) => ({ type: "text", text: c.text }));
  if (item.type === "mcpToolCall") {
    const failed = !!item.error || item.status === "failed";
    view.result =
      item.result && !failed
        ? {
            content: compact(publicToolContent(item.result.content)),
            structuredContent: compact(item.result.structuredContent),
          }
        : null;
    view.error = failed ? { message: "工具执行失败" } : null;
  }
  return view;
}
export function publicTurn(turn: CodexTurn): Turn {
  return {
    id: turn.id,
    status: turn.status,
    items: turn.items.map(publicItem),
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    durationMs: turn.durationMs,
    error: turn.error ? publicFailure(turn.error) : null,
  };
}
export function publicThread(
  thread: CodexThread,
  turns: CodexTurn[],
  cursor: string | null,
): Thread {
  return {
    id: thread.id,
    name: thread.name || undefined,
    preview: thread.preview,
    modelProvider: thread.modelProvider,
    status: thread.status,
    updatedAt: thread.updatedAt,
    turns: turns.map(publicTurn),
    historyCursor: cursor,
  };
}

// Bound retained view data; authoritative full history stays in Codex.
function compact(value: any, depth = 0): any {
  if (typeof value === "string")
    return value.length > 262144
      ? value.slice(0, 262144) + "\n[内容已截断]"
      : value;
  if (depth > 8) return "[内容已截断]";
  if (Array.isArray(value))
    return value.slice(0, 128).map((v) => compact(v, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 128)
        .map(([k, v]) => [k, compact(v, depth + 1)]),
    );
  return value;
}

// Image/audio payloads are registered before projection; never truncate binary into text events.
export function publicToolContent(content: unknown): unknown {
  if (!Array.isArray(content)) return content;
  return content.map((block) => {
    if (
      block &&
      ["image", "audio", "inputImage", "input_image", "inputAudio"].includes(
        block.type,
      )
    )
      return {
        type: block.type,
        ...(block.mimeType ? { mimeType: block.mimeType } : {}),
        resource: "registered",
      };
    if (block?.type === "resource" && block.resource?.blob)
      return {
        type: "resource",
        resource: { mimeType: block.resource.mimeType },
      };
    return block;
  });
}
