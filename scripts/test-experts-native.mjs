// Product HTTP APIs + real pinned Codex; synthetic loopback Responses only.
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  readdir,
  cp,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.ts";
import { Codex } from "../server/codex.ts";
import { ProviderRuntime } from "../server/provider-runtime.ts";
import { importProviderConfigurationOnce } from "../server/provider-source.ts";
import { database } from "../server/db.ts";
const directory = await mkdtemp(
  join(tmpdir(), "newbot-session-extension-native-"),
);
const home = join(directory, "codex"),
  cwd = join(directory, "workspace"),
  data = join(directory, "app");
await mkdir(cwd);
await mkdir(home);
const output = resolve(
  process.env.EXTENSION_EVIDENCE_DIR ||
    ".issue/2026-11-10/evidence-issue-03/native",
);
await mkdir(output, { recursive: true });
const checks = [],
  requests = [],
  completed = new Map();
await rm(join(output, "experts-native-failure.json"), {
  force: true,
});
let alternateModel,
  rejectCatalog = false;
let hold,
  held,
  stage = "start",
  ctx;
const wait = async (predicate) => {
  const until = Date.now() + 20000;
  while (!predicate()) {
    if (Date.now() > until) throw Error("state timeout");
    await new Promise((r) => setTimeout(r, 30));
  }
};
const upstream = httpServer(async (req, res) => {
  if (req.url.endsWith("/models")) {
    if (rejectCatalog) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        data: [
          { id: "gpt-6.1-sol" },
          ...(alternateModel ? [{ id: alternateModel.model }] : []),
        ],
      }),
    );
    return;
  }
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  requests.push({
    path: req.url,
    model: body.model,
    effort: body.reasoning?.effort,
    history: ["FIRST_MEMORY_TURN", "SECOND_MEMORY_TURN"].map((s) =>
      raw.includes(s),
    ),
    skill: raw.includes("MEMORY_NATIVE_SKILL_PROOF"),
    plugin: raw.includes("newbot-test-plugin"),
    bundle: raw.includes("bundle_probe"),
  });
  if (raw.includes("HOLD_MEMORY_TURN") && hold) {
    held = true;
    await hold;
  }
  const id = "response_" + requests.length,
    mid = "message_" + requests.length;
  const item = {
    id: mid,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text: "MEMORY_REPLY_" + requests.length,
        annotations: [],
      },
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
  for (const event of [
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
      delta: item.content[0].text,
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ])
    res.write("data: " + JSON.stringify(event) + "\n\n");
  res.end();
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${upstream.address().port}`;
const origin = "http://127.0.0.1:3100";
process.env.EXPERIMENTAL_PLUGINS = "true";
process.env.ENABLE_TEST_MCP = "false";
process.env.ENABLE_OFFICIAL_MCP = "false";
const open = async () => {
  const native = new Codex(cwd, () => ({ CODEX_HOME: home }));
  const app = await createServer({
    directory: data,
    cwd,
    codex: native,
    providerRuntime: new ProviderRuntime(),
    password: "memory-native-password",
    origins: [origin],
  });
  native.on("event", (e) => {
    if (e.method === "turn/completed")
      completed.set(e.params.turn.id, e.params.turn);
  });
  await native.start();
  assert.equal(native.state, "ready", native.reason);
  const login = await app.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password: "memory-native-password" },
  });
  assert.equal(login.statusCode, 200);
  app.headers = { origin, cookie: login.headers["set-cookie"].split(";")[0] };
  app.post = (url, payload) =>
    app.app.inject({ method: "POST", url, headers: app.headers, payload });
  app.view = async () =>
    (
      await app.app.inject({
        method: "GET",
        url: "/api/runtime/config",
        headers: app.headers,
      })
    ).json().configuration;
  return app;
};
const publish = async (value) => {
  const response = await ctx.post("/api/runtime/config", {
    ...value,
    expectedRevision: (await ctx.view()).revision,
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json().configuration;
};
const run = async (threadId, text, extra = {}) => {
  const payload = {
    ...(threadId ? { threadId } : {}),
    requestId: randomUUID(),
    text,
    ...extra,
  };
  const response = await ctx.post("/api/agent/run", payload);
  assert.equal(response.statusCode, 200, response.body);
  const result = response.json();
  await wait(() => completed.has(result.turn.id));
  assert.equal(completed.get(result.turn.id).status, "completed");
  return result;
};
const source = () => ({
  providers: [
    {
      id: "memory_a",
      name: "Native test",
      baseUrl: base + "/a",
      defaultModel: "gpt-6.1-sol",
    },
  ],
  defaults: { provider: "memory_a", model: "gpt-6.1-sol" },
});
const skillFolder = join(home, "skills", "native-note");
await mkdir(skillFolder, { recursive: true });
const skillPath = join(skillFolder, "SKILL.md");
await writeFile(
  skillPath,
  "---\nname: native-note\ndescription: A session projection test.\n---\nMEMORY_NATIVE_SKILL_PROOF\n",
);
const configText = `[mcp_servers.alpha]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(resolve("dist/mcp-test/server.js"))}]\nenabled = true\n`;
await writeFile(join(home, "config.toml"), configText);
const market = join(directory, "market"),
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
const userHome = join(directory, "setup-user");
await mkdir(userHome);
const env = { PATH: process.env.PATH, HOME: userHome, CODEX_HOME: home },
  binary = resolve("node_modules/.bin/codex");
const setup = spawnSync(
  binary,
  ["plugin", "marketplace", "add", market, "--json"],
  { env, encoding: "utf8" },
);
assert.equal(setup.status, 0, setup.stderr);
try {
  ctx = await open();
  await publish(source());
  const nativePlugins = await ctx.post("/api/agent/action", {
    action: "plugin/list",
  });
  const plugin = nativePlugins
    .json()
    .entries.find((p) => p.name === "newbot-test-plugin");
  assert.ok(plugin, nativePlugins.body);
  const configuration = (
    await ctx.app.inject({ url: "/api/config", headers: ctx.headers })
  ).json().configuration;
  const install = await ctx.post("/api/agent/action", {
    action: "plugin/install",
    id: plugin.id,
    expectedRevision: configuration.revision,
  });
  assert.equal(install.statusCode, 200, install.body);
  const configAfterInstall = await readFile(join(home, "config.toml"), "utf8");
  const skill = (await ctx.service.skills.list()).skills.find(
    (s) => s.name === "native-note",
  );
  assert.ok(skill);
  const saved = await ctx.post("/api/agent/action", {
    action: "expert/save",
    name: "Native expert",
    description: "Isolated native expertise test",
    skillIds: [skill.id],
    pluginIds: [plugin.id],
    connectorIds: ["alpha"],
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const expert = saved.json(),
    pid = ctx.runtime.child.pid;
  const a = await run(undefined, "EXPERT_FIRST_TURN", { expertId: expert.id });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].skill, true);
  assert.equal(requests[0].plugin, true);
  assert.equal(requests[0].bundle, true);
  const actual = (
    await ctx.runtime.call("mcpServerStatus/list", {
      threadId: a.threadId,
      limit: 100,
    })
  ).data;
  assert.ok(
    actual.some((s) => s.name === "alpha" && Object.keys(s.tools || {}).length),
  );
  assert.ok(
    actual.some(
      (s) =>
        s.name.includes("bundle_probe") && Object.keys(s.tools || {}).length,
    ),
  );
  const history = await ctx.service.read(a.threadId);
  assert.equal(history.extensions.expertId, expert.id);
  assert.equal(
    history.turns[0].items.find((i) => i.type === "userMessage").expert.id,
    expert.id,
  );
  checks.push(
    "expert skill, plugin mention and connector reach the actual native thread and synthetic Responses request",
  );
  const view = (
    await ctx.app.inject({ url: "/api/config", headers: ctx.headers })
  ).json().configuration;
  const disabled = await ctx.post("/api/agent/action", {
    action: "plugin/enabled",
    id: plugin.id,
    enabled: false,
    expectedRevision: view.revision,
  });
  assert.equal(disabled.statusCode, 200, disabled.body);
  const rejected = await ctx.post("/api/agent/run", {
    threadId: a.threadId,
    requestId: randomUUID(),
    text: "MUST_NOT_REACH_MODEL",
  });
  assert.notEqual(rejected.statusCode, 200);
  assert.equal(requests.length, 1);
  assert.equal(ctx.runtime.child.pid, pid);
  checks.push(
    "globally disabled expert member blocks the next run without a model call or shared process restart",
  );
  await ctx.app.close();
  ctx = await open();
  const restored = await ctx.service.read(a.threadId);
  assert.equal(restored.extensions.expertId, expert.id);
  const nextView = (
    await ctx.app.inject({ url: "/api/config", headers: ctx.headers })
  ).json().configuration;
  const enabled = await ctx.post("/api/agent/action", {
    action: "plugin/enabled",
    id: plugin.id,
    enabled: true,
    expectedRevision: nextView.revision,
  });
  assert.equal(enabled.statusCode, 200, enabled.body);
  const next = await run(a.threadId, "EXPERT_AFTER_RESTART");
  assert.equal(next.threadId, a.threadId);
  assert.equal((await ctx.service.read(a.threadId)).turns.length, 2);
  assert.equal(requests[1].skill, true);
  assert.equal(requests[1].plugin, true);
  assert.equal(
    await readFile(join(home, "config.toml"), "utf8"),
    configAfterInstall,
  );
  checks.push(
    "restart restores the expert and native history; re-enabling applies on the next turn with no config file rewrite",
  );
  stage = "manual-model-without-discovery";
  rejectCatalog = true;
  const manualModel = "manual-fixture-model";
  const manualView = (
    await ctx.app.inject({ url: "/api/config", headers: ctx.headers })
  ).json().configuration;
  const manual = await ctx.post("/api/config", {
    action: "gateway/save",
    requestId: randomUUID(),
    targetId: "memory_a",
    expectedRevision: manualView.revision,
    name: "Native test",
    customModels: [manualModel],
  });
  assert.equal(manual.statusCode, 200, manual.body);
  const currentThread = await ctx.service.read(a.threadId);
  const selected = await ctx.post("/api/agent/action", {
    action: "session/update",
    threadId: a.threadId,
    expectedRevision: currentThread.runtime.revision,
    provider: "memory_a",
    model: manualModel,
  });
  assert.equal(selected.statusCode, 200, selected.body);
  const manualRun = await run(a.threadId, "EXPLICIT_MANUAL_MODEL");
  assert.equal(manualRun.threadId, a.threadId);
  assert.equal(requests.at(-1).model, manualModel);
  assert.equal(requests.at(-1).effort, undefined);
  checks.push(
    "a manually saved model executes on the same native thread with a failing /models endpoint and no fabricated reasoning parameter",
  );
  const result = {
    version: "0.165.0",
    syntheticUpstream: true,
    realProviderCalls: 0,
    checks,
    passed: checks.length,
    requests,
  };
  await writeFile(
    join(output, "experts-native.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(
    join(output, "experts-native-failure.json"),
    JSON.stringify(
      { stage, error: String(error), stack: error.stack, checks, requests },
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
