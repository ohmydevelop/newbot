import { PublicError } from "./public-error.js";
import type { FastifyInstance } from "fastify";
export function oauthCallback(app: FastifyInstance, origins: Set<string>) {
  const port = Number(process.env.MCP_OAUTH_CALLBACK_PORT);
  const callback = process.env.MCP_OAUTH_CALLBACK_URL;
  if (!callback && !port) return;
  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    port === Number(process.env.PORT || 3100) ||
    !callback
  )
    throw new PublicError("MCP OAuth 必须同时设置独立固定端口与回调 URL");
  const url = new URL(callback);
  if (
    !origins.has(url.origin) ||
    url.protocol !== "https:" ||
    url.pathname !== "/oauth/mcp/callback" ||
    url.search ||
    url.hash
  )
    throw new PublicError(
      "MCP OAuth 回调 URL 必须使用主站 HTTPS origin 与 /oauth/mcp/callback 路径",
    );
  let count = 0,
    until = 0;
  async function handle(req: any, reply: any) {
    reply.header("Cache-Control", "no-store");
    const now = Date.now();
    if (now > until) {
      count = 0;
      until = now + 10000;
    }
    if (++count > 20) return reply.code(429).send("Too many callbacks");
    // Fixed loopback target only. Never forward Cookie, Host, Origin or authorization headers.
    if (req.raw.url.length > 8192)
      return reply.code(400).send("Invalid callback");
    const source = new URL(req.raw.url, "https://callback.invalid");
    if (!/^\/oauth\/mcp\/callback(?:\/[a-zA-Z0-9_-]+)?$/.test(source.pathname))
      return reply.code(400).send("Invalid callback");
    try {
      const response = await fetch(
        `http://127.0.0.1:${port}${source.pathname}${source.search}`,
        { redirect: "manual", signal: AbortSignal.timeout(5000) },
      );
      await response.body?.cancel();
      reply
        .header("Cache-Control", "no-store")
        .header("Referrer-Policy", "no-referrer");
      return reply
        .code(response.ok ? 200 : 400)
        .type("text/html")
        .send(
          response.ok
            ? "<!doctype html><meta charset=utf-8><title>授权完成</title><p>授权回调已提交，请返回工作台查看连接状态。</p>"
            : "<!doctype html><meta charset=utf-8><title>授权未完成</title><p>授权未完成，请返回工作台重新发起登录。</p>",
        );
    } catch {
      return reply
        .code(502)
        .send(
          "OAuth callback unavailable. Return to the workspace and retry login.",
        );
    }
  }
  app.get("/oauth/mcp/callback", handle);
  app.get("/oauth/mcp/callback/*", handle);
}
