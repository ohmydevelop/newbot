// Product run/private-input APIs + pinned Codex; only synthetic Provider and MCP.
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.ts";
import { Codex } from "../server/codex.ts";
import { ProviderRuntime } from "../server/provider-runtime.ts";
const directory = await mkdtemp(join(tmpdir(), "newbot-plugin-session-"));
const cwd = join(directory, "work"),
  home = join(directory, "codex");
await mkdir(cwd);
await mkdir(home);
const evidence = resolve(
  process.env.PLUGIN_SESSION_EVIDENCE ||
    ".issue/2026-11-11/evidence-plugin-session-tools",
);
await mkdir(evidence, { recursive: true });
const origin = "http://127.0.0.1:3100",
  pluginId = "session-probe@newbot-imports";
const secret = "synthetic-session-key-NOT-FOR-MODEL",
  callLog = join(directory, "tool-calls.jsonl");
const checks = [],
  requests = [],
  completed = new Map();
let ctx,
  headers,
  stage = "start",
  scenario,
  protocolError;
const toolNames = (tools) =>
  (tools || []).flatMap((t) =>
    t.type === "namespace" ? toolNames(t.tools) : t.name || [],
  );
const upstream = httpServer(async (req, res) => {
  try {
    if (req.url.endsWith("/models")) {
      res.end(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      names = toolNames(
        body.tools ||
          body.input?.find((i) => i.type === "additional_tools")?.tools,
      );
    assert.ok(!raw.includes(secret), "secret appeared in model request");
    requests.push({
      case: scenario.label,
      codeMode: names.includes("exec"),
      history: raw.includes("ORIGINAL_HISTORY"),
      result: raw.includes("PROBE_VERSION_"),
    });
    const number = requests.length,
      responseId = "response_" + number;
    let item, events;
    if ((scenario.call || scenario.absent) && !scenario.sent) {
      assert.ok(
        names.includes("exec"),
        "pinned model exposes the code-mode tool entry",
      );
      scenario.sent = true;
      item = {
        type: "custom_tool_call",
        id: "fc_" + number,
        call_id: "call_" + number,
        name: "exec",
        namespace: "functions",
        input: `const matches = ALL_TOOLS.filter(t => /mcp__plugin_.*__probe$/.test(t.name)); text(${JSON.stringify(scenario.label + ":CATALOG_COUNT_")} + matches.length); ${scenario.call ? `if (matches.length !== 1) throw Error("Expected one current probe"); text(await tools[matches[0].name]({text: ${JSON.stringify(scenario.label)}}));` : ""}`,
        status: "completed",
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
      if (scenario.call)
        assert.ok(
          raw.includes("PROBE_VERSION_" + scenario.version),
          "tool result missing from follow-up model request",
        );
      if (scenario.absent || scenario.call) {
        const result = (body.input || [])
          .filter((i) => i.type === "custom_tool_call_output")
          .at(-1);
        assert.ok(
          JSON.stringify(result).includes(
            scenario.label + ":CATALOG_COUNT_" + (scenario.call ? 1 : 0),
          ),
          JSON.stringify(result),
        );
      }
      item = {
        id: "msg_" + number,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "SYNTHETIC_OK_" + scenario.label,
            annotations: [],
          },
        ],
      };
      events = [
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { ...item, status: "in_progress", content: [] },
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
          delta: item.content[0].text,
        },
      ];
    }
    const response = {
      id: responseId,
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
  } catch (error) {
    protocolError = error;
    res.writeHead(500);
    res.end("synthetic assertion failed");
  }
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + upstream.address().port;
process.env.ENABLE_TEST_MCP = "false";
process.env.ENABLE_OFFICIAL_MCP = "false";
process.env.EXPERIMENTAL_PLUGINS = "true";
async function open() {
  const native = new Codex(cwd, () => ({ CODEX_HOME: home }));
  ctx = await createServer({
    directory,
    cwd,
    codex: native,
    providerRuntime: new ProviderRuntime(),
    password: "synthetic-session-password",
    origins: [origin],
  });
  native.on("event", (e) => {
    if (e.method === "turn/completed")
      completed.set(e.params.turn.id, e.params.turn);
  });
  await native.start();
  assert.equal(native.state, "ready");
  const l = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password: "synthetic-session-password" },
  });
  assert.equal(l.statusCode, 200);
  headers = { origin, cookie: l.headers["set-cookie"].split(";")[0] };
}
const post = (url, payload) =>
  ctx.app.inject({ method: "POST", url, headers, payload });
