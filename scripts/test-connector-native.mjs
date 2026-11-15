// Real isolated Codex + real TLS/OAuth sockets. All MCP data/accounts are synthetic.
import assert from "node:assert/strict";
import { createServer } from "node:https";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import Fastify from "fastify";
import { createServer as netServer } from "node:net";
import { oauthCallback } from "../server/oauth.ts";
import { Codex } from "../server/codex.ts";
const root = await mkdtemp(join(tmpdir(), "newbot-connector-native-"));
process.env.ENABLE_TEST_MCP = "false";
process.env.ENABLE_OFFICIAL_MCP = "false";
delete process.env.PUBLIC_ORIGIN;
delete process.env.MCP_OAUTH_CALLBACK_PORT;
delete process.env.MCP_OAUTH_CALLBACK_URL;
let native,
  https,
  origin,
  authQuery,
  tokenExchanges = 0,
  refreshes = 0;
const callbackProxy = Fastify();
const portProbe = netServer();
await new Promise((r) => portProbe.listen(0, "127.0.0.1", r));
const callbackPort = portProbe.address().port;
await new Promise((r) => portProbe.close(r));
process.env.MCP_OAUTH_CALLBACK_PORT = String(callbackPort);
process.env.MCP_OAUTH_CALLBACK_URL =
  "https://newbot-callback.example/oauth/mcp/callback";
