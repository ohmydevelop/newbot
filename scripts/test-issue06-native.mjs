// Fixed Codex + loopback synthetic receivers. No personal Codex files or real model accounts.
import assert from "node:assert/strict";
import { createServer as http } from "node:http";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID, createHash } from "node:crypto";
import { createServer } from "../server/index.ts";
import { Codex } from "../server/codex.ts";
import { ProviderRuntime } from "../server/provider-runtime.ts";
const root = await mkdtemp(join(tmpdir(), "newbot-issue06-native-")),
  home = join(root, "codex"),
  cwd = join(root, "work"),
  directory = join(root, "data");
const output = resolve(".issue/2026-11-10/evidence-issue-06/S3/native");
await mkdir(output, { recursive: true });
await mkdir(home);
await mkdir(cwd);
process.env.CODEX_BIN = resolve("node_modules/.bin/codex");
process.env.ENABLE_TEST_MCP = "false";
process.env.ENABLE_OFFICIAL_MCP = "false";
const secrets = {
    provider: "provider-" + randomUUID(),
    header: "header-" + randomUUID(),
    env: "env-" + randomUUID(),
  },
  calls = [],
  events = [],
  finished = new Map(),
  checks = [];
let ctx,
  stage = "setup";
const server = http(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (req.url === "/mcp") {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end();
      return;
    }
    const body = JSON.parse(raw);
    calls.push({
      kind: "mcp",
      method: body.method,
      correct: req.headers["x-api-key"] === secrets.header,
      providerAbsent: !req.headers.authorization,
    });
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
            serverInfo: { name: "issue06", version: "1" },
          }
        : body.method === "tools/list"
          ? {
              tools: [
                {
                  name: "safe_test",
                  description: "Fixture",
                  inputSchema: { type: "object", properties: {} },
                },
              ],
            }
          : { resources: [], prompts: [] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
    return;
  }
  if (req.url.endsWith("/models")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] }));
    return;
  }
  if (!raw || req.method !== "POST") {
    res.writeHead(405);
    res.end();
    return;
  }
  const body = JSON.parse(raw);
  calls.push({
    kind: "model",
    correct: req.headers.authorization === `Bearer ${secrets.provider}`,
    privateBody: Object.values(secrets).some((s) => raw.includes(s)),
  });
  const id = "resp_" + randomUUID(),
    mid = "msg_" + randomUUID(),
    item = {
      id: mid,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        { type: "output_text", text: "Synthetic reply", annotations: [] },
      ],
    };
  const response = {
    id,
    object: "response",
    created_at: 1,
    status: "completed",
    model: body.model,
    output: [item],
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
      item: { ...item, status: "in_progress", content: [] },
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
      delta: "Synthetic reply",
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ])
    res.write("data: " + JSON.stringify(e) + "\n\n");
  res.end();
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`,
  origin = "http://127.0.0.1:3100";
const launcher = join(root, "stdio.mjs"),
  proof = join(root, "stdio-proof.json");
await writeFile(
  launcher,
  `import {writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';writeFileSync(${JSON.stringify(proof)},JSON.stringify({correct:createHash('sha256').update(process.env.SERVICE_TOKEN||'').digest('hex')===${JSON.stringify(createHash("sha256").update(secrets.env).digest("hex"))},otherPrivateEnv:Object.keys(process.env).some(k=>k.startsWith('NEWBOT_CREDENTIAL_KEY_'))}));await import(${JSON.stringify(resolve("dist/mcp-test/server.js"))});`,
);
const wait = async (fn) => {
  const until = Date.now() + 25000;
  while (!(await fn())) {
    if (Date.now() > until) throw Error("Timed out: " + stage);
    await new Promise((r) => setTimeout(r, 40));
  }
};
async function open() {
  const native = new Codex(cwd, () => ({ CODEX_HOME: home }));
  const c = await createServer({
    directory,
    cwd,
    codex: native,
    providerRuntime: new ProviderRuntime({
      model_provider: "sample",
      model: "gpt-6.1-sol",
      model_providers: {
        sample: {
          name: "Synthetic",
          base_url: base + "/v1",
          wire_api: "responses",
          requires_openai_auth: false,
          supports_websockets: false,
          request_max_retries: 0,
          stream_max_retries: 0,
        },
      },
    }),
    password: "issue06-native-login",
    origins: [origin],
  });
  native.on("event", (e) => {
    events.push(JSON.stringify(e));
    if (e.method === "turn/completed")
      finished.set(e.params.turn.id, e.params.turn);
  });
  await native.start();
  assert.equal(native.state, "ready", native.reason);
  const login = await c.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password: "issue06-native-login" },
  });
  c.headers = { origin, cookie: login.headers["set-cookie"].split(";")[0] };
  c.post = (url, payload) =>
    c.app.inject({ method: "POST", url, headers: c.headers, payload });
  c.get = (url) => c.app.inject({ url, headers: c.headers });
  return c;
}
const config = async () =>
  (await ctx.get("/api/config?view=saved")).json().configuration;
