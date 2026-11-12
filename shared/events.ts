import { EventType, type Event } from "@ag-ui/core";
import type { Item, Thread, Turn } from "./types";
import { mergeRecentHistory } from "./history.js";
import { runtimeIsNewer } from "./runtime-settings.js";
// The UI consumes only AG-UI; Codex notification names stay inside its server adapter.
export function reduceAgentEvent(
  thread: Thread,
  event: Event,
  retainHistory = false,
): Thread {
  if (
    event.type === EventType.CUSTOM &&
    event.name === "newbot.session.runtime"
  ) {
    const { threadId, runtime } = event.value;
    return threadId === thread.id && runtimeIsNewer(runtime, thread.runtime)
      ? {
          ...thread,
          runtime,
          modelProvider: runtime.applied?.provider || runtime.provider,
        }
      : thread;
  }
  if (
    event.type === EventType.CUSTOM &&
    event.name === "newbot.session.inputs"
  ) {
    const { threadId, nextInput } = event.value;
    return threadId === thread.id &&
      nextInput.revision >= (thread.nextInput?.revision || 0)
      ? { ...thread, nextInput }
      : thread;
  }
  if (
    event.type === EventType.CUSTOM &&
    event.name === "newbot.session.extensions"
  ) {
    const { threadId, extensions } = event.value;
    return threadId === thread.id &&
      extensions.revision >= (thread.extensions?.revision || 0)
      ? { ...thread, extensions }
      : thread;
  }
  if (
    event.metadata?.revision &&
    thread.revision &&
    event.metadata.revision <= thread.revision
  )
    return thread;
  const threadId =
    event.metadata?.threadId ||
    ("threadId" in event ? event.threadId : undefined);
  if (event.type === EventType.STATE_SNAPSHOT)
    return event.snapshot.thread?.id === thread.id
      ? retainHistory
        ? mergeRecentHistory(thread, {
            ...event.snapshot.thread,
            revision:
              event.metadata?.revision || event.snapshot.thread.revision,
          })
        : {
            ...event.snapshot.thread,
            revision:
              event.metadata?.revision || event.snapshot.thread.revision,
          }
      : thread;
  if (threadId !== thread.id) return thread;
  const runId =
    event.metadata?.runId || ("runId" in event ? event.runId : undefined);
  const turns = thread.turns.map((t) => ({ ...t, items: [...t.items] }));
  let turn = turns.find((t) => t.id === runId);
  if (event.type === EventType.RUN_STARTED) {
    if (!turn) turns.push({ id: event.runId, status: "inProgress", items: [] });
  } else if (
    event.type === EventType.RUN_FINISHED ||
    event.type === EventType.RUN_ERROR
  ) {
    if (turn) {
      turn.status =
        event.type === EventType.RUN_ERROR
          ? "failed"
          : event.result?.status || "completed";
      if (event.type === EventType.RUN_ERROR)
        turn.error = event.rawEvent?.failure || { message: event.message };
      else if (
        turn.status === "completed" ||
        (turn.status === "interrupted" && event.outcome?.type === "cancelled")
      )
        turn.error = null;
    }
  } else if (
    event.type === EventType.CUSTOM &&
    event.name === "newbot.notice" &&
    typeof event.value?.message === "string"
  ) {
    if (turn) turn.error = { ...event.value };
  } else {
    if (!turn && runId) {
      turn = { id: runId, status: "inProgress", items: [] };
      turns.push(turn);
    }
    if (!turn) return thread;
    if (event.type === EventType.TEXT_MESSAGE_START) {
      if (!turn.items.some((i) => i.id === event.messageId))
        turn.items.push(
          event.role === "user"
            ? {
                id: event.messageId,
                type: "userMessage",
                content: [{ type: "text", text: "" }],
              }
            : { id: event.messageId, type: "agentMessage", text: "" },
        );
    }
    if (event.type === EventType.TEXT_MESSAGE_CONTENT) {
      const index = turn.items.findIndex((i) => i.id === event.messageId);
      if (index >= 0) {
        const item = { ...turn.items[index] };
        if (item.type === "userMessage")
          item.content = [
            {
              type: "text",
              text: ((item.content?.[0]?.text || "") + event.delta).slice(
                -262144,
              ),
            },
          ];
        else item.text = ((item.text || "") + event.delta).slice(-262144);
        turn.items[index] = item;
      }
    }
    if (event.type === EventType.ACTIVITY_DELTA) {
      const index = turn.items.findIndex((i) => i.id === event.messageId);
      if (index >= 0) {
        const delta = event.patch
          .filter(
            (p) =>
              p.op === "add" &&
              p.path === "/output/-" &&
              typeof p.value === "string",
          )
          .map((p) => (p as { value: string }).value)
          .join("");
        turn.items[index] = {
          ...turn.items[index],
          aggregatedOutput: (
            (turn.items[index].aggregatedOutput || "") + delta
          ).slice(-262144),
        };
      }
    }
    if (
      event.type === EventType.ACTIVITY_SNAPSHOT &&
      event.activityType === "newbot.item"
    ) {
      const item = event.content.item as Item;
      const index = turn.items.findIndex((i) => i.id === item.id);
      if (index < 0) turn.items.push(item);
      else turn.items[index] = item;
    }
  }
  const timing = event.metadata?.turnTiming;
  const timed = turns.find((t) => t.id === runId);
  if (timed && timing)
    for (const key of ["startedAt", "completedAt", "durationMs"] as const)
      if (typeof timing[key] === "number") timed[key] = timing[key];
  return {
    ...thread,
    revision: event.metadata?.revision || thread.revision,
    turns: (retainHistory ? turns : turns.slice(-30)).map((t) => ({
      ...t,
      items: t.items.slice(
        -Math.max(
          256,
          retainHistory
            ? thread.turns.find((prior) => prior.id === t.id)?.items.length || 0
            : 0,
        ),
      ),
    })),
    status: {
      type: turns.some((t) => t.status === "inProgress") ? "active" : "idle",
    },
  };
}