oauthCallback(callbackProxy, new Set(["https://newbot-callback.example"]));
const sendCallback = async (url) => {
  assert.equal(url.origin, "https://newbot-callback.example");
  const response = await callbackProxy.inject({
    method: "GET",
    url: url.pathname + url.search,
  });
  assert.equal(
    response.statusCode,
    200,
    "newbot callback proxy forwards to native listener",
  );
};
const checks = [];
const check = (name, value) => {
  assert.ok(value, name);
  checks.push(name);
  console.log(name);
};
try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(root, "key.pem"),
      "-out",
      join(root, "cert.pem"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  const cert = await readFile(join(root, "cert.pem"), "utf8");
  const key = await readFile(join(root, "key.pem"), "utf8");
  https = createServer({ key, cert }, async (req, res) => {
    const json = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    let text = "";
    for await (const b of req) text += b;
    if (req.url.startsWith("/.well-known/oauth-protected-resource"))
      return json(200, {
        resource: origin + "/protected",
        authorization_servers: [origin],
        scopes_supported: ["read"],
      });
    if (
      req.url.startsWith("/.well-known/oauth-authorization-server") ||
      req.url.startsWith("/.well-known/openid-configuration")
    )
      return json(200, {
        issuer: origin,
        authorization_endpoint: origin + "/authorize",
        token_endpoint: origin + "/token",
        registration_endpoint: origin + "/register",
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    if (req.url === "/register")
      return json(201, {
        ...JSON.parse(text),
        client_id: "synthetic-client",
        token_endpoint_auth_method: "none",
      });
    if (req.url === "/token") {
      const p = new URLSearchParams(text);
      if (p.get("grant_type") === "refresh_token") {
        refreshes++;
        return json(200, {
          access_token: "synthetic-access",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "synthetic-refresh",
        });
      }
      if (
        !authQuery ||
        p.get("code") !== "fixture-code" ||
        createHash("sha256")
          .update(p.get("code_verifier") || "")
          .digest("base64url") !== authQuery.get("code_challenge")
      )
        return json(400, { error: "invalid_grant" });
      tokenExchanges++;
      return json(200, {
        access_token: "synthetic-access",
        token_type: "Bearer",
        expires_in: 3600,
        refresh_token: "synthetic-refresh",
        scope: "read",
      });
    }
    if (
      req.url === "/protected" &&
      req.headers.authorization !== "Bearer synthetic-access"
    ) {
      res.setHeader(
        "WWW-Authenticate",
        `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
      );
      return json(401, { error: "unauthorized" });
    }
    if (req.method === "GET") {
      res.writeHead(405);
      return res.end();
    }
    if (req.method === "DELETE") {
      res.writeHead(204);
      return res.end();
    }
    const m = JSON.parse(text || "{}");
    if (m.id === undefined) {
      res.writeHead(204);
      return res.end();
    }
    if (m.method === "initialize")
      return json(200, {
        jsonrpc: "2.0",
        id: m.id,
        result: {
          protocolVersion: m.params.protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "private-fixture", version: "1" },
        },
      });
    if (m.method === "tools/list")
      return json(200, {
        jsonrpc: "2.0",
        id: m.id,
        result: {
          tools: [
            {
              name: "echo",
              description: "Echo synthetic input",
              inputSchema: {
                type: "object",
                properties: { value: { type: "string" } },
              },
            },
          ],
        },
      });
    if (m.method === "tools/call")
      return json(200, {
        jsonrpc: "2.0",
        id: m.id,
        result: { content: [{ type: "text", text: "TLS_OK" }] },
      });
    if (
      ["resources/list", "resources/templates/list", "prompts/list"].includes(
        m.method,
      )
    )
      return json(200, {
        jsonrpc: "2.0",
        id: m.id,
        result:
          m.method === "resources/templates/list"
            ? { resourceTemplates: [] }
            : m.method === "prompts/list"
              ? { prompts: [] }
              : { resources: [] },
      });
    return json(200, {
      jsonrpc: "2.0",
      id: m.id,
      error: { code: -32601, message: "not supported" },
    });
  });
  await new Promise((r) => https.listen(0, "127.0.0.1", r));
  origin = "https://localhost:" + https.address().port;
  const work = join(root, "work");
  await mkdir(work);
  native = new Codex(work, () => ({ CODEX_HOME: join(root, "home") }));
  await native.start();
  check(
    "new native advertises connector-local CA",
    native.runtimeCapabilities.mcpCustomCa,
  );
  const config = {
    mcp_servers: {
      trusted: {
        url: origin + "/open",
        tls_ca_certificate: cert,
        startup_timeout_sec: 8,
      },
      untrusted: { url: origin + "/open", startup_timeout_sec: 3 },
      wronghost: {
        url: origin.replace("localhost", "127.0.0.1") + "/open",
        tls_ca_certificate: cert,
        startup_timeout_sec: 3,
      },
      oauth: {
        url: origin + "/protected",
        tls_ca_certificate: cert,
        startup_timeout_sec: 8,
      },
    },
  };
  const started = await native.call("thread/start", {
    cwd: work,
    config,
    ephemeral: true,
  });
  const threadId = started.thread.id;
  const status = async (name) =>
    (
      await native.call("mcpServerStatus/list", { threadId, serverName: name })
    ).data.find((x) => x.name === name);
  const good = await status("trusted");
  check("self-signed HTTPS MCP discovers tools", !!good?.tools.echo);
  const bad = await status("untrusted");
  check("unconfigured connector does not inherit CA", !bad?.tools.echo);
  const host = await status("wronghost");
  check("custom CA does not disable hostname validation", !host?.tools.echo);
  const result = await native.call("mcpServer/tool/call", {
    threadId,
    server: "trusted",
    tool: "echo",
    arguments: { value: "synthetic" },
  });
  check(
    "real native tool call crosses verified TLS",
    JSON.stringify(result).includes("TLS_OK"),
  );
  const before = await status("oauth");
  check(
    "protected MCP requires OAuth",
    before?.authStatus === "notLoggedIn" ||
      before?.runtimeStatus === "authenticationRequired",
  );
  const completionEvent = () =>
    new Promise((resolve, reject) => {
      const handler = (m) => {
        if (m.method === "mcpServer/oauthLogin/completed") {
          clearTimeout(timer);
          native.off("event", handler);
          resolve(m.params);
        }
      };
      const timer = setTimeout(() => {
        native.off("event", handler);
        reject(Error("OAuth completion timeout"));
      }, 12000);
      native.on("event", handler);
    });
  let login = await native.call("mcpServer/oauth/login", {
    name: "oauth",
    threadId,
  });
  authQuery = new URL(login.authorizationUrl).searchParams;
  check(
    "native OAuth generates state and PKCE",
    !!authQuery.get("state") &&
      authQuery.get("code_challenge_method") === "S256",
  );
  let callback = new URL(authQuery.get("redirect_uri"));
  callback.searchParams.set("state", "wrong-state");
  callback.searchParams.set("code", "fixture-code");
  const rejected = completionEvent();
  await sendCallback(callback);
  const rejection = await rejected;
  check(
    "invalid OAuth state rejected before token exchange",
    rejection.success === false && tokenExchanges === 0,
  );
  login = await native.call("mcpServer/oauth/login", {
    name: "oauth",
    threadId,
  });
  authQuery = new URL(login.authorizationUrl).searchParams;
  callback = new URL(authQuery.get("redirect_uri"));
  callback.searchParams.set("state", authQuery.get("state"));
  callback.searchParams.set("error", "access_denied");
  const deniedEvent = completionEvent();
  await callbackProxy.inject({
    method: "GET",
    url: callback.pathname + callback.search,
  });
  const denied = await deniedEvent;
  check(
    "authorization denial does not issue tokens and permits retry",
    denied.success === false && tokenExchanges === 0,
  );
  login = await native.call("mcpServer/oauth/login", {
    name: "oauth",
    threadId,
  });
  authQuery = new URL(login.authorizationUrl).searchParams;
  callback = new URL(authQuery.get("redirect_uri"));
  callback.searchParams.set("state", authQuery.get("state"));
  callback.searchParams.set("code", "fixture-code");
  const completed = completionEvent();
  await sendCallback(callback);
  const completion = await completed;
  check("OAuth exchanges code using PKCE", tokenExchanges === 1);
  check("native OAuth completion succeeds", completion.success !== false);
  const after = await status("oauth");
  check("authorized MCP now exposes tools", !!after?.tools.echo);
  await native.stopAndWait();
  await native.start();
  const restart = await native.call("thread/start", {
    cwd: work,
    config,
    ephemeral: true,
  });
  const persisted = (
    await native.call("mcpServerStatus/list", {
      threadId: restart.thread.id,
      serverName: "oauth",
    })
  ).data.find((x) => x.name === "oauth");
  check("OAuth credential survives runtime restart", !!persisted?.tools.echo);
  await writeFile(
    resolve(
      process.env.CONNECTOR_TEST_EVIDENCE || ".issue/2026-11-13/evidence-connector-contracts/native-tls-oauth.json",
    ),
    JSON.stringify(
      {
        checks,
        tokenExchanges,
        refreshes,
        scope:
          "Real native runtime with isolated synthetic TLS/OAuth server; not Slack account authorization",
      },
      null,
      2,
    ),
  );
} finally {
  await callbackProxy.close();
  await native?.stopAndWait();
  await new Promise((r) => (https ? https.close(r) : r()));
  await rm(root, { recursive: true, force: true });
}
