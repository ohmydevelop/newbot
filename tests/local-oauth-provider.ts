import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";

export async function localOAuthProvider() {
  const clients = new Map<string, string[]>();
  const approvals = new Map<string, URLSearchParams>();
  const codes = new Map<
    string,
    { client: string; redirect: string; challenge: string; expires: number }
  >();
  const access = new Map<string, number>();
  const refresh = new Map<string, string>();
  const counts: Record<string, number> = {};
  const hit = (name: string) => {
    counts[name] = (counts[name] || 0) + 1;
  };
  const random = () => randomBytes(24).toString("base64url");
  let origin = "";
  let lastExchange: URLSearchParams | undefined;
  const server = createServer(async (req, res) => {
    const send = (status: number, value: unknown) => {
      res.writeHead(status, {
        "content-type": "application/json",
        "cache-control": "no-store",
      });
      res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url!, origin);
      if (
        url.pathname === "/.well-known/oauth-protected-resource/mcp" ||
        url.pathname === "/.well-known/oauth-protected-resource"
      ) {
        hit("resourceMetadata");
        return send(200, {
          resource: origin + "/mcp",
          authorization_servers: [origin],
          scopes_supported: ["echo"],
        });
      }
      if (
        url.pathname === "/.well-known/oauth-authorization-server" ||
        url.pathname === "/.well-known/openid-configuration"
      ) {
        hit("authorizationMetadata");
        return send(200, {
          issuer: origin,
          authorization_endpoint: origin + "/authorize",
          token_endpoint: origin + "/token",
          registration_endpoint: origin + "/register",
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          scopes_supported: ["echo"],
        });
      }
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 65536) throw Error("oversized");
      }
      if (url.pathname === "/register") {
        const data = JSON.parse(raw);
        const redirects = data.redirect_uris;
        if (
          !Array.isArray(redirects) ||
          !redirects.every((s: string) => {
            const u = new URL(s);
            return (
              u.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
            );
          })
        )
          return send(400, { error: "invalid_redirect_uri" });
        const client = random();
        clients.set(client, redirects);
        hit("registration");
        return send(201, {
          client_id: client,
          redirect_uris: redirects,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        });
      }
      if (url.pathname === "/authorize") {
        const p = url.searchParams;
        if (
          !clients
            .get(p.get("client_id") || "")
            ?.includes(p.get("redirect_uri") || "") ||
          p.get("code_challenge_method") !== "S256" ||
          p.get("response_type") !== "code"
        )
          return send(400, { error: "invalid_request" });
        const ticket = random();
        approvals.set(ticket, p);
        hit("authorize");
        res.writeHead(200, {
          "content-type": "text/html;charset=utf-8",
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        });
        res.end(
          `<!doctype html><meta name="viewport" content="width=device-width"><title>本地 OAuth 验收</title><h1>本地 OAuth 验收</h1><p>仅测试账号，仅允许 echo 工具；不连接任何外部账号。</p><form method="post" action="/decision"><input type="hidden" name="ticket" value="${ticket}"><button name="decision" value="deny">拒绝</button><button name="decision" value="allow">允许测试访问</button></form>`,
        );
        return;
      }
      if (url.pathname === "/decision") {
        const form = new URLSearchParams(raw),
          ticket = form.get("ticket") || "",
          p = approvals.get(ticket);
        approvals.delete(ticket);
        if (!p) return send(400, { error: "invalid_request" });
        const callback = new URL(p.get("redirect_uri")!);
        callback.searchParams.set("state", p.get("state")!);
        if (form.get("decision") === "deny") {
          callback.searchParams.set("error", "access_denied");
          hit("denied");
        } else {
          const code = random();
          codes.set(code, {
            client: p.get("client_id")!,
            redirect: p.get("redirect_uri")!,
            challenge: p.get("code_challenge")!,
            expires: Date.now() + 60000,
          });
          callback.searchParams.set("code", code);
          hit("approved");
        }
        res.writeHead(302, {
          location: callback.href,
          "cache-control": "no-store",
        });
        res.end();
        return;
      }
      if (url.pathname === "/token") {
        const p = new URLSearchParams(raw),
          client = p.get("client_id") || "";
        if (p.get("grant_type") === "authorization_code") {
          const key = p.get("code") || "",
            code = codes.get(key);
          if (
            !code ||
            code.client !== client ||
            code.redirect !== p.get("redirect_uri") ||
            code.expires < Date.now() ||
            code.challenge !==
              createHash("sha256")
                .update(p.get("code_verifier") || "")
                .digest("base64url")
          ) {
            hit("rejectedCode");
            return send(400, { error: "invalid_grant" });
          }
          codes.delete(key);
          lastExchange = p;
          hit("pkceVerified");
        } else if (p.get("grant_type") === "refresh_token") {
          const token = p.get("refresh_token") || "";
          if (refresh.get(token) !== client)
            return send(400, { error: "invalid_grant" });
          refresh.delete(token);
          hit("refreshed");
        } else return send(400, { error: "unsupported_grant_type" });
        const token = random(),
          renewal = random();
        access.set(token, Date.now() + 600000);
        refresh.set(renewal, client);
        return send(200, {
          access_token: token,
          token_type: "Bearer",
          expires_in: 600,
          refresh_token: renewal,
          scope: "echo",
        });
      }
      if (url.pathname === "/mcp") {
        const token = (req.headers.authorization || "").replace(/^Bearer /, "");
        if ((access.get(token) || 0) <= Date.now()) {
          hit("unauthorized");
          res.setHeader(
            "www-authenticate",
            `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="echo"`,
          );
          return send(401, { error: "invalid_token" });
        }
        if (req.method !== "POST") {
          res.writeHead(405);
          res.end();
          return;
        }
        const data = JSON.parse(raw);
        if (!Object.hasOwn(data, "id")) {
          res.writeHead(202);
          res.end();
          return;
        }
        let result: unknown;
        if (data.method === "initialize") {
          hit("initialized");
          result = {
            protocolVersion: data.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "local-oauth-echo", version: "1.0" },
          };
        } else if (data.method === "tools/list") {
          hit("toolsListed");
          result = {
            tools: [
              {
                name: "echo",
                description: "Echo synthetic verification text",
                inputSchema: {
                  type: "object",
                  properties: { text: { type: "string" } },
                  required: ["text"],
                },
                annotations: { readOnlyHint: true, destructiveHint: false },
              },
            ],
          };
        } else if (data.method === "tools/call") {
          hit("toolCalled");
          result = {
            content: [
              { type: "text", text: String(data.params.arguments.text) },
            ],
          };
        } else if (data.method === "ping") result = {};
        else
          return send(200, {
            jsonrpc: "2.0",
            id: data.id,
            error: { code: -32601, message: "Method not found" },
          });
        return send(200, { jsonrpc: "2.0", id: data.id, result });
      }
      send(404, { error: "not_found" });
    } catch {
      send(400, { error: "invalid_request" });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    origin,
    counts,
    expireAccess: () => access.clear(),
    replayLastCode: async () => {
      if (!lastExchange) throw Error("No successful exchange");
      return fetch(origin + "/token", {
        method: "POST",
        body: lastExchange,
      }).then((r) => r.status);
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
