// Real Codex + unmodified published plugin + SDK protocol; synthetic model/TLS only.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer as httpsServer } from "node:https";
import { createServer as httpServer } from "node:http";
import { execFileSync } from "node:child_process";
import { randomUUID, createHash, X509Certificate } from "node:crypto";
import { App } from "@modelcontextprotocol/ext-apps";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../server/index.ts";
import { Codex } from "../server/codex.ts";
import { ProviderRuntime } from "../server/provider-runtime.ts";
import { appHostCapabilities } from "../shared/mcp-app-host.ts";
const output = resolve(
  process.env.APP_SCOPE_NATIVE_EVIDENCE ||
    ".issue/2026-11-11/evidence-mcp-app-tool-scope",
);
await mkdir(output, { recursive: true });
const archive = resolve(
  process.argv[2] ||
    "/home/a/Documents/ChatGPT/newapp/dist/cloudwalker-0.5.2-linux-amd64.zip",
);
const root = await mkdtemp(join(tmpdir(), "newbot-app-scope-")),
  cwd = join(root, "work"),
  home = join(root, "codex");
await mkdir(cwd);
await mkdir(home);
const secret = "synthetic-app-scope-private-token",
  checks = [],
  business = [];
const keyFile = join(root, "key.pem"),
  certFile = join(root, "cert.pem");
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
    "/CN=synthetic",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
    "-keyout",
    keyFile,
    "-out",
    certFile,
  ],
  { stdio: "ignore" },
);
const cert = await readFile(certFile),
  pin = new X509Certificate(cert).fingerprint256
    .replaceAll(":", "")
    .toLowerCase();
let ctx,
  headers,
  stage = "startup",
  modelRequests = 0,
  failure,
  initialSent = false;
const completed = new Map(),
  sockets = new Set();
const upstream = httpsServer(
  { key: await readFile(keyFile), cert },
  async (req, res) => {
    try {
      assert.equal(req.headers.cookie, `API-Token=${secret}`);
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const data = JSON.parse(raw);
      business.push(data.method);
      let result;
      if (data.method === "BusinessGroupService.GetBusinessGroupTree")
        result = {
          tree: [
            { id: 1, pid: 0, oid: 1, name: "APP_SCOPE_GROUP", children: [] },
          ],
        };
      else {
        assert.ok(
          [
            "ThreatOverviewService.GetProcessedEventInfo",
            "ThreatOverviewService.ListEventDetectedTrendInfo",
            "ThreatOverviewService.ListEventTypeDistInfo",
          ].includes(data.method),
        );
        result = { data: [] };
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: data.id, result }));
    } catch (e) {
      failure = e;
      res.writeHead(500);
      res.end("synthetic assertion failed");
    }
  },
);
upstream.on("connection", (s) => {
  sockets.add(s);
  s.once("close", () => sockets.delete(s));
});
upstream.on("tlsClientError", () => {});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const endpoint = `https://127.0.0.1:${upstream.address().port}`;
const model = httpServer(async (req, res) => {
  try {
    if (req.url.endsWith("/models")) {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] }));
      return;
    }
    let raw = "";
    for await (const b of req) raw += b;
    assert.ok(!raw.includes(secret), "private token must not reach model");
    const body = JSON.parse(raw),
      n = ++modelRequests;
    let item, events;
    if (!initialSent) {
      initialSent = true;
      item = {
        id: "fc_" + n,
        type: "custom_tool_call",
        call_id: "call_" + n,
        name: "exec",
        namespace: "functions",
        status: "completed",
        input:
          'const t = ALL_TOOLS.filter(t => /mcp__plugin_.*__open_security_workspace$/.test(t.name)); if(t.length !== 1) throw Error("missing current App entry"); text(await tools[t[0].name]({period_days:7}));',
      };
      events = [
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, input: "", status: "in_progress" },
        },
        {
          type: "response.custom_tool_call_input.delta",
          output_index: 0,
          item_id: item.id,
          delta: item.input,
        },
        {
          type: "response.custom_tool_call_input.done",
          output_index: 0,
          item_id: item.id,
          input: item.input,
        },
      ];
    } else {
      item = {
        id: "msg_" + n,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          { type: "output_text", text: "SYNTHETIC_APP_READY", annotations: [] },
        ],
      };
      events = [
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, content: [], status: "in_progress" },
        },
        {
          type: "response.content_part.added",
          output_index: 0,
          item_id: item.id,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        },
        {
          type: "response.output_text.delta",
          output_index: 0,
          item_id: item.id,
          content_index: 0,
          delta: "SYNTHETIC_APP_READY",
        },
      ];
    }
    const response = {
      id: "resp_" + n,
      object: "response",
      created_at: 1,
      status: "completed",
      model: body.model,
      output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      {
        type: "response.created",
        response: { ...response, status: "in_progress", output: [] },
      },
      ...events,
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response },
    ])
      res.write("data: " + JSON.stringify(event) + "\n\n");
    res.end();
  } catch (e) {
    failure = e;
    res.writeHead(500);
    res.end("synthetic assertion failed");
  }
});
await new Promise((r) => model.listen(0, "127.0.0.1", r));
process.env.ENABLE_TEST_MCP = "false";
process.env.ENABLE_OFFICIAL_MCP = "false";
process.env.EXPERIMENTAL_PLUGINS = "true";
const origin = "http://127.0.0.1:3100",
  pluginId = "cloudwalker@newbot-imports";
