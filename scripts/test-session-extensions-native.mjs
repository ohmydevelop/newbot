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
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
await rm(join(output, "session-extension-native-failure.json"), {
  force: true,
});
let alternateModel;
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
try {
  ctx = await open();
  await publish(source());
  const pid = ctx.runtime.child.pid;
  const catalog = await ctx.service.skills.list(),
    skill = catalog.skills.find((s) => s.name === "native-note");
  assert.ok(skill);
  const document = await ctx.service.skills.read(skill.id);
  let release;
  hold = new Promise((r) => {
    release = r;
  });
  held = false;
  const active = run(undefined, "HOLD_MEMORY_TURN", {
    skills: [{ id: skill.id, sha256: document.sha256 }],
  });
  await wait(() => held);
  const a = [...ctx.runtime.active][0];
  assert.ok(a);
  const rootA = ctx.workspaces.root(a),
    snapshotA = ctx.workspaces.saved(a);
  assert.ok(
    snapshotA.snapshot.resources.some((r) =>
      r.projectPath.startsWith(rootA + "/.agents/skills/"),
    ),
  );
  assert.equal(requests[0].skill, true);
  let native = await ctx.runtime.call("mcpServerStatus/list", {
    threadId: a,
    limit: 100,
  });
  assert.ok(
    native.data.some(
      (m) => m.name === "alpha" && Object.keys(m.tools || {}).length,
    ),
  );
  const configuration = (
    await ctx.app.inject({ url: "/api/config", headers: ctx.headers })
  ).json().configuration;
  let changed = await ctx.post("/api/config", {
    action: "mcp/enabled",
    id: "alpha",
    enabled: false,
    expectedRevision: configuration.revision,
  });
  assert.equal(changed.statusCode, 200, changed.body);
  changed = await ctx.post("/api/config", {
    action: "skills/config/write",
    path: skillPath,
    enabled: false,
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(ctx.workspaces.saved(a).revision, snapshotA.revision);
  assert.ok(ctx.runtime.active.has(a));
  native = await ctx.runtime.call("mcpServerStatus/list", {
    threadId: a,
    limit: 100,
  });
  assert.ok(
    native.data.some(
      (m) => m.name === "alpha" && Object.keys(m.tools || {}).length,
    ),
  );
  checks.push(
    "global extension edits leave an active native thread, its MCP inventory, and its resource snapshot unchanged",
  );
  const b = await run(undefined, "NEW_THREAD_AFTER_DISABLE");
  const rootB = ctx.workspaces.root(b.threadId);
  assert.notEqual(rootA, rootB);
  native = await ctx.runtime.call("mcpServerStatus/list", {
    threadId: b.threadId,
    limit: 100,
  });
  assert.ok(
    !native.data.some(
      (m) => m.name === "alpha" && Object.keys(m.tools || {}).length,
    ),
  );
  assert.equal(requests.at(-1).skill, false);
  assert.equal(ctx.runtime.child.pid, pid);
  checks.push(
    "a new native thread applies disabled connector/skill settings and has its own cwd, without restarting Codex",
  );
  release();
  const first = await active;
  assert.equal(first.threadId, a);
  const next = await run(a, "NEXT_TURN_SYNCHRONIZES");
  assert.equal(next.threadId, a);
  assert.equal(ctx.runtime.child.pid, pid);
  native = await ctx.runtime.call("mcpServerStatus/list", {
    threadId: a,
    limit: 100,
  });
  assert.ok(
    !native.data.some(
      (m) => m.name === "alpha" && Object.keys(m.tools || {}).length,
    ),
  );
  assert.notEqual(ctx.workspaces.saved(a).revision, snapshotA.revision);
  const thread = await ctx.runtime.call("thread/read", {
    threadId: a,
    includeTurns: true,
  });
  assert.equal(thread.thread.cwd, rootA);
  assert.equal(thread.thread.turns.length, 2);
  checks.push(
    "the next turn updates the original native thread and retains its history and cwd",
  );
  await writeFile(join(rootA, "same.txt"), "A");
  await writeFile(join(rootB, "same.txt"), "B");
  const aa = await ctx.artifacts.register(a, next.turn.id, "same.txt"),
    bb = await ctx.artifacts.register(b.threadId, b.turn.id, "same.txt");
  assert.equal(
    (await ctx.app.inject({ url: aa.contentUrl, headers: ctx.headers })).body,
    "A",
  );
  assert.equal(
    (await ctx.app.inject({ url: bb.contentUrl, headers: ctx.headers })).body,
    "B",
  );
  checks.push(
    "actual native workspaces and authenticated artifacts keep same-named files separate",
  );
  assert.equal(await readFile(join(home, "config.toml"), "utf8"), configText);
  await ctx.app.close();
  ctx = await open();
  assert.equal(ctx.workspaces.root(a), rootA);
  assert.equal((await ctx.service.skills.read(skill.id)).skill.enabled, false);
  await run(a, "RESTORED_EXTENSION_THREAD");
  native = await ctx.runtime.call("mcpServerStatus/list", {
    threadId: a,
    limit: 100,
  });
  assert.ok(
    !native.data.some(
      (m) => m.name === "alpha" && Object.keys(m.tools || {}).length,
    ),
  );
  assert.equal(await readFile(join(home, "config.toml"), "utf8"), configText);
  checks.push(
    "restart restores SQLite extension choices, stable skill identity, cwd, and native thread without writing config.toml",
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
    join(output, "session-extension-native.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(
    join(output, "session-extension-native-failure.json"),
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
