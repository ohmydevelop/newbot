import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
const dir = await mkdtemp(join(tmpdir(), "newbot-issue03-plan-probe-")),
  codeHome = join(dir, "codex"),
  userHome = join(dir, "user"),
  a = join(dir, "a"),
  b = join(dir, "b");
for (const p of [codeHome, userHome, a, b]) await mkdir(p);
for (const [root, name] of [
  [a, "alpha-only"],
  [b, "beta-only"],
]) {
  const p = join(root, ".agents", "skills", name);
  await mkdir(p, { recursive: true });
  await writeFile(
    join(p, "SKILL.md"),
    "---\nname: " +
      name +
      "\ndescription: ISOLATED_" +
      name +
      "_MARKER\n---\n" +
      name +
      " instructions.\n",
  );
}
await writeFile(
  join(dir, "AGENTS.md"),
  "PARENT_INSTRUCTION_SHOULD_NOT_BE_LOADED",
);
const market = join(dir, "market"),
  mf = join(market, ".agents", "plugins", "marketplace.json");
await mkdir(join(market, ".agents", "plugins"), { recursive: true });
await cp(
  "examples/test-plugin-marketplace/plugins/newbot-test-plugin",
  join(market, "plugin"),
  { recursive: true },
);
await rm(join(market, "plugin", "plugin.json"));
await mkdir(join(market, "plugin", ".codex-plugin"));
await writeFile(
  join(market, "plugin", ".codex-plugin", "plugin.json"),
  JSON.stringify({
    name: "newbot-test-plugin",
    version: "0.1.0",
    skills: "./skills/",
    mcpServers: "./.mcp.json",
  }),
);
await writeFile(
  join(market, "plugin", ".mcp.json"),
  JSON.stringify({
    mcpServers: {
      bundle_probe: {
        command: process.execPath,
        args: [resolve("dist/mcp-test/server.js")],
      },
    },
  }),
);
await writeFile(
  mf,
  JSON.stringify({
    name: "plan-probe",
    plugins: [
      {
        name: "newbot-test-plugin",
        source: { source: "local", path: "./plugin" },
      },
    ],
  }),
);
const env = { PATH: process.env.PATH, HOME: userHome, CODEX_HOME: codeHome },
  binary = resolve("node_modules/.bin/codex");
const setup = spawnSync(
  binary,
  ["plugin", "marketplace", "add", market, "--json"],
  { env, encoding: "utf8" },
);
const requests = [];
const upstream = createServer(async (req, res) => {
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  requests.push({
    a: raw.includes("ISOLATED_alpha-only_MARKER"),
    b: raw.includes("ISOLATED_beta-only_MARKER"),
    plugin: raw.includes("newbot-test-plugin:"),
  });
  const n = requests.length,
    id = "resp_" + n,
    mid = "msg_" + n,
    item = {
      id: mid,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [
        { type: "output_text", text: "PLANNING_PROBE_OK", annotations: [] },
      ],
    },
    response = {
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
      delta: "PLANNING_PROBE_OK",
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ])
    res.write("data: " + JSON.stringify(e) + "\n\n");
  res.end();
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const child = spawn(
  binary,
  [
    "app-server",
    "--listen",
    "stdio://",
    "-c",
    "project_root_markers=[]",
    "-c",
    "thread_unload_delay_secs=1",
  ],
  { cwd: a, env, stdio: ["pipe", "pipe", "pipe"] },
);
child.stderr.resume();
let seq = 0;
const pending = new Map(),
  events = [];
createInterface({ input: child.stdout }).on("line", (line) => {
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    return;
  }
  const p = pending.get(e.id);
  if (p) {
    pending.delete(e.id);
    clearTimeout(p.timer);
    e.error ? p.reject(Error(JSON.stringify(e.error))) : p.resolve(e.result);
  } else events.push(e);
});
const call = (method, params) =>
  new Promise((resolve, reject) => {
    const id = ++seq,
      timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("timeout " + method));
      }, 20000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
