// Real isolated native runtime and product import/run paths. Only model HTTP is simulated.
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.ts";
import { Codex } from "../server/codex.ts";
import { ProviderRuntime } from "../server/provider-runtime.ts";
const directory = await mkdtemp(join(tmpdir(), "issue001-native-resources-")),
  cwd = join(directory, "work"),
  home = join(directory, "codex");
await mkdir(cwd);
await mkdir(home);
const evidence = resolve(".issue/2026-11-11/evidence-issue-001");
await mkdir(evidence, { recursive: true });
process.env.ENABLE_TEST_MCP = "false";
process.env.ENABLE_OFFICIAL_MCP = "false";
process.env.EXPERIMENTAL_PLUGINS = "true";
const requests = [],
  completed = new Map(),
  checks = [];
let release,
  blocked = false,
  ctx,
  stage = "start";
const upstream = httpServer(async (req, res) => {
  if (req.url.endsWith("/models")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] }));
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push(raw);
  if (
    body.input.some((x) => JSON.stringify(x).includes("HOLD_VERSION")) &&
    !blocked
  ) {
    blocked = true;
    await new Promise((r) => {
      release = r;
    });
  }
  const item = {
    id: "msg_" + requests.length,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text: "RESOURCE_REPLY_" + requests.length,
        annotations: [],
      },
    ],
  };
  const response = {
    id: "resp_" + requests.length,
    object: "response",
    status: "completed",
    model: body.model,
    output: [item],
    usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
  };
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of [
    {
      type: "response.created",
      response: { ...response, status: "in_progress", output: [] },
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ])
    res.write("data: " + JSON.stringify(event) + "\n\n");
  res.end();
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${upstream.address().port}`;
const wait = async (predicate) => {
  const until = Date.now() + 40000;
  while (!predicate()) {
    if (Date.now() > until) throw Error("timeout at " + stage);
    await new Promise((r) => setTimeout(r, 20));
  }
};
const skill = (name, marker) =>
  `---\nname: ${name}\ndescription: ${marker}\n---\n${marker}\n`;
const activationFile = join(directory, "activation.log");
const activationLog = () => readFile(activationFile, "utf8").catch(() => "");
const pluginFiles = (marker) => ({
  ".codex-plugin/plugin.json": JSON.stringify({
    name: "version-probe",
    version: marker === "VERSION_ONE" ? "1.0.0" : "2.0.0",
    skills: "./skills/",
  }),
  "skills/alpha/SKILL.md": skill("alpha", marker),
  "skills/beta/SKILL.md": skill("beta", "DISABLED_PLUGIN_SKILL"),
  "assets/value.txt": marker,
  ".mcp.json": JSON.stringify({
    mcpServers: {
      probe: {
        command: process.execPath,
        args: [
          "-e",
          `
 const fs=require('node:fs');fs.appendFileSync(${JSON.stringify(activationFile)},'mcp ${marker}\\n');
 require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
 const result=m.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'resource-probe',version:'1'}}:m.method==='tools/list'?{tools:[{name:'version_read',description:'MCP_TOOL_${marker}',inputSchema:{type:'object',properties:{}}}]}:m.method==='tools/call'?{content:[{type:'text',text:'${marker}'}]}:{};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});
 `.replace(/\n/g, " "),
        ],
      },
    },
  }),
  "hooks/hooks.json": JSON.stringify({
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command: 'printf "hook ' + marker + '\\n" >> newbot-hook-proof',
            },
          ],
        },
      ],
    },
  }),
});
const scan = async (name, files) => {
  const s = await ctx.imports.create({ kind: "files", name });
  for (const [path, text] of Object.entries(files))
    await ctx.imports.upload(s.id, path, Buffer.from(text));
  return ctx.imports.scan(s.id);
};
const install = async (s, replace = false) =>
  ctx.imports.install(s.id, {
    operationId: randomUUID(),
    digest: s.digest,
    choices: s.entries.map((e) => ({
      id: e.id,
      skills: e.skills.filter((x) => !x.name.endsWith("beta")).map((x) => x.id),
      confirmPackage: e.kind === "plugin",
      replace,
    })),
  });
async function open() {
  const native = new Codex(cwd, () => ({ CODEX_HOME: home }));
  const receive = native.receive.bind(native);
  native.receive = (message) => {
    if (message.error)
      console.error("native fixture error", JSON.stringify(message.error));
    receive(message);
  };
  const app = await createServer({
    directory,
    cwd,
    codex: native,
    providerRuntime: new ProviderRuntime(),
    password: "issue001-native-test",
  });
  native.on("event", (e) => {
    if (e.method === "turn/completed")
      completed.set(e.params.turn.id, e.params.turn);
  });
  await native.start();
  assert.equal(native.state, "ready", native.reason);
  assert.equal(native.runtimeCapabilities.pinnedPluginRoots, true);
  return app;
}
try {
  ctx = await open();
  ctx.runtime.providerRuntime.apply(ctx.runtime.providerRuntime.revision, [
    {
      keyPath: "model_providers",
      value: {
        fixture: {
          name: "Fixture",
          base_url: base,
          wire_api: "responses",
          requires_openai_auth: false,
        },
      },
      mergeStrategy: "replace",
    },
    { keyPath: "model_provider", value: "fixture", mergeStrategy: "replace" },
    { keyPath: "model", value: "gpt-6.1-sol", mergeStrategy: "replace" },
  ]);
  stage = "first import";
  let scanned = await scan("plugin", pluginFiles("VERSION_ONE"));
  assert.equal(await activationLog(), "", "scan must not execute code");
  let done = await install(scanned);
  assert.equal(
    await activationLog(),
    "",
    "install and hook listing must not execute code",
  );
  assert.equal(done.entries[0].state, "installed", JSON.stringify(done));
  let detail = await ctx.service.plugins.read("version-probe@newbot-imports");
  assert.equal(detail.installed, true);
  assert.equal(
    detail.skills.find((s) => s.name.endsWith("beta")).enabled,
    false,
  );
  assert.equal(
    await activationLog(),
    "",
    "plugin details must not execute code",
  );
  const thread = await ctx.service.handle("thread/start", {
    provider: "fixture",
    model: "gpt-6.1-sol",
  });
  stage = "unselected";
  let turn = await ctx.service.handle("turn/start", {
    threadId: thread.id,
    text: "NO_PLUGIN_SELECTED",
  });
  await wait(() => completed.has(turn.turn.id));
  assert.equal(completed.get(turn.turn.id).status, "completed");
  assert.equal(requests.at(-1).includes("VERSION_ONE"), false);
  assert.equal(
    await activationLog(),
    "",
    "scanning and unselected turns must not start plugin MCP or hooks",
  );
  checks.push(
    "scanning/installing/unselected turns do not start plugin MCP or hooks; plugin skills absent from actual model input",
  );
  stage = "selected active";
  turn = await ctx.service.handle("turn/start", {
    threadId: thread.id,
    text: "HOLD_VERSION",
    plugins: ["version-probe@newbot-imports"],
  });
  await wait(() => blocked);
  assert.ok(requests.at(-1).includes("VERSION_ONE"));
  const status = await ctx.runtime.call("mcpServerStatus/list", {
    threadId: thread.id,
  });
  const connected = status.data.find((s) => s.runtimeStatus === "connected");
  assert.equal(
    connected.tools.version_read.description,
    "MCP_TOOL_VERSION_ONE",
  );
  const toolResult = await ctx.runtime.call("mcpServer/tool/call", {
    threadId: thread.id,
    server: connected.name,
    tool: "version_read",
    arguments: {},
  });
  assert.ok(JSON.stringify(toolResult).includes("VERSION_ONE"));
  assert.ok((await activationLog()).includes("mcp VERSION_ONE"));
  assert.ok(
    (
      await readFile(
        join(ctx.workspaces.root(thread.id), "newbot-hook-proof"),
        "utf8",
      )
    ).includes("hook VERSION_ONE"),
    "selected native hook executes",
  );
  assert.equal(requests.at(-1).includes("DISABLED_PLUGIN_SKILL"), false);
  const oldSnapshot = ctx.workspaces.saved(thread.id).snapshot,
    oldRoot =
      oldSnapshot.config.plugins["version-probe@newbot-imports"].local_root;
  assert.equal(
    await readFile(join(oldRoot, "assets/value.txt"), "utf8"),
    "VERSION_ONE",
  );
  stage = "upgrade while active";
  scanned = await scan("plugin", pluginFiles("VERSION_TWO"));
  done = await install(scanned, true);
  assert.equal(done.entries[0].state, "installed", JSON.stringify(done));
  assert.ok(ctx.runtime.active.has(thread.id));
  assert.equal(
    ctx.workspaces.saved(thread.id).snapshot.config.plugins[
      "version-probe@newbot-imports"
    ].local_root,
    oldRoot,
  );
  assert.equal(
    await readFile(join(oldRoot, "assets/value.txt"), "utf8"),
    "VERSION_ONE",
  );
  checks.push(
    "explicit plugin activation starts native MCP and hooks and includes only enabled skills",
  );
  checks.push(
    "upgrade publishes while a real model request remains in flight, without changing its pinned files",
  );
  stage = "native marketplace install while active";
  const marketRoot = join(cwd, "market-probe");
  await mkdir(join(cwd, ".agents/plugins"), { recursive: true });
  await mkdir(join(marketRoot, ".codex-plugin"), { recursive: true });
  await mkdir(join(marketRoot, "skills/market"), { recursive: true });
  await writeFile(
    join(marketRoot, "skills/market/SKILL.md"),
    skill("market", "MARKET_VERSION_ONE"),
  );
  const manifest = (version) =>
    JSON.stringify({ name: "market-probe", version, skills: "./skills/" });
  await writeFile(
    join(marketRoot, ".codex-plugin/plugin.json"),
    manifest("1.0.0"),
  );
  await writeFile(
    join(cwd, ".agents/plugins/marketplace.json"),
    JSON.stringify({
      name: "fixture-market",
      plugins: [
        {
          name: "market-probe",
          source: { source: "local", path: "./market-probe" },
        },
      ],
    }),
  );
  await ctx.service.handle("plugin/install", {
    id: "market-probe@fixture-market",
  });
  let marketDetail = await ctx.service.plugins.read(
    "market-probe@fixture-market",
  );
  assert.equal(marketDetail.installed, true);
  assert.equal(marketDetail.version, "1.0.0");
  const marketOld = ctx.runtime.extensionRuntime.resources.plugin(
    "market-probe@fixture-market",
  ).path;
  await ctx.service.handle("plugin/skill/enabled", {
    pluginId: marketDetail.id,
    id: marketDetail.skills[0].id,
    enabled: false,
    expectedRevision: marketDetail.extensionRevision,
  });
  await writeFile(
    join(marketRoot, ".codex-plugin/plugin.json"),
    manifest("2.0.0"),
  );
  await writeFile(
    join(marketRoot, "skills/market/SKILL.md"),
    skill("market", "MARKET_VERSION_TWO"),
  );
  await ctx.service.handle("plugin/update", {
    id: "market-probe@fixture-market",
    expectedVersion: "1.0.0",
    targetVersion: "2.0.0",
  });
  marketDetail = await ctx.service.plugins.read("market-probe@fixture-market");
  assert.equal(marketDetail.version, "2.0.0");
  assert.equal(marketDetail.skills[0].enabled, false);
  assert.ok(
    (
      await readFile(join(marketOld, "skills/market/SKILL.md"), "utf8")
    ).includes("MARKET_VERSION_ONE"),
  );
  assert.ok(ctx.runtime.active.has(thread.id));
  checks.push(
    "native marketplace installation and upgrade finish during another active request and preserve skill choices and old bytes",
  );
  release();
  await wait(() => completed.has(turn.turn.id));
  stage = "next version";
  turn = await ctx.service.handle("turn/start", {
    threadId: thread.id,
    text: "USE_UPDATED_PLUGIN",
    plugins: ["version-probe@newbot-imports"],
  });
  await wait(() => completed.has(turn.turn.id));
  assert.equal(completed.get(turn.turn.id).status, "completed");
  const newRoot = ctx.workspaces.saved(thread.id).snapshot.config.plugins[
    "version-probe@newbot-imports"
  ].local_root;
  assert.notEqual(newRoot, oldRoot);
  assert.equal(
    await readFile(join(newRoot, "assets/value.txt"), "utf8"),
    "VERSION_TWO",
  );
  const catalog = await ctx.service.skills.list();
  assert.ok(catalog.skills.some((s) => s.path.startsWith(newRoot)));
  assert.ok(!catalog.skills.some((s) => s.path.startsWith(oldRoot)));
  checks.push(
    "same native thread selects new resource version on its next turn; disabled sibling stays disabled",
  );
  stage = "remove selection on same thread";
  const beforeMcp = await activationLog();
  const hookFile = join(ctx.workspaces.root(thread.id), "newbot-hook-proof");
  const beforeHooks = await readFile(hookFile, "utf8");
  turn = await ctx.service.handle("turn/start", {
    threadId: thread.id,
    text: "NO_CURRENT_PLUGIN",
    plugins: [],
  });
  await wait(() => completed.has(turn.turn.id));
  assert.equal(completed.get(turn.turn.id).status, "completed");
  const inactive = await ctx.runtime.call("mcpServerStatus/list", {
    threadId: thread.id,
  });
  assert.equal(
    inactive.data.some((s) => !!s.tools?.version_read),
    false,
  );
  assert.equal(await activationLog(), beforeMcp);
  assert.equal(await readFile(hookFile, "utf8"), beforeHooks);
  assert.equal(
    ctx.workspaces.saved(thread.id).snapshot.config.plugins[
      "version-probe@newbot-imports"
    ].enabled,
    false,
  );
  checks.push(
    "removing the plugin selection on the same thread removes live tools and does not execute plugin MCP or hooks",
  );
  await ctx.app.close();
  ctx = undefined;
  ctx = await open();
  stage = "restart and uninstall while active";
  blocked = false;
  release = undefined;
  turn = await ctx.service.handle("turn/start", {
    threadId: thread.id,
    text: "HOLD_VERSION_AFTER_RESTART",
    plugins: ["version-probe@newbot-imports"],
  });
  await wait(() => blocked);
  assert.equal(
    ctx.workspaces.saved(thread.id).snapshot.config.plugins[
      "version-probe@newbot-imports"
    ].local_root,
    newRoot,
  );
  const restored = await ctx.runtime.call("mcpServerStatus/list", {
    threadId: thread.id,
  });
  const restoredServer = restored.data.find((s) => !!s.tools?.version_read);
  assert.equal(
    restoredServer.tools.version_read.description,
    "MCP_TOOL_VERSION_TWO",
  );
  checks.push(
    "restart restores the selected immutable version, native MCP and the original thread",
  );
  await ctx.service.handle("plugin/uninstall", {
    id: "version-probe@newbot-imports",
  });
  assert.equal(
    (await ctx.service.plugins.read("version-probe@newbot-imports")).installed,
    false,
  );
  assert.ok(ctx.runtime.active.has(thread.id));
  const retainedTool = await ctx.runtime.call("mcpServer/tool/call", {
    threadId: thread.id,
    server: restoredServer.name,
    tool: "version_read",
    arguments: {},
  });
  assert.ok(JSON.stringify(retainedTool).includes("VERSION_TWO"));
  release();
  await wait(() => completed.has(turn.turn.id));
  assert.equal(completed.get(turn.turn.id).status, "completed");
  await assert.rejects(
    ctx.service.handle("turn/start", {
      threadId: thread.id,
      text: "REJECT_REMOVED",
      plugins: ["version-probe@newbot-imports"],
    }),
  );
  assert.equal(
    await readFile(join(oldRoot, "assets/value.txt"), "utf8"),
    "VERSION_ONE",
  );
  checks.push(
    "uninstall during an active task preserves its executable resources, then rejects new activation and preserves history",
  );
  await writeFile(
    join(evidence, "resource-native.json"),
    JSON.stringify(
      {
        binary: process.env.CODEX_BIN,
        upstream:
          "simulated loopback Responses; real native runtime and product paths",
        checks,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length }));
} catch (e) {
  console.error(stage, String(e));
  await writeFile(
    join(evidence, "resource-native-failure.json"),
    JSON.stringify({ stage, error: String(e), checks }, null, 2),
  );
  throw e;
} finally {
  release?.();
  await ctx?.app.close();
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  await rm(directory, { recursive: true, force: true });
}
