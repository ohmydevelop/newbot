import { Readable } from "node:stream";
import { z } from "zod";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { createServer } from "../../server/index.js";
import {
  NativeAgent,
  NewbotAgentRunner,
  DEFAULT_OWNER,
} from "./newbot-runner.js";

type Context = Awaited<ReturnType<typeof createServer>>;

/** Mount only on an isolated Newbot instance; root production does not import this lab. */
export function mountCopilotRuntime(ctx: Context) {
  // The production composer creates a thread on first send. This lab needs an
  // owned native thread before CopilotKit connects; no frontend-generated IDs.
  ctx.app.post("/api/v1/threads", async (req) => {
    z.strictObject({}).parse(req.body);
    return ctx.service.handle("thread/start", {});
  });
  const runner = new NewbotAgentRunner(ctx.agentCommands);
  const streams = new Map<AbortController, string>();
  const runtime = new CopilotRuntime({
    agents: { newbot: new NativeAgent() },
    runner,
    identifyUser: (request) => {
      const token = /(?:^|;\s*)ma_session=([^;]+)/.exec(
        request.headers.get("cookie") || "",
      )?.[1];
      if (!token || !ctx.db.validSession(token))
        throw new Error("Authentication required");
      return { id: DEFAULT_OWNER, name: "Newbot" };
    },
  });
  const handler = createCopilotRuntimeHandler({
    runtime,
    basePath: "/api/copilot",
  });
  ctx.app.route({
    method: ["GET", "POST"],
    url: "/api/copilot/*",
    bodyLimit: 256 * 1024,
    handler: async (req, reply) => {
      const token = req.cookies.ma_session!;
      if (
        streams.size >= 20 ||
        [...streams.values()].filter((v) => v === token).length >= 5
      )
        return reply
          .code(429)
          .send({ error: "实时连接过多，请关闭多余的标签页" });
      const abort = new AbortController();
      const cleanup = () => {
        streams.delete(abort);
        abort.abort();
      };
      streams.set(abort, token);
      reply.raw.once("close", cleanup);
      try {
        const response = await handler(
          new Request(`http://newbot.local${req.url}`, {
            method: req.method,
            headers: {
              "content-type": "application/json",
              accept: String(req.headers.accept || "text/event-stream"),
              cookie: `ma_session=${token}`,
            },
            ...(req.method === "POST"
              ? { body: JSON.stringify(req.body ?? {}) }
              : {}),
            signal: abort.signal,
          }),
        );
        reply.code(response.status);
        // Preserve Newbot's CSP, cache and authentication headers.
        for (const key of ["content-type", "x-accel-buffering"])
          if (response.headers.has(key))
            reply.header(key, response.headers.get(key)!);
        if (!response.body) {
          cleanup();
          return reply.send();
        }
        const body = Readable.fromWeb(response.body as never);
        body.once("close", cleanup);
        abort.signal.addEventListener("abort", () => body.destroy(), {
          once: true,
        });
        return reply.send(body);
      } catch {
        cleanup();
        return reply.code(500).send({ error: "会话连接失败，请重新连接" });
      }
    },
  });
  const timer = setInterval(() => {
    for (const [abort, token] of streams)
      if (!ctx.db.validSession(token)) abort.abort();
  }, 1000);
  timer.unref();
  ctx.app.addHook("preClose", async () => {
    clearInterval(timer);
    for (const abort of streams.keys()) abort.abort();
    streams.clear();
  });
  return { runner, activeStreams: () => streams.size };
}