const calls = async () =>
  (await readFile(callLog, "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map(JSON.parse);
async function run(
  threadId,
  label,
  { call = false, version = "1.0.0", absent = false, extra = {} } = {},
) {
  scenario = { label, call, version, absent, sent: false };
  protocolError = null;
  const before = (await calls()).length;
  const r = await post("/api/agent/run", {
    requestId: randomUUID(),
    ...(threadId ? { threadId } : {}),
    text: label,
    ...extra,
  });
  assert.equal(r.statusCode, 200, r.body);
  const v = r.json();
  const until = Date.now() + 20000;
  while (!completed.has(v.turn.id)) {
    if (protocolError) throw protocolError;
    if (Date.now() > until) throw Error("turn timeout " + label);
    await new Promise((r) => setTimeout(r, 25));
  }
  if (protocolError) throw protocolError;
  assert.equal(completed.get(v.turn.id).status, "completed");
  assert.equal(
    (await calls()).length - before,
    call ? 1 : 0,
    "exactly one business tool execution per requested call",
  );
  if (threadId) assert.equal(v.threadId, threadId);
  return v.threadId;
}
async function rejected(threadId, extra, pattern = /连接器/) {
  const before = requests.length,
    count = (await calls()).length,
    requestId = randomUUID();
  const r = await post("/api/agent/run", {
    requestId,
    threadId,
    text: "MUST_NOT_DISPATCH",
    ...extra,
  });
  assert.ok(r.statusCode >= 400, r.body);
  assert.match(r.json().error, pattern);
  assert.equal(requests.length, before);
  assert.equal((await calls()).length, count);
  return requestId;
}
async function install(version, update = false) {
  const s = await ctx.imports.create({
    kind: "files",
    name: "session-probe",
    ...(update ? { updatePluginId: pluginId } : {}),
  });
  const files = {
    "plugin.json": JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "session-probe",
      version,
    }),
    "mcp.json": JSON.stringify({
      mcpServers: {
        probe: { command: process.execPath, args: ["${PLUGIN_ROOT}/main.mjs"] },
      },
    }),
    "manifest.json": JSON.stringify({
      manifest_version: "0.3",
      name: "probe",
      version,
      description: "Synthetic readiness probe",
      author: { name: "Test" },
      server: {
        type: "node",
        entry_point: "main.mjs",
        mcp_config: {
          command: process.execPath,
          args: ["${__dirname}/main.mjs"],
          env: {
            PROBE_URL: "${user_config.url}",
            PROBE_KEY: "${user_config.key}",
            PROBE_OPTION: "${user_config.option}",
          },
        },
      },
      user_config: {
        url: { type: "string", title: "服务地址", required: true },
        key: { type: "string", title: "密钥", required: true, sensitive: true },
        option: { type: "string", title: "参数", default: "" },
      },
    }),
    "skills/note/SKILL.md":
      "---\nname: session-note\ndescription: Synthetic plugin skill\n---\nUse the currently available probe tool.\n",
    "main.mjs": `import {createInterface} from 'node:readline'; import {appendFileSync} from 'node:fs';
if(process.env.PROBE_OPTION==='fail-start')process.exit(1);
createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);if(r.id===undefined)return;let result;
if(r.method==='initialize')result={protocolVersion:r.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'probe',version:${JSON.stringify(version)}}};
else if(r.method==='tools/list')result={tools:[{name:'probe',description:'Synthetic probe',inputSchema:{type:'object',properties:{text:{type:'string'}},required:['text']},annotations:{readOnlyHint:true}}]};
else if(r.method==='tools/call'){if(!process.env.PROBE_KEY)throw Error('missing synthetic key');appendFileSync(${JSON.stringify(callLog)},JSON.stringify({version:${JSON.stringify(version)},text:r.params.arguments.text,option:process.env.PROBE_OPTION})+'\\n');result={content:[{type:'text',text:'PROBE_VERSION_${version}'}]};}
else result={resources:[],resourceTemplates:[],prompts:[]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');});`,
  };
  for (const [p, v] of Object.entries(files))
    await ctx.imports.upload(s.id, p, Buffer.from(v));
  const scan = await ctx.imports.scan(s.id);
  assert.equal(scan.entries.length, 1);
  assert.equal(scan.entries[0].kind, "plugin");
  const result = await ctx.imports.install(s.id, {
    operationId: randomUUID(),
    digest: scan.digest,
    choices: scan.entries.map((e) => ({
      id: e.id,
      confirmPackage: true,
      replace: !!e.previousDigest,
      skills: e.selectedSkills || e.skills.map((s) => s.id),
    })),
  });
  assert.equal(result.entries[0].state, "installed", JSON.stringify(result));
}
const connection = async () =>
  (await ctx.service.pluginConnections.list(pluginId))[0];
