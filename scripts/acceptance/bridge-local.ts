import { createServer as httpServer, request as httpRequest } from "node:http";
import { createServer as httpsServer } from "node:https";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { relayServer } from "../../services/event-relay/server.js";
import { relayRequest } from "../../packages/event-bridge/relay-request.js";
import { createServer } from "../../server/index.js";
import { ProviderRuntime } from "../../server/provider-runtime.js";
import { automationSchema } from "../../shared/automations.js";

const root = resolve(
  process.env.BRIDGE_LAB_DIR || ".data/bridge-acceptance/run-" + Date.now(),
);
await mkdir(root, { recursive: true, mode: 0o700 });
const evidence: Record<string, any> = {
  root,
  model: "local deterministic Responses fixture; real pinned Codex runtime",
  started: new Date().toISOString(),
};
const key = join(root, "key.pem"),
  cert = join(root, "cert.pem");
execFileSync(
  "openssl",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "2",
    "-subj",
    "/CN=Bridge local acceptance",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "ignore" },
);
const ca = await readFile(cert, "utf8");
const relay = relayServer({
  directory: join(root, "relay"),
  adminToken: randomUUID() + randomUUID(),
});
await relay.app.listen({ host: "127.0.0.1", port: 0 });
const port = (relay.app.server.address() as any).port;
let pauseRelay = false;
const received: any[] = [];
const proxy = httpsServer(
  { key: await readFile(key), cert: ca },
  (req, res) => {
    if (pauseRelay) {
      res.writeHead(503);
      res.end();
      return;
    }
    const buffers: Buffer[] = [];
    req.on("data", (b) => buffers.push(b));
    req.on("end", () => {
      const body = Buffer.concat(buffers);
      const upstream = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: req.url,
          method: req.method,
          headers: req.headers,
        },
        (response) => {
          if (req.url?.endsWith("/events") && response.statusCode! < 300) {
            const event = JSON.parse(body.toString());
            received.push({
              id: event.id,
              source: event.source,
              type: event.type,
              data: event.data,
              status: response.statusCode,
            });
          }
          res.writeHead(response.statusCode!, response.headers);
          response.pipe(res);
        },
      );
      upstream.on("error", () => {
        res.writeHead(502);
        res.end();
      });
      upstream.end(body);
    });
  },
);
await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
const url = `https://127.0.0.1:${(proxy.address() as any).port}`;
const trusted = relayRequest(url, ca);
await assert.rejects(fetch(url));
assert.equal((await trusted.request(url)).status, 404);
await assert.rejects(trusted.request(url.replace("127.0.0.1", "localhost")));
evidence.tls = {
  trusted: true,
  untrustedRejected: true,
  crossOriginRejected: true,
  url,
};
const route = relay.store.createRoute();
let modelCalls = 0;
const model = httpServer(async (req, res) => {
  if (req.method === "GET") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] }));
    return;
  }
  for await (const _ of req) {
  }
  const n = ++modelCalls,
    id = "resp_" + n,
    mid = "msg_" + n,
    text = "BRIDGE_RECEIVED_" + n;
  const msg = {
    id: mid,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  const response = {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: "gpt-6.1-sol",
    output: [msg],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of [
    {
      type: "response.created",
      response: { ...response, status: "in_progress", output: [] },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...msg, status: "in_progress", content: [] },
    },
    {
      type: "response.content_part.added",
      output_index: 0,
      item_id: mid,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    },
    {
      type: "response.output_text.delta",
      output_index: 0,
      item_id: mid,
      content_index: 0,
      delta: text,
    },
    { type: "response.output_item.done", output_index: 0, item: msg },
    { type: "response.completed", response },
  ])
    res.write("data: " + JSON.stringify(e) + "\n\n");
  res.end();
});
await new Promise<void>((r) => model.listen(0, "127.0.0.1", r));
const data = join(root, "newbot"),
  cwd = join(root, "workspace");
await mkdir(join(data, "codex"), { recursive: true });

