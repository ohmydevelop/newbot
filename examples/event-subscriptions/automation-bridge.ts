import type { automations } from "../../server/automations.js";
import { hash, type SourceEvent, type Target } from "../../server/event-subscriptions/contracts.js";

export function automationBridge(
  tasks: Pick<ReturnType<typeof automations>, "receiveEvent" | "list">,
) {
  return async (
    target: Target,
    event: SourceEvent,
    id: string,
  ): Promise<"accepted" | "discarded"> => {
    const task = tasks.list().find((t) => t.id === target.taskId);
    if (
      !task?.enabled ||
      task.revision !== target.revision ||
      !task.eventTriggers.some(
        (t) => t.id === target.triggerId && t.source === "webhook",
      )
    )
      return "discarded";
    tasks.receiveEvent(target.taskId, target.revision, target.triggerId, {
      id,
      digest: hash(event),
      source: "webhook",
      type: event.type,
      payload: event.payload,
    });
    return "accepted";
  };
}
