import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer as httpsServer } from "node:https";
import { createServer as httpServer } from "node:http";
import { appToolResult } from "../server/mcp-apps.ts";
import { Codex } from "../server/codex.ts";
import { createServer } from "../server/index.ts";
import { ProviderRuntime } from "../server/provider-runtime.ts";
const isolation = process.env.CREDENTIAL_ISOLATION === "true";
const memory =
  process.env.CREDENTIAL_MEMORY_CONFIG === "true" ||
  process.env.CREDENTIAL_SQLITE_CONFIG === "true";
const output = resolve(
  process.env.CREDENTIAL_SQLITE_CONFIG === "true"
    ? ".data/credential-sqlite-native"
    : memory
      ? ".data/credential-memory-native"
      : isolation
        ? ".data/credential-isolation"
        : ".data/credential-storage",
);
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const name of ["native-result.json", "native-failure.json"])
  rmSync(join(output, name), { force: true });
const directory = mkdtempSync(join(tmpdir(), "newbot-vault-native-")),
  home = join(directory, "codex"),
  cwd = join(directory, "workspace");
mkdirSync(home);
mkdirSync(cwd);
const certFile = join(directory, "cert.pem"),
  keyFile = join(directory, "tls-key.pem");
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
    "-keyout",
    keyFile,
    "-out",
    certFile,
  ],
  { stdio: "ignore" },
);
const serverKey = join(directory, "server-key.pem"),
  serverCert = join(directory, "server.pem"),
  csr = join(directory, "server.csr"),
  ext = join(directory, "server.ext");
execFileSync(
  "openssl",
  [
    "req",
    "-new",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-nodes",
    "-subj",
    "/CN=127.0.0.1",
    "-keyout",
    serverKey,
    "-out",
    csr,
  ],
  { stdio: "ignore" },
);
writeFileSync(
  ext,
  "basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1\n",
);
execFileSync(
  "openssl",
  [
    "x509",
    "-req",
    "-in",
    csr,
    "-CA",
    certFile,
    "-CAkey",
    keyFile,
    "-CAcreateserial",
    "-out",
    serverCert,
    "-days",
    "1",
    "-extfile",
    ext,
  ],
  { stdio: "ignore" },
);
const providerKey = "NATIVE_PROVIDER_SYNTHETIC_" + randomUUID(),
  mcpKey = "NATIVE_MCP_SYNTHETIC_" + randomUUID();
let providerFailure = false,
  mcpFailure = false;
const tracePayloads = [],
  publicPayloads = [];
const collector = isolation
  ? httpServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        tracePayloads.push(Buffer.concat(chunks).toString());
        res.setHeader("Content-Type", "application/json");
        res.end("{}");
      });
    })
  : undefined;
if (collector) {
  await new Promise((resolve) => collector.listen(0, "127.0.0.1", resolve));
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT = `http://127.0.0.1:${collector.address().port}/v1/traces`;
}
const stats = {
  providerRequests: 0,
  providerAuthorized: false,
  mcpAuthorized: false,
  contextSecretSeen: false,
  mcpMethods: [],
  stages: [],
};
const upstream = httpsServer(
  { key: readFileSync(serverKey), cert: readFileSync(serverCert) },
  async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      if (req.url === "/mcp") {
        if (req.headers.authorization !== `Bearer ${mcpKey}`) {
          res.writeHead(401);
          res.end();
          return;
        }
        stats.mcpAuthorized = true;
        if (req.method !== "POST") {
          res.writeHead(405);
          res.end();
          return;
        }
        const body = JSON.parse(raw);
        stats.mcpMethods.push(body.method);
        if (body.id === undefined) {
          res.writeHead(202);
          res.end();
          return;
        }
        const result =
          body.method === "initialize"
            ? {
                protocolVersion: body.params.protocolVersion,
                capabilities: { tools: {} },
                serverInfo: {
                  name: "credential_native_fixture",
                  version: "1.0.0",
                },
              }
            : body.method === "tools/list"
              ? {
                  tools: [
                    {
                      name: "credential_scope_check",
                      description: "Synthetic no-secret fixture",
                      inputSchema: { type: "object", properties: {} },
                    },
                  ],
                }
              : body.method === "tools/call"
                ? mcpFailure
                  ? {
                      content: [{ type: "text", text: "认证失败：" + mcpKey }],
                      isError: true,
                      structuredContent: { private: providerKey },
                      _meta: { private: mcpKey },
                    }
                  : {
                      content: [
                        { type: "text", text: "managed token accepted" },
                      ],
                      isError: false,
                    }
                : { resources: [], prompts: [] };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
        return;
      }
      if (req.url?.startsWith("/v1/responses")) {
        stats.providerRequests++;
        stats.providerAuthorized =
          req.headers.authorization === `Bearer ${providerKey}`;
        stats.contextSecretSeen ||=
          raw.includes(providerKey) || raw.includes(mcpKey);
        if (!stats.providerAuthorized) {
          res.writeHead(401);
          res.end();
          return;
        }
        if (providerFailure) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                type: "invalid_request_error",
                code: "invalid_api_key",
                message: "认证失败：" + providerKey + " " + mcpKey,
              },
            }),
          );
          return;
        }
        const message = {
          id: "msg_fixture",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: "Managed credential native fixture completed.",
              annotations: [],
            },
          ],
        };
        const response = {
          id: "resp_fixture",
          object: "response",
          created_at: Math.floor(Date.now() / 1000),
          model: "gpt-6.1-sol",
          status: "completed",
          output: [message],
          usage: {
            input_tokens: 10,
            output_tokens: 8,
            total_tokens: 18,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const emit = (type, data) =>
          res.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
          );
        emit("response.created", {
          response: { ...response, status: "in_progress", output: [] },
        });
        emit("response.output_item.added", {
          output_index: 0,
          item: { ...message, status: "in_progress", content: [] },
        });
        emit("response.content_part.added", {
          item_id: message.id,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        });
        emit("response.output_text.delta", {
          item_id: message.id,
          output_index: 0,
          content_index: 0,
          delta: message.content[0].text,
        });
        emit("response.output_item.done", { output_index: 0, item: message });
        emit("response.completed", { response });
        res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] }));
    } catch {
      res.writeHead(400);
      res.end();
    }
  },
);
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const origin = `https://127.0.0.1:${upstream.address().port}`;
const stdioOutput = join(directory, "stdio-env.json"),
  launcher = join(directory, "stdio.mjs");
