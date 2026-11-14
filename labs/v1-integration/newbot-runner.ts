import {
  AgentRunner,
  ThreadAccessDeniedError,
  type AgentRunnerRunRequest,
  type AgentRunnerConnectRequest,
  type AgentRunnerStopRequest,
  type AgentRunnerIsRunningRequest,
} from "@copilotkit/runtime/v2";
import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type Message,
  type RunAgentInput,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import { z } from "zod";

import type { AgentCommands } from "../../server/agent-commands.js";
import { PublicError, publicErrorMessage } from "../../server/public-error.js";
import type { Thread } from "../../shared/types.js";

type Event = Parameters<Parameters<AgentCommands["subscribe"]>[1]>[0];

export const DEFAULT_OWNER = "newbot:default";

/** Registration only: Newbot's existing command service owns execution. */
export class NativeAgent extends AbstractAgent {
  run(): Observable<BaseEvent> {
    throw new Error("Newbot must execute through its AgentRunner");
  }
}

function messages(thread: Thread): Message[] {
  return thread.turns.flatMap((turn) =>
    turn.items.flatMap((item): Message[] => {
      if (item.type === "agentMessage")
        return [{ id: item.id, role: "assistant", content: item.text || "" }];
      if (item.type === "userMessage")
        return [
          {
            id: item.id,
            role: "user",
            content: (item.content || [])
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
          },
        ];
      return [];
    }),
  );
}

/** Initial text-only integration. No second history database or model loop. */
export class NewbotAgentRunner extends AgentRunner {
  constructor(private readonly commands: AgentCommands) {
    super();
  }

  isThreadAccessible(threadId: string, scope: { ownerId: string }) {
    return scope.ownerId === DEFAULT_OWNER && this.commands.owns(threadId);
  }
  private authorize(threadId: string, ownerId?: string) {
    if (!this.isThreadAccessible(threadId, { ownerId: ownerId || "" }))
      throw new ThreadAccessDeniedError();
  }
  run(request: AgentRunnerRunRequest): Observable<BaseEvent> {
    this.authorize(request.threadId, request.ownerId);
    return this.stream(request.threadId, request.input);
  }
  connect(request: AgentRunnerConnectRequest): Observable<BaseEvent> {
    this.authorize(request.threadId, request.ownerId);
    return this.stream(request.threadId);
  }
  async isRunning(request: AgentRunnerIsRunningRequest) {
    this.authorize(request.threadId, request.ownerId);
    return this.commands.isRunning(request.threadId);
  }
  async stop(request: AgentRunnerStopRequest) {
    this.authorize(request.threadId, request.ownerId);
    // The SDK permits unscoped stop; Newbot deliberately requires the exact run.
    if (!request.runId) return false;
    return this.commands.stop(request.threadId, request.runId);
  }