async function open() {
  const codex = new Codex(cwd, () => ({ CODEX_HOME: home }));
  ctx = await createServer({
    directory: root,
    cwd,
    codex,
    providerRuntime: new ProviderRuntime(),
    password: "synthetic-app-scope",
    origins: [origin],
  });
  codex.on("event", (e) => {
    if (e.method === "turn/completed")
      completed.set(e.params.turn.id, e.params.turn);
  });
  await codex.start();
  assert.equal(codex.state, "ready");
  await ctx.service.configuration.read();
  const runtime = codex.providerRuntime,
    snapshot = runtime.snapshot();
  if (!snapshot.values.model_providers?.fixture)
    runtime.apply(snapshot.revision, [
      {
        keyPath: "model_providers",
        value: {
          fixture: {
            name: "Fixture",
            base_url: `http://127.0.0.1:${model.address().port}`,
            wire_api: "responses",
            requires_openai_auth: false,
          },
        },
        mergeStrategy: "replace",
      },
      { keyPath: "model_provider", value: "fixture", mergeStrategy: "replace" },
      { keyPath: "model", value: "gpt-6.1-sol", mergeStrategy: "replace" },
    ]);
  headers = { origin, cookie: `ma_session=${ctx.db.createSession()}` };
}
const post = (url, payload) =>
  ctx.app.inject({ method: "POST", url, headers, payload });