writeFileSync(
  launcher,
  `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(stdioOutput)},JSON.stringify({credentialEnvSeen:Object.keys(process.env).some(k=>k.startsWith('NEWBOT_CREDENTIAL_KEY_'))}));await import(${JSON.stringify(resolve("dist/mcp-test/server.js"))});`,
);
writeFileSync(
  join(home, "config.toml"),
  `model_provider="vault_provider"\nmodel="gpt-6.1-sol"\napproval_policy="never"\n[model_providers.vault_provider]\nname="Synthetic Native Provider"\nbase_url="${origin}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nsupports_websockets=false\nrequest_max_retries=0\nstream_max_retries=0\n[mcp_servers.secure]\nurl="${origin}/mcp"\n[mcp_servers.scope_stdio]\ncommand=${JSON.stringify(process.execPath)}\nargs=${JSON.stringify([launcher])}\n`,
);
if (memory) {
  const config = readFileSync(join(home, "config.toml"), "utf8");
  writeFileSync(
    join(home, "config.toml"),
    'approval_policy="never"\n' +
      config.slice(config.indexOf("[mcp_servers.secure]")),
  );
}
process.env.CODEX_BIN = resolve("node_modules/.bin/codex");
process.env.ENABLE_TEST_MCP = "false";
process.env.ENABLE_OFFICIAL_MCP = "false";
const makeRuntime = () =>
  new Codex(cwd, () => ({
    CODEX_HOME: home,
    SSL_CERT_FILE: certFile,
    CODEX_CA_CERTIFICATE: certFile,
    REQUESTS_CA_BUNDLE: certFile,
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  }));
let runtime = makeRuntime();
const openContext = () =>
  createServer({
    providerRuntime: memory
      ? new ProviderRuntime({
          model_provider: "vault_provider",
          model: "gpt-6.1-sol",
          model_providers: {
            vault_provider: {
              name: "Synthetic Native Provider",
              base_url: origin + "/v1",
              wire_api: "responses",
              requires_openai_auth: false,
              supports_websockets: false,
              request_max_retries: 0,
              stream_max_retries: 0,
            },
          },
        })
      : null,
    directory: join(directory, "app"),
    cwd,
    codex: runtime,
    password: "native-vault-fixture-password",
    origins: ["http://127.0.0.1:3127"],
  });