  private stream(
    threadId: string,
    input?: RunAgentInput,
  ): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      let initialized = false;
      let revision = 0;
      let runId = input?.runId;
      let nativeTurnId: string | undefined;
      const knownMessages = new Set<string>();
      const pending: Event[] = [];
      let pendingBytes = 0;
      const emit = (event: BaseEvent) => subscriber.next(event);
      const fail = (error: unknown) => {
        if (subscriber.closed) return;
        emit({
          type: EventType.RUN_ERROR,
          message: publicErrorMessage(error),
          code: "NEWBOT_RUN_ERROR",
        });
        subscriber.complete();
      };
      const finish = (status: string) => {
        if (!runId) {
          subscriber.complete();
          return;
        }
        if (status === "failed") {
          fail(new PublicError("任务执行失败，请查看会话状态"));
          return;
        }
        emit({
          type: EventType.RUN_FINISHED,
          threadId,
          runId,
          ...(status === "interrupted"
            ? { outcome: { type: "cancelled" } }
            : {}),
        });
        subscriber.complete();
      };
      const snapshot = (thread: Thread) => {
        const projected = messages(thread);
        for (const message of projected) knownMessages.add(message.id);
        emit({ type: EventType.MESSAGES_SNAPSHOT, messages: projected });
      };
      const consume = (event: Event) => {
        if (subscriber.closed) return;
        const eventRevision = Number(event.metadata?.revision || 0);
        if (eventRevision <= revision) return;
        revision = eventRevision;
        if (event.metadata?.runId && event.metadata.runId !== nativeTurnId)
          return;
        switch (event.type) {
          case EventType.TEXT_MESSAGE_START:
            if (knownMessages.has(event.messageId)) return;
            knownMessages.add(event.messageId);
            emit({
              type: event.type,
              messageId: event.messageId,
              role: event.role,
            });
            break;
          case EventType.TEXT_MESSAGE_CONTENT:
            emit({
              type: event.type,
              messageId: event.messageId,
              delta: event.delta,
            });
            break;
          case EventType.TEXT_MESSAGE_END:
            emit({ type: event.type, messageId: event.messageId });
            break;
          case EventType.STATE_SNAPSHOT: {
            const current = this.commands.peek(threadId);
            if (current) {
              snapshot(current);
              const turn = current.turns.find(
                (turn) => turn.id === nativeTurnId,
              );
              if (turn?.error && turn.status !== "inProgress")
                fail(new PublicError("执行已中断，请核对任务状态后重连"));
              else if (turn && turn.status !== "inProgress")
                finish(turn.status);
            }
            break;
          }
          case EventType.RUN_FINISHED:
            finish(
              event.outcome?.type === "cancelled" ? "interrupted" : "completed",
            );
            break;
          case EventType.RUN_ERROR:
            // Native errors may contain provider data: use Newbot's public boundary.
            fail(new PublicError("任务执行失败，请查看会话状态"));
            break;
        }
      };
      const unsubscribe = this.commands.subscribe(threadId, (event) => {
        if (initialized) {
          consume(event);
          return;
        }
        pendingBytes += Buffer.byteLength(JSON.stringify(event));
        if (pending.length >= 512 || pendingBytes > 4 * 1024 * 1024) {
          fail(new PublicError("事件缓冲已满，请重新连接会话"));
          return;
        }
        pending.push(event);
      });
      // The synchronous teardown below never cancels native execution.
      void (async () => {
        if (input) {
          z.string().uuid().parse(input.runId);
          // CopilotKit adds this correlation ID itself. Validate then discard;
          // it is never execution identity, authorization, or model context.
          const props = z
            .strictObject({
              __copilotkitRequestId: z.string().uuid().optional(),
            })
            .safeParse(input.forwardedProps || {});
          if (
            input.threadId !== threadId ||
            input.tools.length ||
            input.context.length ||
            !props.success
          )
            throw new PublicError("此验证入口暂只支持普通文本对话");
          const last = input.messages.at(-1);
          if (
            last?.role !== "user" ||
            typeof last.content !== "string" ||
            !last.content.trim()
          )
            throw new PublicError("请输入文本消息");
          // No client history, state, tools, identity or credentials are executed.
          this.commands.receipt(threadId, input.runId);
          const accepted = await this.commands.submit({
            requestId: input.runId,
            threadId,
            text: last.content,
          });
          if (subscriber.closed) return;
          if (accepted.state === "awaiting_credentials") {
            emit({ type: EventType.RUN_STARTED, threadId, runId: input.runId });
            emit({
              type: EventType.CUSTOM,
              name: "newbot.authorization.required",
              value: { requestId: input.runId, threadId },
            });
            fail(new PublicError("请先在会话中完成凭证授权"));
            return;
          }
          nativeTurnId = accepted.turn?.id;
        }
        if (subscriber.closed) return;
        const thread = await this.commands.read(threadId);
        if (subscriber.closed) return;
        if (!input) {
          const restored =
            thread.turns.find((turn) => turn.status === "inProgress") ||
            thread.turns.at(-1);
          nativeTurnId = restored?.id;
          if (nativeTurnId) {
            runId = this.commands.requestForTurn(threadId, nativeTurnId);
            // Legacy completed history may predate the request ledger. This is
            // a replay envelope, never a new execution or an interrupt token.
            if (!runId && restored?.status !== "inProgress")
              runId = `history:${nativeTurnId}`;
          } else {
            subscriber.complete();
            return;
          }
        }
        if (nativeTurnId && !runId)
          throw new PublicError("任务回执尚未确认，请稍后重连");
        if (runId) emit({ type: EventType.RUN_STARTED, threadId, runId });
        snapshot(thread);
        revision = thread.revision || 0;
        initialized = true;
        for (const event of pending) consume(event);
        pending.length = 0;
        if (subscriber.closed) return;
        const turn = thread.turns.find((turn) => turn.id === nativeTurnId);
        if (!nativeTurnId) subscriber.complete();
        else if (turn && turn.status !== "inProgress") finish(turn.status);
        else if (!this.commands.isRunning(threadId))
          fail(new PublicError("执行状态尚未确认，请核对后重连"));
      })().catch(fail);
      return unsubscribe;
    });
  }
}
