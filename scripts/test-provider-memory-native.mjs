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
  join(tmpdir(), "newbot-provider-memory-native-"),
);
const home = join(directory, "codex"),
  cwd = join(directory, "workspace"),
  data = join(directory, "app");
await mkdir(cwd);
await mkdir(home);
const output = resolve(
  process.env.PROVIDER_EVIDENCE_DIR || ".issue/2026-11-10/evidence-sqlite",
);
await mkdir(output, { recursive: true });
const checks = [],
  requests = [],
  completed = new Map();
await rm(join(output, "provider-memory-native-failure.json"), { force: true });
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
const source = (suffix = "b") => ({
  providers: [
    {
      id: "memory_a",
      name: "A",
      baseUrl: base + "/a",
      defaultModel: "gpt-6.1-sol",
    },
    {
      id: "memory_b",
      name: "B",
      baseUrl: base + "/" + suffix,
      defaultModel: "gpt-6.1-sol",
    },
  ],
  defaults: { provider: "memory_a", model: "gpt-6.1-sol" },
});
const origin = "http://127.0.0.1:3100";
process.env.ENABLE_TEST_MCP = "true";
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
try {
  ctx = await open();
  const pid = ctx.runtime.child.pid;
  alternateModel = (
    await ctx.runtime.call("model/list", { limit: 100 })
  ).data.find((m) => m.model !== "gpt-6.1-sol" && !m.hidden);
  assert.ok(
    alternateModel,
    "Native catalog must advertise a second model for the model-switch proof",
  );
  stage = "source and first turn";
  await publish(source());
  const first = await run(undefined, "FIRST_MEMORY_TURN", {
    provider: "memory_a",
    model: "gpt-6.1-sol",
  });
  const id = first.threadId;
  assert.equal(requests.at(-1).path, "/a/responses");
  assert.equal(existsSync(join(home, "config.toml")), false);
  checks.push(
    "source publication and first product turn route to A without config.toml",
  );
  stage = "cross provider";
  let selected = ctx.service.runtimeSettings.get(id);
  let changed = await ctx.post("/api/agent/action", {
    action: "session/update",
    threadId: id,
    expectedRevision: selected.revision,
    provider: "memory_b",
    model: "gpt-6.1-sol",
    effort: "high",
  });
  assert.equal(changed.statusCode, 200, changed.body);
  await run(id, "SECOND_MEMORY_TURN");
  assert.equal(requests.at(-1).path, "/b/responses");
  assert.equal(requests.at(-1).effort, "high");
  assert.ok(requests.at(-1).history[0]);
  assert.equal(ctx.runtime.child.pid, pid);
  checks.push(
    "same thread switches A to B and reasoning high through product API; original history and PID survive",
  );
  stage = "same Provider model parameters";
  selected = ctx.service.runtimeSettings.get(id);
  const effort =
    alternateModel.defaultReasoningEffort ||
    alternateModel.supportedReasoningEfforts[0]?.reasoningEffort ||
    "";
  changed = await ctx.post("/api/agent/action", {
    action: "session/update",
    threadId: id,
    expectedRevision: selected.revision,
    model: alternateModel.model,
    effort,
  });
  assert.equal(changed.statusCode, 200, changed.body);
  await run(id, "CHANGED_MEMORY_MODEL");
  assert.equal(requests.at(-1).model, alternateModel.model);
  if (effort) assert.equal(requests.at(-1).effort, effort);
  assert.equal(ctx.runtime.child.pid, pid);
  checks.push(
    "same Provider model ID and supported reasoning parameters update natively and reach the next request without restarting",
  );
  stage = "reasoning default reset";
  const defaultEffort = alternateModel.defaultReasoningEffort;
  const nonDefault = alternateModel.supportedReasoningEfforts.find(
    (e) => e.reasoningEffort !== defaultEffort,
  )?.reasoningEffort;
  assert.ok(defaultEffort && nonDefault);
  selected = ctx.service.runtimeSettings.get(id);
  changed = await ctx.post("/api/agent/action", {
    action: "session/update",
    threadId: id,
    expectedRevision: selected.revision,
    effort: nonDefault,
  });
  assert.equal(changed.statusCode, 200, changed.body);
  await run(id, "EXPLICIT_MEMORY_REASONING");
  assert.equal(requests.at(-1).effort, nonDefault);
  selected = ctx.service.runtimeSettings.get(id);
  changed = await ctx.post("/api/agent/action", {
    action: "session/update",
    threadId: id,
    expectedRevision: selected.revision,
    effort: "",
  });
  assert.equal(changed.statusCode, 200, changed.body);
  await run(id, "RESET_MEMORY_REASONING");
  assert.equal(requests.at(-1).effort, defaultEffort);
  checks.push(
    "resetting reasoning to model default changes the actual upstream request and cannot leave the previous effort active",
  );
  stage = "endpoint update";
  await publish(source("c"));
  await run(id, "THIRD_MEMORY_TURN");
  assert.equal(requests.at(-1).path, "/c/responses");
  assert.ok(requests.at(-1).history.every(Boolean));
  assert.equal(ctx.runtime.child.pid, pid);
  checks.push(
    "same Provider endpoint update reaches C on next turn without restarting Codex",
  );
  stage = "active snapshot";
  let release;
  hold = new Promise((r) => {
    release = r;
  });
  held = false;
  const pending = run(id, "HOLD_MEMORY_TURN");
  await wait(() => held);
  await publish(source("d"));
  assert.ok(ctx.runtime.active.has(id));
  assert.equal(ctx.runtime.child.pid, pid);
  hold = undefined;
  release();
  await pending;
  assert.equal(requests.at(-1).path, "/c/responses");
  await run(id, "AFTER_HOLD_MEMORY_TURN");
  assert.equal(requests.at(-1).path, "/d/responses");
  checks.push(
    "publishing during a running turn preserves its old configuration; next turn receives the new snapshot",
  );
  stage = "defaults";
  const catalog = await ctx.service.runtimeSettings.catalog();
  const gateway = catalog.find((g) => g.id === "memory_b");
  changed = await ctx.post("/api/agent/action", {
    action: "gateway/defaults",
    id: "memory_b",
    model: "gpt-6.1-sol",
    makeDefault: true,
    expectedRevision: (await ctx.view()).revision,
    expectedDefaultRevision: gateway.defaultRevision,
  });
  assert.equal(changed.statusCode, 200, changed.body);
  assert.equal(ctx.runtime.child.pid, pid);
  assert.equal(
    existsSync(join(home, "newbot_gateway_memory_b.config.toml")),
    false,
  );
  const other = await run(undefined, "OTHER_MEMORY_THREAD");
  assert.equal(requests.at(-1).path, "/d/responses");
  checks.push(
    "gateway defaults apply to new sessions in memory; existing session IDs stay stable and no profile file is created",
  );
  stage = "MCP and skill";
  const mcp = await ctx.runtime.call("mcpServerStatus/list", {
    threadId: id,
    detail: "full",
  });
  assert.ok(mcp.data.some((s) => s.name === "newbot_test" && s.tools.echo));
  const echo = await ctx.runtime.call("mcpServer/tool/call", {
    threadId: id,
    server: "newbot_test",
    tool: "echo",
    arguments: { text: "MEMORY_MCP_PROOF" },
  });
  assert.ok(JSON.stringify(echo).includes("MEMORY_MCP_PROOF"));
  const skillDir = join(home, "skills", "memory-native");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    join(skillDir, "SKILL.md"),
    "---\nname: memory-native\ndescription: A synthetic native memory configuration proof.\n---\nMEMORY_NATIVE_SKILL_PROOF\n",
  );
  const skill = (await ctx.service.skills.list()).skills.find(
    (s) => s.name === "memory-native",
  );
  assert.ok(skill);
  const doc = await ctx.service.skills.read(skill.id);
  await run(id, "USE_MEMORY_SKILL", {
    skills: [{ id: skill.id, sha256: doc.sha256 }],
  });
  assert.ok(requests.at(-1).skill);
  assert.equal(ctx.runtime.child.pid, pid);
  checks.push(
    "real MCP calls and structured Skill input remain usable after Provider hot updates",
  );
  stage = "restart with no source";
  const before = await ctx.runtime.call("thread/read", {
    threadId: id,
    includeTurns: true,
  });
  const turns = before.thread.turns.length;
  assert.equal(existsSync(join(home, "config.toml")), false);
  const contextRows = ctx.db.raw
    .prepare("SELECT context FROM run_context")
    .all();
  assert.ok(!JSON.stringify(contextRows).includes(base));
  const persistedProviderTraces = [];
  async function scan(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) await scan(file);
      else if (
        entry.isFile() &&
        (await readFile(file)).includes(Buffer.from(base))
      )
        persistedProviderTraces.push(file.slice(directory.length));
    }
  }
  await scan(home);
  assert.deepEqual(
    persistedProviderTraces,
    [],
    "Provider request addresses must not enter persistent native diagnostics",
  );
  const volatileLogPath = ctx.runtime.runtimeLogHome;
  assert.ok(volatileLogPath?.startsWith("/dev/shm/"));
  const durable = ctx.runtime.providerRuntime.snapshot();
  assert.deepEqual(
    JSON.parse(
      ctx.db.raw
        .prepare("SELECT content FROM provider_configuration WHERE id=1")
        .get().content,
    ),
    durable.values,
  );
  await ctx.app.close();
  assert.equal(existsSync(volatileLogPath), false);
  ctx = await open();
  assert.equal((await ctx.view()).providerStorage, "sqlite");
  assert.equal((await ctx.view()).providers.length, 2);
  assert.deepEqual(ctx.runtime.providerRuntime.snapshot(), durable);
  assert.equal(ctx.service.runtimeSettings.get(id).provider, "memory_b");
  const history = await ctx.app.inject({
    method: "GET",
    url: "/api/threads/" + id,
    headers: ctx.headers,
  });
  assert.equal(history.statusCode, 200, history.body);
  await run(id, "SQLITE_RESTORED_WITHOUT_RESUPPLY");
  assert.equal(requests.at(-1).path, "/d/responses");
  checks.push(
    "Bridge restart automatically restores SQLite Provider parameters, defaults and session binding; the original thread runs without resupplying configuration",
  );
  stage = "persist edited endpoint and restart again";
  const savedGateway = (
    await ctx.service.settings()
  ).configuration.providers.find((p) => p.id === "memory_b");
  assert.equal(savedGateway.missing, undefined);
  const restoredGateway = await ctx.post("/api/config", {
    action: "gateway/save",
    requestId: randomUUID(),
    targetId: "memory_b",
    name: "Restored B",
    baseUrl: base + "/e",
    expectedRevision: (await ctx.view()).revision,
  });
  assert.equal(restoredGateway.statusCode, 200, restoredGateway.body);
  await ctx.app.close();
  ctx = await open();
  assert.equal(
    ctx.runtime.providerRuntime.snapshot().values.model_providers.memory_b.name,
    "Restored B",
  );
  await run(id, "RESTORED_MEMORY_TURN");
  const restored = await ctx.runtime.call("thread/read", {
    threadId: id,
    includeTurns: true,
  });
  assert.equal(restored.thread.id, id);
  assert.equal(restored.thread.turns.length, turns + 2);
  assert.equal(requests.at(-1).path, "/e/responses");
  checks.push(
    "Web endpoint edits survive a second full Bridge restart and route the original thread to the saved endpoint with its complete history",
  );
  stage = "legacy collision guard";
  await writeFile(
    join(home, "config.toml"),
    `[model_providers.memory_b]\nname="poison"\nbase_url="${base}/poison"\nwire_api="responses"\nenv_key="ABSENT_POISON_CREDENTIAL"\n`,
  );
  await publish(source("f"));
  const count = requests.length;
  const refused = await ctx.post("/api/agent/run", {
    threadId: id,
    requestId: randomUUID(),
    text: "POISON_MUST_NOT_RUN",
  });
  assert.notEqual(refused.statusCode, 200);
  assert.equal(requests.length, count);
  checks.push(
    "a conflicting disk Provider cannot contribute old authentication or silently redirect an in-memory session",
  );
  stage = "one-time legacy import";
  const legacyData = join(directory, "legacy-app"),
    legacyHome = join(legacyData, "codex");
  await mkdir(legacyHome, { recursive: true });
  await writeFile(
    join(legacyHome, "config.toml"),
    `model_provider="memory_a"\nmodel="gpt-6.1-sol"\napproval_policy="on-request"\n[model_providers.memory_a]\nname="Legacy A"\nbase_url="${base}/a"\nwire_api="responses"\nrequires_openai_auth=false\n`,
  );
  await writeFile(
    join(legacyHome, "newbot_gateway_memory_a.config.toml"),
    '# Managed by newbot: gateway defaults\nmodel = "gpt-6.1-sol"\nmodel_provider = "memory_a"\n',
  );
  const legacyDb = database(legacyData);
  try {
    const imported = await importProviderConfigurationOnce(
      legacyDb,
      legacyData,
      cwd,
    );
    assert.equal(imported.snapshot().values.model_provider, "memory_a");
    assert.equal(
      imported.snapshot().values.profiles.newbot_gateway_memory_a.model,
      "gpt-6.1-sol",
    );
    const active = await readFile(join(legacyHome, "config.toml"), "utf8");
    assert.ok(!active.includes("model_providers") && !active.includes(base));
    assert.match(active, /approval_policy\s*=\s*"on-request"/);
    assert.equal(
      existsSync(join(legacyHome, "newbot_gateway_memory_a.config.toml")),
      false,
    );
    const next = await importProviderConfigurationOnce(
      legacyDb,
      legacyData,
      cwd,
    );
    assert.equal(Object.keys(next.snapshot().values.model_providers).length, 1);
    assert.deepEqual(next.snapshot(), imported.snapshot());
    assert.ok(
      !JSON.stringify(
        legacyDb.raw.prepare("SELECT * FROM metadata").all(),
      ).includes(base),
    );
    checks.push(
      "one-time import archives legacy Provider configuration, preserves native policies, persists allowed parameters in SQLite and restores them without importing backups again",
    );
  } finally {
    legacyDb.raw.close();
  }
  const result = {
    nativeDiagnosticsVolatile: true,
    persistentProviderTraces: persistedProviderTraces,
    checks,
    passed: checks.length,
    requests,
    sameThread: true,
    pidUnchangedDuringHotUpdates: true,
    noProviderConfigFileBeforeCollisionTest: true,
    historyRestored: true,
    providerStorage: "sqlite",
    restartWithoutResupply: true,
    modelTurnsAgainstRealProviders: 0,
  };
  await writeFile(
    join(output, "provider-memory-native.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      passed: checks.length,
      sameThread: true,
      pidUnchangedDuringHotUpdates: true,
    }),
  );
} catch (error) {
  await writeFile(
    join(output, "provider-memory-native-failure.json"),
    JSON.stringify({ stage, message: String(error), checks }, null, 2),
  );
  throw Error("Memory Provider native verification failed at " + stage);
} finally {
  if (ctx) await ctx.app.close();
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  await rm(directory, { recursive: true, force: true });
}