const wait = async (predicate) => {
  const end = Date.now() + 20000;
  while (!predicate()) {
    if (Date.now() > end) throw Error("event timeout");
    await new Promise((r) => setTimeout(r, 30));
  }
};
const report = {
  nativeVersion: "0.165.0",
  localMarketplaceReady: setup.status === 0,
};
let stage = "initialize";
try {
  await call("initialize", {
    clientInfo: { name: "newbot_plan_probe", version: "1" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  stage = "plugin-install";
  await call("plugin/install", {
    marketplacePath: mf,
    pluginName: "newbot-test-plugin",
  });
  const pl = await call("plugin/list", {
    cwds: [a],
    marketplaceKinds: ["local"],
  });
  const pid = pl.marketplaces
    .flatMap((m) => m.plugins)
    .find((p) => p.name === "newbot-test-plugin").id;
  report.bundledMcp = (
    await call("plugin/read", {
      marketplacePath: mf,
      pluginName: "newbot-test-plugin",
    })
  ).plugin.mcpServers;
  const fixture = {
      command: process.execPath,
      args: [resolve("dist/mcp-test/server.js")],
      enabled: true,
    },
    config = {
      model_provider: "probe",
      model_providers: {
        probe: {
          name: "Planning probe",
          base_url: "http://127.0.0.1:" + upstream.address().port,
          wire_api: "responses",
          requires_openai_auth: false,
        },
      },
    };
  stage = "start-threads";
  const ta = await call("thread/start", {
      cwd: a,
      model: "gpt-6.1-sol",
      modelProvider: "probe",
      config: {
        ...config,
        mcp_servers: { alpha: fixture },
        plugins: { [pid]: { enabled: false } },
      },
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    }),
    tb = await call("thread/start", {
      cwd: b,
      model: "gpt-6.1-sol",
      modelProvider: "probe",
      config: { ...config, mcp_servers: { beta: fixture } },
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
  const names = (v) =>
    v.data.map((s) => ({
      name: s.name,
      tools: Object.keys(s.tools || {}).length,
    }));
  report.mcpA = names(
    await call("mcpServerStatus/list", {
      threadId: ta.thread.id,
      detail: "toolsAndAuthOnly",
    }),
  );
  report.mcpB = names(
    await call("mcpServerStatus/list", {
      threadId: tb.thread.id,
      detail: "toolsAndAuthOnly",
    }),
  );
  const sk = await call("skills/list", { cwds: [a, b], forceReload: true });
  report.skills = sk.data.map((d) => ({
    workspace: d.cwd === a ? "a" : "b",
    names: d.skills.map((s) => s.name),
  }));
  report.parentInstructionsLoaded = [ta, tb].some((t) =>
    JSON.stringify(t.instructionSources).includes(join(dir, "AGENTS.md")),
  );
  try {
    await call("mcpServer/tool/call", {
      threadId: ta.thread.id,
      server: "beta",
      tool: "get_metrics",
      arguments: {},
    });
    report.crossThreadToolRejected = false;
  } catch {
    report.crossThreadToolRejected = true;
  }
  const run = async (threadId, disabledPluginIds) => {
    const r = await call("turn/start", {
      threadId,
      disabledPluginIds,
      input: [{ type: "text", text: "Return OK", text_elements: [] }],
    });
    await wait(() =>
      events.some(
        (e) => e.method === "turn/completed" && e.params.turn.id === r.turn.id,
      ),
    );
    return events.find(
      (e) => e.method === "turn/completed" && e.params.turn.id === r.turn.id,
    ).params.turn.status;
  };
  stage = "turns";
  report.turnStatusA = await run(ta.thread.id, []);
  report.turnStatusB = await run(tb.thread.id, []);
  report.requests = requests;
  stage = "resume";
  await call("thread/unsubscribe", { threadId: ta.thread.id });
  await wait(() =>
    events.some(
      (e) => e.method === "thread/closed" && e.params.threadId === ta.thread.id,
    ),
  );
  const rr = await call("thread/resume", {
    threadId: ta.thread.id,
    cwd: a,
    modelProvider: "probe",
    config: { ...config, mcp_servers: { beta: fixture } },
    excludeTurns: true,
  });
  report.sameThreadResumed = rr.thread.id === ta.thread.id;
  report.changedThreadMcp = names(
    await call("mcpServerStatus/list", {
      threadId: ta.thread.id,
      detail: "toolsAndAuthOnly",
    }),
  );
  report.otherThreadMcp = names(
    await call("mcpServerStatus/list", {
      threadId: tb.thread.id,
      detail: "toolsAndAuthOnly",
    }),
  );
  assert.deepEqual(report.bundledMcp, ["bundle_probe"]);
  assert.deepEqual(
    report.mcpA.map((m) => m.name),
    ["alpha"],
  );
  assert.deepEqual(report.mcpB.map((m) => m.name).sort(), [
    "beta",
    "bundle_probe",
  ]);
  assert.equal(report.parentInstructionsLoaded, false);
  assert.equal(report.crossThreadToolRejected, true);
  assert.equal(report.turnStatusA, "completed");
  assert.equal(report.turnStatusB, "completed");
  assert.deepEqual(report.requests, [
    { a: true, b: false, plugin: false },
    { a: false, b: true, plugin: true },
  ]);
  assert.equal(report.sameThreadResumed, true);
  assert.deepEqual(report.changedThreadMcp.map((m) => m.name).sort(), [
    "beta",
    "bundle_probe",
  ]);
  assert.deepEqual(report.otherThreadMcp.map((m) => m.name).sort(), [
    "beta",
    "bundle_probe",
  ]);
  report.checks = 9;
} catch (e) {
  report.failedAt = stage;
  report.error = String(e);
  process.exitCode = 1;
} finally {
  const output = resolve(
    process.env.EXTENSION_EVIDENCE_DIR ||
      ".issue/2026-11-10/evidence-issue-03/native",
  );
  await mkdir(output, { recursive: true });
  await writeFile(
    join(output, "extension-native.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  for (const p of pending.values()) clearTimeout(p.timer);
  await rm(dir, { recursive: true, force: true });
}
