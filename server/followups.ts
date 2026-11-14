import { createHash } from "node:crypto";
import {
  extractSuggestions,
  turnSuggestions,
  validateSuggestions,
} from "../shared/suggestions.js";
import type { Thread } from "../shared/types.js";
import type { Store } from "./db.js";
import { PublicError } from "./public-error.js";

function followupContext(thread: Thread) {
    const messages = thread.turns.slice(-6).flatMap((t) =>
      t.items.flatMap((i) => {
        if (i.type === "userMessage")
          return [
            {
              role: "user",
              text: (i.content || [])
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n")
                .slice(-4000),
            },
          ];
        if (
          i.type === "agentMessage" &&
          i.phase !== "commentary" &&
          typeof i.text === "string"
        )
          return [
            {
              role: "assistant",
              text: extractSuggestions(i.text).text.slice(-6000),
            },
          ];
        return [];
      }),
    );
    while (JSON.stringify(messages).length > 32000 && messages.length > 2)
      messages.shift();
    return JSON.stringify(messages);
}

export function followupService(options: {
  db: Pick<Store, "get" | "set">;
  read: (threadId: string) => Promise<Thread>;
  route: (threadId: string) => {
    provider: string;
    model: string;
    revision: string;
  };
  generate: (
    threadId: string,
    provider: string,
    model: string,
    context: string,
  ) => Promise<unknown>;
}) {
  const pending = new Map<string, Promise<string[]>>();
  const latest = (thread: Thread, turnId: string) => {
    const turn = thread.turns.at(-1);
    if (
      !turn ||
      turn.id !== turnId ||
      turn.status !== "completed" ||
      !turn.items.some(
        (i) => i.type === "agentMessage" && i.text && i.phase !== "commentary",
      )
    )
      throw new PublicError("此回复已更新，暂不生成追问");
    return turn;
  };
  const request = async (threadId: string, turnId: string) => {
    const thread = await options.read(threadId);
    const turn = latest(thread, turnId);
    const inline = turnSuggestions(turn);
    if (inline.length) return inline;
    const route = options.route(threadId);
    const context = followupContext(thread);
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([threadId, turnId, context, route]))
      .digest("hex");
    const key = `followups:v1:${fingerprint}`;
    const cached = options.db.get(key);
    if (cached) {
      try {
        const value = validateSuggestions(JSON.parse(cached));
        if (value.length >= 2) return value;
      } catch {}
    }
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    if (pending.size >= 2) throw new PublicError("追问生成繁忙，请稍后重试");
    const job = (async () => {
      const result = validateSuggestions(
        await options.generate(threadId, route.provider, route.model, context),
      );
      if (result.length < 2)
        throw new PublicError("模型未返回有效追问，请重试");
      const after = await options.read(threadId);
      latest(after, turnId);
      if (followupContext(after) !== context) throw new PublicError("此回复已更新，请重新生成追问");
      if (JSON.stringify(options.route(threadId)) !== JSON.stringify(route))
        throw new PublicError("会话配置已变化，请重新生成追问");
      options.db.set(key, JSON.stringify(result));
      return result;
    })();
    pending.set(key, job);
    try {
      return await job;
    } finally {
      if (pending.get(key) === job) pending.delete(key);
    }
  };
  return Object.assign(request, { pending: () => pending.size });
}