async function api(url, payload) {
  const r = await post(url, payload);
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function appOpen(source) {
  return api("/api/mcp-apps/open", { ...source, requestId: randomUUID() });
}
async function sdkCalls(opened) {
  const app = new App(
      { name: "app-scope-test", version: "1" },
      {},
      { autoResize: false },
    ),
    bridge = new AppBridge(
      null,
      { name: "newbot", version: "1" },
      appHostCapabilities(true),
    );
  const [host, view] = InMemoryTransport.createLinkedPair();
  let allow = true,
    latestGrant;
  bridge.oncalltool = async (p) => {
    const before = business.length;
    latestGrant = await api("/api/mcp-apps/call-request", {
      token: opened.token,
      tool: p.name,
      arguments: p.arguments || {},
    });
    assert.equal(latestGrant.display.serverTitle, "cloudwalker");
    assert.ok(latestGrant.display.toolTitle && latestGrant.display.toolTitle !== p.name);
    assert.equal(
      business.length,
      before,
      "requesting permission must not execute a tool",
    );
    return api("/api/mcp-apps/call-approve", {
      grant: latestGrant.grant,
      allow,
    });
  };
  try {
    await bridge.connect(host);
    await app.connect(view);
    const before = business.length;
    const result = await app.callServerTool({
      name: "list_business_groups",
      arguments: { profile: "default", limit: 100, offset: 0 },
    });
    assert.match(JSON.stringify(result), /APP_SCOPE_GROUP/);
    assert.ok(!JSON.stringify(result).includes(secret));
    assert.equal(business.length, before + 1);
    assert.equal(
      (
        await post("/api/mcp-apps/call-approve", {
          grant: latestGrant.grant,
          allow: true,
        })
      ).statusCode,
      410,
    );
    allow = false;
    await assert.rejects(
      app.callServerTool({ name: "list_business_groups", arguments: {} }),
    );
    assert.equal(business.length, before + 1, "denial must not execute a tool");
    allow = true;
    const posture = await app.callServerTool({
      name: "summarize_security_posture",
      arguments: { period_days: 30, profile: "default" },
    });
    assert.equal(posture.structuredContent.scope.period_days, 30);
    assert.equal(posture.structuredContent.handling.status, "ok");
    assert.equal(business.length, before + 4);
    assert.equal(
      (
        await post("/api/mcp-apps/call-request", {
          token: opened.token,
          tool: "foreign_tool",
          arguments: {},
        })
      ).statusCode,
      403,
    );
  } finally {
    await app.close();
    await bridge.close();
  }
}
try {
  await open();
  stage = "install-and-configure";
  const bytes = await readFile(archive),
    session = await ctx.imports.create({
      kind: "zip",
      name: "Published CloudWalker",
    });
  await ctx.imports.upload(session.id, "", bytes, true);
  const scan = await ctx.imports.scan(session.id);
  const installed = await ctx.imports.install(scan.id, {
    operationId: randomUUID(),
    digest: scan.digest,
    choices: scan.entries.map((e) => ({
      id: e.id,
      skills: e.skills.map((s) => s.id),
      confirmPackage: true,
      replace: false,
    })),
  });
  assert.equal(installed.entries[0].state, "installed");
  const detail = await ctx.service.plugins.read(pluginId),
    c = detail.connections[0],
    requestId = randomUUID();
  assert.equal(detail.version, "0.5.2");
  assert.equal(
    (
      await api("/api/credentials/requests", {
        operation: "plugin.configuration.save",
        requestId,
        pluginId,
        connectionId: c.id,
        expectedRevision: c.revision,
        schemaDigest: c.schemaDigest,
        values: { base_url: endpoint, tls_certificate_sha256: pin },
        enabled: true,
        clearSecrets: [],
      })
    ).state,
    "waiting",
  );
  const secretReply = await ctx.app.inject({
    method: "POST",
    url: `/api/credentials/${requestId}/input`,
    headers: { ...headers, "content-type": "application/octet-stream" },
    payload: Buffer.from(JSON.stringify({ api_token: secret })).toString(
      "base64",
    ),
  });
  assert.equal(secretReply.json().state, "succeeded");
  stage = "native-model-app-source";
  const run = await api("/api/agent/run", {
    requestId: randomUUID(),
    text: "Open the synthetic App",
    plugins: [pluginId],
  });
  const until = Date.now() + 30000;
  while (!completed.has(run.turn.id)) {
    if (failure) throw failure;
    if (Date.now() > until) throw Error("native App turn timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(completed.get(run.turn.id).status, "completed");
  assert.equal(business.length, 3);
  const thread = await ctx.service.read(run.threadId),
    turn = thread.turns.find((t) => t.id === run.turn.id);
  const item = turn.items.find(
    (i) => i.type === "mcpToolCall" && i.tool === "open_security_workspace",
  );
  assert.ok(
    item?.result,
    "actual model-executed MCP App source persists in original native history",
  );
  const source = { threadId: thread.id, turnId: turn.id, itemId: item.id };
  const models = modelRequests;
  const opened = await appOpen(source);
  assert.equal(opened.tools.length, 7);
  assert.equal(opened.display.toolTitle, "打开牧云安全工作台");
  assert.equal(item.display.toolTitle, "打开牧云安全工作台");
  assert.ok(opened.tools.includes("list_business_groups"));
  assert.equal(opened.hostPolicy.toolScope, "same-server-app-visible");
  assert.equal(opened.result.structuredContent.handling.status, "ok");
  assert.equal(
    business.length,
    3,
    "opening history must not rerun source tool",
  );
  const nativeStatus = await ctx.runtime.call("mcpServerStatus/list", {
    threadId: thread.id,
  });
  const tools = nativeStatus.data.find((s) => s.name === c.id).tools;
  assert.equal(tools.list_business_groups._meta?.ui, undefined);
  assert.ok(tools.open_security_workspace._meta.ui.resourceUri);
  checks.push(
    "unchanged 0.5.2 package; actual native model/tool history opens its resource and exposes seven same-connection tools including unannotated data tools",
  );
  stage = "sdk-app-tools";
  await sdkCalls(opened);
  assert.equal(modelRequests, models, "App queries must not invoke the model");
  assert.deepEqual(
    (await ctx.service.read(thread.id)).turns.map((t) => t.id),
    thread.turns.map((t) => t.id),
  );
  checks.push(
    "real SDK tools/call through host grants and pinned Codex returns business groups and refreshed posture; denial, foreign tool and replay do not execute",
  );
  stage = "close-and-reopen";
  await api("/api/mcp-apps/close", { token: opened.token });
  assert.equal(
    (
      await post("/api/mcp-apps/call-request", {
        token: opened.token,
        tool: "list_business_groups",
        arguments: {},
      })
    ).statusCode,
    410,
  );
  const second = await appOpen(source);
  assert.notEqual(second.token, opened.token);
  await api("/api/mcp-apps/close", { token: second.token });
  checks.push(
    "closing revokes calls; reopening the same persisted source gets a new lease without repeating business requests",
  );
  stage = "restart";
  await ctx.app.close();
  await open();
  const restored = await appOpen(source);
  assert.deepEqual(restored.result, opened.result);
  assert.deepEqual(restored.display, opened.display);
  await sdkCalls(restored);
  assert.equal(modelRequests, models);
  assert.equal(
    await readFile(join(home, "config.toml"), "utf8").catch(() => ""),
    "",
  );
  assert.ok(!JSON.stringify(ctx.service.events).includes(secret));
  checks.push(
    "full service restart restores original thread/App result and encrypted connector settings; approved data calls still work without model replay or config.toml",
  );
  if (failure) throw failure;
  await writeFile(
    join(output, "native-scope.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        version: "0.165.0",
        pluginVersion: detail.version,
        archiveSha256: createHash("sha256").update(bytes).digest("hex"),
        modelRequests,
        syntheticBusinessRequests: business.length,
        realModelRequests: 0,
        realBusinessRequests: 0,
        checks,
        browserValidation: false,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: checks.length,
      modelRequests,
      syntheticBusinessRequests: business.length,
    }),
  );
} catch (e) {
  await writeFile(
    join(output, "native-scope-failure.json"),
    JSON.stringify(
      { stage, error: String(e), stack: e.stack, checks },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await ctx?.app.close().catch(() => {});
  for (const s of sockets) s.destroy();
  upstream.closeAllConnections();
  model.closeAllConnections();
  await Promise.all([
    new Promise((r) => upstream.close(r)),
    new Promise((r) => model.close(r)),
  ]);
  await rm(root, { recursive: true, force: true });
}