let ctx = await openContext();
let timer;
let closed = false;
try {
  if (isolation) {
    ctx.app.addHook("onSend", async (req, _reply, payload) => {
      if (req.url.startsWith("/api/") && typeof payload === "string")
        publicPayloads.push(payload);
      return payload;
    });
    ctx.service.events.on("event", (event) =>
      publicPayloads.push(JSON.stringify(event)),
    );
  }
  await ctx.app.ready();
  await runtime.start();
  assert.equal(runtime.state, "ready");
  stats.stages.push("native runtime ready");
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://127.0.0.1:3127" },
    payload: { password: "native-vault-fixture-password" },
  });
  const headers = {
    origin: "http://127.0.0.1:3127",
    cookie: login.headers["set-cookie"].split(";")[0],
  };
  async function save(scope, targetId, secret) {
    const settings = await ctx.service.settings();
    const row = (
      scope === "provider"
        ? settings.configuration.providers
        : settings.configuration.mcp
    ).find((v) => v.id === targetId);
    const create = await ctx.app.inject({
      method: "POST",
      url: "/api/credentials/requests",
      headers,
      payload: {
        requestId: randomUUID(),
        operation: "credential.save",
        scope,
        targetId,
        retention: "encrypted",
        expectedRevision: settings.configuration.revision,
        expectedVaultVersion: row.managedCredential.version,
      },
    });
    assert.equal(create.json().state, "waiting");
    const result = await ctx.app.inject({
      method: "POST",
      url: `/api/credentials/${create.json().id}/input`,
      headers: { ...headers, "content-type": "application/octet-stream" },
      payload: Buffer.from(secret),
    });
    assert.equal(result.json().state, "succeeded");
    assert.equal(result.json().applied, true);
    assert.ok(!result.body.includes(secret));
    stats.stages.push(scope + " saved and native runtime restarted");
  }
  await save("provider", "vault_provider", providerKey);
  await save("mcp", "secure", mcpKey);
  if (memory) {
    const persisted = runtime.providerRuntime.snapshot();
    await ctx.app.close();
    runtime = makeRuntime();
    ctx = await openContext();
    await runtime.start();
    assert.equal(runtime.state, "ready");
    assert.deepEqual(runtime.providerRuntime.snapshot(), persisted);
    assert.equal(runtime.providerRuntime.storage, "sqlite");
    const restored = await ctx.service.settings();
    assert.equal(
      restored.configuration.providers.find((p) => p.id === "vault_provider")
        .managedCredential.applied,
      true,
    );
    assert.equal(runtime.credentialRefs.size, 2);
    stats.stages.push(
      "Bridge restart automatically restores SQLite Provider parameters and their encrypted credentials without resupply; Provider reference never persisted in config.toml",
    );
  }
  const mcpStatus = await runtime.call("mcpServerStatus/list", { limit: 100 });
  stats.mcpStatus = mcpStatus.data.map((v) => ({
    name: v.name,
    status: v.runtimeStatus,
    error: !!v.toolsError,
  }));
  stats.envCount = runtime.credentialRefs.size;
  assert.equal(stats.mcpAuthorized, true);
  assert.ok(stats.mcpMethods.includes("tools/list"));
  assert.equal(
    JSON.parse(readFileSync(stdioOutput, "utf8")).credentialEnvSeen,
    false,
  );
  const shell = await runtime.call("command/exec", {
    command: [
      process.execPath,
      "-e",
      `process.stdout.write(JSON.stringify({credentialEnvSeen:Object.keys(process.env).some(k=>k.startsWith('NEWBOT_CREDENTIAL_KEY_'))}))`,
    ],
    cwd,
    timeoutMs: 5000,
  });
  assert.equal(JSON.parse(shell.stdout).credentialEnvSeen, false);
  stats.stages.push(
    "MCP HTTPS authenticated and other subprocesses did not inherit keys",
  );
  const done = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Synthetic native turn timed out")),
      25000,
    );
    runtime.on("event", (e) => {
      if (e.method === "turn/completed") resolve(e.params);
    });
  });
  done.catch(() => {});
  const run = await ctx.app.inject({
    method: "POST",
    url: "/api/agent/run",
    headers,
    payload: {
      requestId: randomUUID(),
      text: "Reply with the fixture confirmation.",
      provider: "vault_provider",
      model: "gpt-6.1-sol",
    },
  });
  assert.equal(run.statusCode, 200);
  const completed = await done;
  clearTimeout(timer);
  assert.equal(completed.turn.status, "completed");
  assert.equal(stats.providerAuthorized, true);
  assert.equal(stats.contextSecretSeen, false);
  stats.stages.push(
    "native Provider consumed saved key without adding either key to model input",
  );
  const toolResult = await runtime.call("mcpServer/tool/call", {
    threadId: run.json().threadId,
    server: "secure",
    tool: "credential_scope_check",
    arguments: {},
  });
  assert.ok(JSON.stringify(toolResult).includes("managed token accepted"));
  assert.ok(!JSON.stringify(toolResult).includes(mcpKey));
  stats.stages.push("native MCP tool call used the scoped stored token");
  if (isolation) {
    providerFailure = true;
    let listener;
    const failed = new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error("Native failure proof timed out")),
        20000,
      );
      listener = (e) => {
        if (e.method === "turn/completed") {
          runtime.off("event", listener);
          resolve(e.params);
        }
      };
      runtime.on("event", listener);
    });
    failed.catch(() => {});
    const request = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers,
      payload: {
        requestId: randomUUID(),
        threadId: run.json().threadId,
        text: "Synthetic failure fixture.",
        provider: "vault_provider",
        model: "gpt-6.1-sol",
      },
    });
    assert.equal(request.statusCode, 200);
    assert.equal((await failed).turn.status, "failed");
    clearTimeout(timer);
    const history = await ctx.app.inject({
      url: `/api/threads/${run.json().threadId}`,
      headers,
    });
    assert.equal(history.statusCode, 200);
    const feed = await ctx.app.inject({
      url: "/api/agent/events?transport=poll",
      headers,
    });
    assert.equal(feed.statusCode, 200);
    mcpFailure = true;
    try {
      const result = await runtime.call("mcpServer/tool/call", {
        threadId: run.json().threadId,
        server: "secure",
        tool: "credential_scope_check",
        arguments: {},
      });
      assert.equal(result.isError, true);
      publicPayloads.push(JSON.stringify(appToolResult(result)));
    } catch (error) {
      // A native RPC rejection is also a fixed diagnostic; assertion failures
      // must not be mistaken for an accepted native error path.
      assert.match(String(error), /^Error: Codex 操作失败/);
      publicPayloads.push(String(error));
    }
    assert.equal(stats.contextSecretSeen, false);
    stats.stages.push(
      "native Provider failure, restored history, MCP error and poll events stayed private",
    );
  }
  const configText = readFileSync(join(home, "config.toml"), "utf8");
  if (memory) {
    assert.ok(!configText.includes("model_providers"));
    assert.ok(!configText.includes("vault_provider"));
    stats.providerMemoryConfiguration = true;
    stats.providerStorage = "sqlite";
    const ordinary = JSON.stringify(
      ctx.db.raw.prepare("SELECT * FROM provider_configuration").all(),
    );
    assert.ok(!ordinary.includes(providerKey) && !ordinary.includes(mcpKey));
  }
  assert.ok(!configText.includes(providerKey));
  assert.ok(!configText.includes(mcpKey));
  const settings = await ctx.service.settings();
  assert.ok(!JSON.stringify(settings).includes(providerKey));
  assert.ok(!JSON.stringify(settings).includes(mcpKey));
  const p = settings.configuration.providers.find(
    (v) => v.id === "vault_provider",
  );
  const clear = await ctx.app.inject({
    method: "POST",
    url: "/api/credentials/clear",
    headers,
    payload: {
      scope: "provider",
      targetId: "vault_provider",
      expectedRevision: settings.configuration.revision,
      expectedVaultVersion: p.managedCredential.version,
      confirm: true,
    },
  });
  assert.equal(clear.json().applied, true);
  stats.stages.push("native credential clear and restart succeeded");
  if (isolation) {
    await ctx.app.close();
    closed = true;
    assert.ok(tracePayloads.length > 0);
    for (const payload of [...publicPayloads, ...tracePayloads]) {
      assert.ok(!payload.includes(providerKey));
      assert.ok(!payload.includes(mcpKey));
    }
    stats.publicPayloads = publicPayloads.length;
    stats.otlpBatches = tracePayloads.length;
    stats.stages.push(
      "real native events, API outputs and exported OTLP payloads contained no synthetic credential",
    );
  }
  writeFileSync(
    join(output, "native-result.json"),
    JSON.stringify(
      {
        ...stats,
        realCodex: true,
        syntheticInference: true,
        paidModelCalls: 0,
        shellCredentialEnvSeen: false,
        stdioCredentialEnvSeen: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "Native credential storage proof passed: Provider + HTTPS MCP + environment isolation + clear",
  );
} catch (error) {
  writeFileSync(
    join(output, "native-failure.json"),
    JSON.stringify(
      {
        error: String(error)
          .replaceAll(providerKey, "[redacted]")
          .replaceAll(mcpKey, "[redacted]"),
        ...stats,
        vaultStates: undefined,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  throw new Error(
    "Native credential proof failed; see local redacted evidence",
  );
} finally {
  clearTimeout(timer);
  if (!closed) await ctx.app.close();
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  if (collector) {
    collector.closeAllConnections();
    await new Promise((resolve) => collector.close(resolve));
  }
  rmSync(directory, { recursive: true, force: true });
}