async function save(
  option = "",
  { key = secret, enabled = true, clear = false } = {},
) {
  const c = await connection(),
    requestId = randomUUID();
  const ticket = await post("/api/credentials/requests", {
    operation: "plugin.configuration.save",
    requestId,
    pluginId,
    connectionId: c.id,
    expectedRevision: c.revision,
    schemaDigest: c.schemaDigest,
    values: { url: "https://synthetic.invalid", option },
    enabled,
    clearSecrets: clear ? ["key"] : [],
  });
  assert.equal(ticket.statusCode, 200, ticket.body);
  const r = await ctx.app.inject({
    method: "POST",
    url: "/api/credentials/" + ticket.json().id + "/input",
    headers: { ...headers, "content-type": "application/octet-stream" },
    payload: Buffer.from(JSON.stringify(key ? { key } : {})).toString("base64"),
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json();
}
try {
  await open();
  const cfg = (await ctx.service.configuration.read()).publicView;
  const p = await post("/api/runtime/config", {
    expectedRevision: cfg.revision,
    providers: [
      {
        id: "fixture",
        name: "Fixture",
        baseUrl: base,
        defaultModel: "gpt-6.1-sol",
      },
    ],
    defaults: { provider: "fixture", model: "gpt-6.1-sol" },
  });
  assert.equal(p.statusCode, 200, p.body);
  const a = await run(undefined, "ORIGINAL_HISTORY", { absent: true }),
    b = await run(undefined, "SECOND_THREAD", { absent: true });
  const pid = ctx.runtime.child.pid,
    snapshotB = ctx.workspaces.saved(b).revision;
  stage = "missing-private";
  await install("1.0.0");
  const missing = await save("", { key: "" });
  assert.equal(missing.state, "failed");
  assert.equal((await connection()).revision, "absent");
  const requestId = await rejected(a, { plugins: [pluginId] }, /缺少/);
  assert.equal(
    ctx.db.raw.prepare("SELECT 1 FROM runs WHERE request_id=?").get(requestId),
    undefined,
  );
  const expert = await ctx.service.experts.save({
    name: "Synthetic expert",
    description: "",
    skillIds: [],
    pluginIds: [pluginId],
    connectorIds: [],
  });
  await rejected(undefined, { expertId: expert.id }, /缺少/);
  await run(a, "UNRELATED_CHAT", { absent: true });
  checks.push(
    "missing required private input cannot be saved as success; selected plugin/expert fails before model dispatch or reservation, unrelated chat remains available",
  );
  stage = "ready";
  assert.equal((await save()).state, "succeeded");
  await run(a, "FIRST_TOOL", { call: true, extra: { plugins: [pluginId] } });
  const stableId = (await connection()).id;
  assert.equal(ctx.workspaces.saved(b).revision, snapshotB);
  checks.push(
    "same native thread exposes the current code-mode entry; model-driven ALL_TOOLS discovery finds the configured MCP tool and executes it exactly once; second thread remains unchanged",
  );
  stage = "changed-settings";
  const before = await connection();
  assert.equal((await save("changed", { key: "" })).state, "failed");
  assert.equal((await connection()).revision, before.revision);
  assert.equal((await connection()).configured, true);
  await save("changed");
  await run(a, "UPDATED_CONFIGURATION", {
    call: true,
    extra: { plugins: [pluginId] },
  });
  assert.equal((await calls()).at(-1).option, "changed");
  checks.push(
    "changing non-secret connection parameters without reauthorizing preserves old configuration and ciphertext; authorized update reaches the next turn in the original thread",
  );
  stage = "explicit-clear";
  await save("changed", { key: "", clear: true });
  await rejected(a, { plugins: [pluginId] }, /缺少/);
  await save("changed", { enabled: false, key: "" });
  await run(a, "INTENTIONALLY_DISABLED", {
    absent: true,
    extra: { plugins: [pluginId] },
  });
  await save();
  await run(a, "REENABLED", { call: true, extra: { plugins: [pluginId] } });
  checks.push(
    "explicit credential clear is reported as unconfigured and cannot dispatch; intentional component disable allows other plugin capabilities; re-enable republishes tools without new thread",
  );
  stage = "startup-failure";
  await save("fail-start");
  await rejected(a, { plugins: [pluginId] }, /未就绪/);
  await save();
  await run(a, "AFTER_STARTUP_FAILURE", {
    call: true,
    extra: { plugins: [pluginId] },
  });
  checks.push(
    "native startup failure is detected before model dispatch; corrected connector recovers on the next turn",
  );
  stage = "upgrade";
  await install("2.0.0", true);
  assert.equal((await connection()).id, stableId);
  await rejected(a, { plugins: [pluginId] }, /重新确认/);
  await save();
  await run(a, "AFTER_UPGRADE", {
    call: true,
    version: "2.0.0",
    extra: { plugins: [pluginId] },
  });
  assert.equal((await calls()).at(-1).version, "2.0.0");
  assert.equal(ctx.runtime.child.pid, pid);
  checks.push(
    "package upgrade keeps connector/native thread identity, requires fresh credentials, and actual model call reaches new code exactly once without shared runtime restart",
  );
  stage = "reinstall";
  await ctx.service.handle("plugin/uninstall", { id: pluginId });
  await rejected(a, { plugins: [pluginId] }, /停用|不可用/);
  await run(a, "AFTER_UNINSTALL", { absent: true });
  await install("2.0.0");
  assert.equal((await connection()).id, stableId);
  await rejected(a, { plugins: [pluginId] }, /缺少/);
  await save();
  await run(a, "AFTER_REINSTALL", {
    call: true,
    version: "2.0.0",
    extra: { plugins: [pluginId] },
  });
  assert.equal(ctx.runtime.child.pid, pid);
  checks.push(
    "uninstall removes the old model-visible registry; same-version reinstall requires configuration and restores calls in the original thread with stable identity and no shared restart",
  );
  stage = "restart";
  await ctx.app.close();
  await open();
  await run(a, "AFTER_RESTART", {
    call: true,
    version: "2.0.0",
    extra: { plugins: [pluginId] },
  });
  assert.equal((await connection()).id, stableId);
  assert.ok(
    requests.filter((r) => r.case !== "SECOND_THREAD").every((r) => r.history),
  );
  assert.equal(
    await readFile(join(home, "config.toml"), "utf8").catch(() => ""),
    "",
  );
  checks.push(
    "full service restart restores SQLite configuration, private credentials, original thread/history and currently callable tools; isolated config.toml remains empty",
  );
  await writeFile(
    join(evidence, "native-session.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        version: "0.165.0",
        realModelRequests: 0,
        realBusinessRequests: 0,
        syntheticModelRequests: requests.length,
        syntheticToolCalls: (await calls()).length,
        checks,
        requests,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: checks.length,
      syntheticModelRequests: requests.length,
      syntheticToolCalls: (await calls()).length,
    }),
  );
  await rm(join(evidence, "native-session-failure.json"), { force: true });
} catch (error) {
  await writeFile(
    join(evidence, "native-session-failure.json"),
    JSON.stringify(
      {
        stage,
        error: String(error),
        stack: error.stack,
        protocolError: String(protocolError),
        checks,
        requests,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await ctx?.app.close().catch(() => {});
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  await rm(directory, { recursive: true, force: true });
}
