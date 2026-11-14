import type { Event } from "@ag-ui/core";
import { z } from "zod";
import type { Store } from "./db.js";
import type { bridge } from "./bridge.js";
import type { Codex } from "./codex.js";
import { runStore } from "./runs.js";
import { PublicError } from "./public-error.js";
import type { Json, Thread } from "../shared/types.js";

/** A deliberate business rejection, independent of the HTTP transport. */
export class AgentCommandError extends PublicError {
  constructor(
    readonly statusCode: number,
    readonly response: Json,
  ) {
    super(response.error);
  }
}
export function rejectAgentCommand(statusCode: number, response: Json): never {
  throw new AgentCommandError(statusCode, response);
}

/** Trusted in-process API. HTTP integrations must retain authentication and Origin checks. */
export function agentCommands(deps: {
  submit: (body: unknown) => Promise<Json>;
  db: Store;
  service: ReturnType<typeof bridge>;
  runtime: Codex;
}) {
  const { db, service, runtime } = deps;
  const runs = runStore(db);
  const own = (id: string) => {
    z.string().min(1).max(200).parse(id);
    if (!db.owns(id)) throw new PublicError("会话不存在");
  };
  return {
    submit: deps.submit,
    // This is the existing single-instance boundary, not multi-Bot ownership.
    owns: (threadId: string) => db.owns(threadId),
    read: async (threadId: string): Promise<Thread> => {
      own(threadId);
      return (await service.handle("thread/read", { threadId })) as Thread;
    },
    peek: (threadId: string) => {
      own(threadId);
      return service.events.threads.get(threadId);
    },
    receipt: (threadId: string, requestId: string) => {
      own(threadId);
      z.string().uuid().parse(requestId);
      const run = runs.get(requestId);
      if (run && run.thread_id !== threadId)
        throw new PublicError("请求不属于此会话");
      return run;
    },
    requestForTurn: (threadId: string, turnId: string): string | undefined => {
      own(threadId);
      const row = db.raw
        .prepare(
          "SELECT request_id FROM runs WHERE thread_id=? AND turn_id=? LIMIT 1",
        )
        .get(threadId, turnId) as { request_id: string } | undefined;
      return row?.request_id;
    },
    subscribe: (threadId: string, listener: (event: Event) => void) => {
      own(threadId);
      const scoped = (event: Event) => {
        const id =
          event.metadata?.threadId ||
          ("threadId" in event ? event.threadId : undefined);
        if (id === threadId) listener(event);
      };
      service.events.on("event", scoped);
      return () => {
        service.events.off("event", scoped);
      };
    },
    isRunning: (threadId: string) => {
      own(threadId);
      return (
        runtime.active.has(threadId) ||
        !!db.raw
          .prepare(
            "SELECT 1 FROM runs WHERE thread_id=? AND state IN ('reserved','dispatching','awaiting_credentials')",
          )
          .get(threadId)
      );
    },
    stop: async (threadId: string, requestId: string) => {
      own(threadId);
      z.string().uuid().parse(requestId);
      const run = runs.get(requestId);
      if (!run || run.thread_id !== threadId || !run.turn_id) return false;
      const active =
        runtime.activeTurns.get(threadId) ||
        service.events.threads
          .get(threadId)
          ?.turns.find((turn) => turn.status === "inProgress")?.id;
      if (active !== run.turn_id) return false;
      // No asynchronous gap between comparing identity and dispatching interrupt.
      await service.handle("turn/interrupt", { threadId, turnId: run.turn_id });
      return true;
    },
  };
}
export type AgentCommands = ReturnType<typeof agentCommands>;