async function fields(
  scope,
  targetId,
  fields,
  values = {},
  clearValues = false,
) {
  const cfg = await config(),
    target = (scope === "provider" ? cfg.providers : cfg.mcp).find(
      (t) => t.id === targetId,
    );
  const t = await ctx.post("/api/credentials/requests", {
    operation: "credential.fields.save",
    requestId: randomUUID(),
    scope,
    targetId,
    fields,
    clearValues,
    expectedRevision: cfg.revisions[`${scope}:${targetId}`],
    expectedFieldsRevision: target.privateFields?.revision || "absent",
  });
  assert.equal(t.statusCode, 200, t.body);
  await input(t.json().id, values);
  return t.json().id;
}
async function input(id, values) {
  const r = await ctx.app.inject({
    method: "POST",
    url: `/api/credentials/${id}/input`,
    headers: { ...ctx.headers, "content-type": "application/octet-stream" },
    payload: Buffer.from(JSON.stringify(values)).toString("base64"),
  });
  assert.equal(r.json().state, "succeeded", r.body);
}
async function authorize(run, duration) {
  const need = run.privateInputs[0],
    t = await ctx.post("/api/credentials/requests", {
      operation: "credential.authorize",
      requestId: randomUUID(),
      runId: run.requestId,
      scope: need.scope,
      targetId: need.targetId,
      expectedFieldsRevision: need.revision,
      duration,
    });
  assert.equal(t.statusCode, 200, t.body);
  await input(t.json().id, { "bearer:Authorization": secrets.provider });
  let result;
  await wait(async () => {
    result = (await ctx.get(`/api/agent/runs/${run.requestId}`)).json();
    if (result.state === "rejected") throw Error(JSON.stringify(result));
    return !!result.turn?.id;
  });
  run.threadId = result.threadId;
  await done(result);
  return result;
}
async function run(threadId) {
  const r = await ctx.post("/api/agent/run", {
    requestId: randomUUID(),
    text: "test " + randomUUID(),
    ...(threadId ? { threadId } : { provider: "sample", model: "gpt-6.1-sol" }),
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
async function done(r) {
  await wait(() => finished.has(r.turn.id));
  assert.equal(
    finished.get(r.turn.id).status,
    "completed",
    JSON.stringify(finished.get(r.turn.id)),
  );
}
try {
  ctx = await open();
  stage = "configure";
  for (const [id, transport, patch] of [
    ["remote", "http", { url: base + "/mcp" }],
    ["local", "stdio", { command: process.execPath, args: [launcher] }],
  ]) {
    const r = await ctx.post("/api/config", {
      action: "mcp/save",
      id,
      create: true,
      transport,
      expectedRevision: (await config()).revision,
      patch,
    });
    assert.equal(r.statusCode, 200, r.body);
  }
  await fields(
    "provider",
    "sample",
    [{ kind: "bearer", name: "Authorization" }],
    { "bearer:Authorization": secrets.provider },
  );
  await fields("mcp", "remote", [{ kind: "header", name: "X-Api-Key" }], {
    "header:X-Api-Key": secrets.header,
  });
  await fields("mcp", "local", [{ kind: "env", name: "SERVICE_TOKEN" }], {
    "env:SERVICE_TOKEN": secrets.env,
  });
  stage = "MCP diagnosis without inference";
  const diagnosis = await ctx.post("/api/agent/action", {
    action: "mcp/test",
    id: "remote",
    expectedRevision: (await config()).revisions["mcp:remote"],
  });
  assert.equal(diagnosis.statusCode, 200, diagnosis.body);
  assert.equal(diagnosis.json().state, "discovered", diagnosis.body);
  assert.equal(calls.filter((c) => c.kind === "model").length, 0);
  assert.equal(
    calls.some((c) => c.kind === "mcp" && c.method === "tools/call"),
    false,
  );
  checks.push(
    "Authenticated native MCP diagnosis discovers tools without model turns or business tool calls",
  );
  stage = "saved credentials";
  const first = await run();
  await done(first);
  assert.ok(calls.some((c) => c.kind === "model" && c.correct));
  assert.ok(calls.some((c) => c.kind === "mcp" && c.correct));
  assert.deepEqual(JSON.parse(await readFile(proof, "utf8")), {
    correct: true,
    otherPrivateEnv: false,
  });
  checks.push(
    "Native HTTP Bearer, custom header and stdio environment reached correct recipients",
  );
  stage = "one run";
  await fields(
    "provider",
    "sample",
    [{ kind: "bearer", name: "Authorization" }],
    {},
    true,
  );
  const count = calls.filter((c) => c.kind === "model").length,
    held = await run();
  assert.equal(held.state, "awaiting_credentials");
  assert.equal(calls.filter((c) => c.kind === "model").length, count);
  await authorize(held, "run");
  const afterOnce = await run(held.threadId);
  assert.equal(afterOnce.state, "awaiting_credentials");
  await ctx.post(`/api/credentials/runs/${afterOnce.requestId}/cancel`, {});
  checks.push("One-run authorization is required again on the next turn");
  stage = "thread grant";
  const session = await run();
  await authorize(session, "thread");
  const second = await run(session.threadId);
  await done(second);
  const other = await run();
  assert.equal(other.state, "awaiting_credentials");
  await ctx.post(`/api/credentials/runs/${other.requestId}/cancel`, {});
  checks.push(
    "Thread grant reused on same native thread, absent from another thread",
  );
  stage = "revoke";
  await ctx.app.inject({
    method: "DELETE",
    url: `/api/credentials/threads/${session.threadId}`,
    headers: ctx.headers,
  });
  const revoked = await run(session.threadId);
  assert.equal(revoked.state, "awaiting_credentials");
  await ctx.post(`/api/credentials/runs/${revoked.requestId}/cancel`, {});
  checks.push("Revocation blocks subsequent execution until authorized again");
  stage = "transient restart";
  const ephemeral = await run();
  await authorize(ephemeral, "thread");
  await ctx.app.close();
  ctx = await open();
  const lost = await run(ephemeral.threadId);
  assert.equal(lost.state, "awaiting_credentials");
  await ctx.post(`/api/credentials/runs/${lost.requestId}/cancel`, {});
  checks.push("Thread authorization expires on service restart without replay");
  stage = "restart";
  const credentialOwner = ctx.headers;
  const credentialReceiptId = await fields(
    "provider",
    "sample",
    [{ kind: "bearer", name: "Authorization" }],
    { "bearer:Authorization": secrets.provider },
  );
  await ctx.app.close();
  ctx = await open();
  const receipt = await ctx.app.inject({
    url: `/api/credentials/${credentialReceiptId}`,
    headers: credentialOwner,
  });
  assert.equal(receipt.statusCode, 200, receipt.body);
  assert.equal(receipt.json().state, "succeeded", receipt.body);
  checks.push(
    "Private save receipt survives restart and can resolve a lost response without resubmitting values",
  );
  const restarted = await run();
  await done(restarted);
  checks.push("Encrypted global fields restore after Bridge restart");
  stage = "leak scan";
  assert.ok(
    calls
      .filter((c) => c.kind === "model")
      .every((c) => c.correct && !c.privateBody),
  );
  assert.ok(
    calls
      .filter((c) => c.kind === "mcp")
      .every((c) => c.correct && c.providerAbsent),
  );
  assert.ok(
    !events.some((e) => Object.values(secrets).some((s) => e.includes(s))),
  );
  const normal = [
    (await ctx.get("/api/config?view=saved")).body,
    (await ctx.get(`/api/threads/${first.threadId}`)).body,
    JSON.stringify(ctx.db.raw.prepare("SELECT * FROM run_context").all()),
    JSON.stringify(
      ctx.db.raw.prepare("SELECT * FROM private_field_sets").all(),
    ),
  ];
  assert.ok(
    normal.every((text) =>
      Object.values(secrets).every((s) => !text.includes(s)),
    ),
  );
  async function scan(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await scan(p);
      else if (e.isFile()) {
        const bytes = await readFile(p);
        assert.ok(
          Object.values(secrets).every((s) => !bytes.includes(Buffer.from(s))),
          "secret in file " + p.slice(root.length),
        );
      }
    }
  }
  await scan(home);
  await scan(directory);
  if (ctx.runtime.runtimeLogHome) await scan(ctx.runtime.runtimeLogHome);
  checks.push(
    "No private marker in model context, public events, config, native history, run snapshots or persistent files",
  );
  await rm(join(output, "failure.json"), { force: true });
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      { codex: "0.165.0", syntheticReceivers: true, checks, calls },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ checks, calls: calls.length }));
} catch (error) {
  await writeFile(
    join(output, "failure.json"),
    JSON.stringify({ stage, message: error.message, checks, calls }, null, 2),
  );
  throw error;
} finally {
  await ctx?.app.close();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await rm(root, { recursive: true, force: true });
}