const seed = {
  model: "gpt-6.1-sol",
  model_provider: "local_acceptance",
  model_providers: {
    local_acceptance: {
      name: "Local acceptance",
      base_url: `http://127.0.0.1:${(model.address() as any).port}/v1`,
      wire_api: "responses",
      requires_openai_auth: false,
    },
  },
};
const reserve = httpServer();
await new Promise<void>((r) => reserve.listen(0, "127.0.0.1", r));
const selectedPort = (reserve.address() as any).port;
await new Promise<void>((r) => reserve.close(() => r()));
const options = {
  origins: [`http://127.0.0.1:${selectedPort}`],
  directory: data,
  cwd,
  password: "bridge-local-acceptance-only",
  automationTimer: false,
  webDirectory: resolve("dist/web"),
};
let ctx = await createServer({
  ...options,
  providerRuntime: new ProviderRuntime(seed),
});
await ctx.runtime.start();
assert.equal(ctx.runtime.state, "ready", ctx.runtime.reason);
await ctx.service.settings();
const imported = await ctx.imports.create({
  kind: "files",
  name: "relay-events",
});
const pkg = resolve(".data/event-plugins/relay-events");
async function upload(folder: string, prefix = "") {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = prefix + entry.name;
    if (entry.isDirectory()) await upload(join(folder, entry.name), path + "/");
    else
      await ctx.imports.upload(
        imported.id,
        "relay-events/" + path,
        await readFile(join(folder, entry.name)),
      );
  }
}
await upload(pkg);
const scan = await ctx.imports.scan(imported.id);
const installed = await ctx.imports.install(imported.id, {
  operationId: randomUUID(),
  digest: scan.digest,
  choices: scan.entries.map((e) => ({
    id: e.id,
    skills: e.skills.map((s) => s.id),
    confirmPackage: true,
  })),
});
assert.equal(
  installed.state,
  "complete",
  JSON.stringify(
    installed.entries.map((e) => ({ state: e.state, error: e.error })),
  ),
);
evidence.import = {
  state: installed.state,
  entries: installed.entries.map((e) => ({ name: e.name, state: e.state })),
};
const provider = (await ctx.subscriptions.catalog()).providers.find((p) =>
  p.events.some((e) => e.id === "event.received"),
);
assert(provider, "installed relay source missing");
const connectionId = randomUUID();
await ctx.subscriptions.saveAccount({
  id: connectionId,
  revision: 0,
  providerId: provider.id,
  label: "Local HTTPS bridge",
  values: { url, route: route.id, ca_certificate: ca },
  secrets: { token: route.consumer },
});
const task = await ctx.automations.save({
  id: randomUUID(),
  expectedRevision: 0,
  content: automationSchema.parse({
    name: "Bridge 验收",
    prompt: "仅简要确认收到事件，不使用工具。",
    triggers: [],
    eventTriggers: [
      {
        id: randomUUID(),
        source: "subscription",
        providerId: provider.id,
        connectionId,
        events: ["event.received"],
        arguments: {},
      },
    ],
    notification: "none",
  }),
});
await ctx.subscriptions.tick();
let busy = false,
  stopping = false;
const tick = async () => {
  if (busy || stopping) return;
  busy = true;
  try {
    await ctx.subscriptions.tick();
    await ctx.automations.tick();
  } catch (e) {
    console.error("tick", String(e));
  } finally {
    busy = false;
  }
};
const timer = setInterval(() => void tick(), 1000);
await ctx.app.listen({ host: "127.0.0.1", port: selectedPort });
let appPort = (ctx.app.server.address() as any).port;
function snapshot() {
  const detail = ctx.automations.read(task.id);
  return {
    ...evidence,
    received,
    runs: detail.runs.map((r) => ({
      id: r.id,
      state: r.state,
      threadId: r.threadId,
      error: (r as any).error,
    })),
    taskId: task.id,
    modelCalls,
    appPort,
  };
}
const control = httpServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/pause") pauseRelay = true;
    if (req.method === "POST" && req.url === "/resume") pauseRelay = false;
    if (req.method === "POST" && req.url === "/restart") {
      stopping = true;
      while (busy) await new Promise((r) => setTimeout(r, 50));
      await ctx.app.close();
      ctx = await createServer({
        ...options,
        providerRuntime: new ProviderRuntime(seed),
      });
      await ctx.runtime.start();
      assert.equal(ctx.runtime.state, "ready");
      await ctx.app.listen({ host: "127.0.0.1", port: appPort });
      stopping = false;
      evidence.restarted = true;
    }
    const output = snapshot();
    await writeFile(
      join(root, "receipt.json"),
      JSON.stringify(output, null, 2),
    );
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(output));
    if (req.method === "POST" && req.url === "/finish") {
      stopping = true;
      clearInterval(timer);
      while (busy) await new Promise((r) => setTimeout(r, 50));
      await ctx.app.close();
      await trusted.close();
      await relay.app.close();
      proxy.closeAllConnections();
      proxy.close();
      model.closeAllConnections();
      model.close();
      control.close();
    }
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ error: String(e) }));
  }
});
await new Promise<void>((r) => control.listen(0, "127.0.0.1", r));
const env = {
  NEWBOT_EVENT_URL: `${url}/v1/routes/${route.id}/events`,
  NEWBOT_EVENT_TOKEN: route.producer,
  NEWBOT_EVENT_CA_CERTIFICATE: ca,
};
await writeFile(
  join(root, "runtime.json"),
  JSON.stringify({
    env,
    control: `http://127.0.0.1:${(control.address() as any).port}`,
    app: `http://127.0.0.1:${appPort}`,
    taskId: task.id,
  }),
  { mode: 0o600 },
);
await writeFile(resolve(".data/bridge-acceptance/active-run"), root);
console.log(
  JSON.stringify({
    ready: true,
    root,
    appPort,
    controlPort: (control.address() as any).port,
    taskId: task.id,
  }),
);
