// Real pinned Codex, loopback-only Responses, no personal auth or paid inference.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  copyFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve, relative, dirname } from "node:path";
import { Codex } from "../server/codex.ts";
const root = await mkdtemp(join(tmpdir(), "newbot-isolation-native-"));
const owned = join(root, "codex"),
  work = join(root, "work"),
  output = resolve(process.env.RUNTIME_ISOLATION_OUTPUT || ".issue/2026-11-09/evidence-04");
await mkdir(work);
await mkdir(output, { recursive: true });
await rm(join(output, "runtime-isolation-failure.json"), { force: true });
const hostConfig = join(homedir(), ".codex", "config.toml");
const digest = async (path) =>
  existsSync(path)
    ? createHash("sha256")
        .update(await readFile(path))
        .digest("hex")
    : null;
const before = await digest(hostConfig),
  requests = [],
  checks = [];
const upstream = createServer(async (req, res) => {
  if (req.url.endsWith("/models")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] }));
    return;
  }
  let body = "";
  for await (const chunk of req) body += chunk;
  requests.push({
    path: req.url,
    first: body.includes("MEMORY_CONFIG_ONE"),
    second: body.includes("MEMORY_CONFIG_TWO"),
  });
  const id = "r_" + requests.length,
    mid = "m_" + requests.length;
  const msg = {
    id: mid,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text: "ISOLATED_REPLY_" + requests.length,
        annotations: [],
      },
    ],
  };
  const response = {
    id,
    object: "response",
    created_at: 1,
    status: "completed",
    model: "gpt-6.1-sol",
    output: [msg],
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
      delta: msg.content[0].text,
    },
    { type: "response.output_item.done", output_index: 0, item: msg },
    { type: "response.completed", response },
  ])
    res.write("data: " + JSON.stringify(event) + "\n\n");
  res.end();
});
const codex = new Codex(work, () => ({ CODEX_HOME: owned }));
let stage = "start";
async function turn(threadId, text) {
  let listener, timer;
  const done = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Error("turn timed out")), 20000);
    listener = (event) => {
      if (
        event.method === "turn/completed" &&
        event.params.threadId === threadId
      )
        resolve(event.params.turn);
    };
    codex.on("event", listener);
  });
  try {
    await codex.call("turn/start", {
      threadId,
      input: [{ type: "text", text, text_elements: [] }],
    });
    const result = await done;
    assert.equal(result.status, "completed");
  } finally {
    clearTimeout(timer);
    codex.off("event", listener);
  }
}
try {
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const port = upstream.address().port;
  await codex.start();
  assert.equal(codex.state, "ready", codex.reason);
  assert.equal(codex.home, owned);
  assert.equal(codex.userHome, join(owned, "runtime-home"));
  checks.push("native initialize confirms private CODEX_HOME and HOME");
  const pid = codex.child.pid;
  const config = (suffix) => ({
    model_providers: {
      ["memory_" + suffix]: {
        name: suffix,
        base_url: `http://127.0.0.1:${port}/${suffix}`,
        wire_api: "responses",
        requires_openai_auth: false,
      },
    },
    mcp_servers: {
      memory_probe: {
        command: process.execPath,
        args: [resolve("dist/mcp-test/server.js")],
        startup_timeout_sec: 10,
      },
    },
  });
  stage = "memory thread start";
  const started = await codex.call("thread/start", {
    cwd: work,
    model: "gpt-6.1-sol",
    modelProvider: "memory_a",
    config: config("a"),
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
  });
  const id = started.thread.id;
  codex.loaded.add(id);
  const mcp = await codex.call("mcpServerStatus/list", {
    threadId: id,
    detail: "full",
  });
  assert.ok(
    mcp.data.some(
      (server) =>
        server.name === "memory_probe" && Object.keys(server.tools).length > 0,
    ),
  );
  checks.push(
    "thread-scoped MCP receives server config from memory and discovers real tools",
  );
  await turn(id, "MEMORY_CONFIG_ONE");
  assert.ok(requests.some((r) => r.path.startsWith("/a/") && r.first));
  assert.equal(existsSync(join(owned, "config.toml")), false);
  checks.push(
    "thread config routes real requests from memory without config.toml",
  );
  stage = "memory provider update";
  await codex.unload(id);
  const resumed = await codex.call("thread/resume", {
    threadId: id,
    model: "gpt-6.1-sol",
    modelProvider: "memory_b",
    config: config("b"),
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
  });
  assert.equal(resumed.thread.id, id);
  codex.loaded.add(id);
  await turn(id, "MEMORY_CONFIG_TWO");
  assert.ok(
    requests.some((r) => r.path.startsWith("/b/") && r.first && r.second),
  );
  assert.equal(codex.child.pid, pid);
  assert.equal(existsSync(join(owned, "config.toml")), false);
  stage = "same provider endpoint update from memory";
  await codex.unload(id);
  const changedConfig = config("b");
  changedConfig.model_providers.memory_b.base_url = `http://127.0.0.1:${port}/c`;
  await codex.call("thread/resume", {
    threadId: id,
    model: "gpt-6.1-sol",
    modelProvider: "memory_b",
    config: changedConfig,
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
  });
  codex.loaded.add(id);
  await turn(id, "MEMORY_CONFIG_THREE");
  assert.ok(
    requests.some((r) => r.path.startsWith("/c/") && r.first && r.second),
  );
  assert.equal(codex.child.pid, pid);
  assert.equal(existsSync(join(owned, "config.toml")), false);
  checks.push(
    "same provider endpoint hot-update reaches new address without file write or process restart",
  );
  const history = await codex.call("thread/read", {
    threadId: id,
    includeTurns: true,
  });
  assert.equal(history.thread.turns.length, 3);
  checks.push(
    "same native thread switches in-memory provider with history and PID intact",
  );
  stage = "private config write";
  await codex.call("config/batchWrite", {
    edits: [
      {
        keyPath: "model_reasoning_effort",
        value: "low",
        mergeStrategy: "replace",
      },
    ],
    reloadUserConfig: true,
  });
  assert.ok(existsSync(join(owned, "config.toml")));
  assert.equal(await digest(hostConfig), before);
  checks.push(
    "native config writes are confined to private home; host config unchanged",
  );
  stage = "selective rollout migration";
  await codex.stopAndWait();
  const migratedHome = join(root, "migrated");
  const copied = join(migratedHome, relative(owned, history.thread.path));
  assert.ok(copied.startsWith(migratedHome + "/"));
  await mkdir(dirname(copied), { recursive: true });
  await copyFile(history.thread.path, copied);
  const migrated = new Codex(work, () => ({ CODEX_HOME: migratedHome }));
  try {
    await migrated.start();
    assert.equal(migrated.state, "ready", migrated.reason);
    await migrated.call("thread/resume", {
      threadId: id,
      path: copied,
      model: "gpt-6.1-sol",
      modelProvider: "memory_b",
      config: config("b"),
      excludeTurns: false,
    });
    const restored = await migrated.call("thread/read", {
      threadId: id,
      includeTurns: true,
    });
    assert.equal(restored.thread.id, id);
    assert.equal(restored.thread.turns.length, 3);
    checks.push(
      "selected rollout restores original identity and history in a fresh isolated home",
    );
  } finally {
    await migrated.stopAndWait();
  }
  const result = {
    checks,
    nativeHomeIsolated: true,
    hostConfigUnchanged: true,
    memoryConfig: true,
    pidUnchanged: true,
    sameThread: true,
    historyTurns: 3,
    requests,
  };
  await writeFile(
    join(output, "runtime-isolation-native.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (error) {
  await writeFile(
    join(output, "runtime-isolation-failure.json"),
    JSON.stringify({ stage, error: error.message, checks, requests }, null, 2),
  );
  console.error(stage + ": " + error.message);
  process.exitCode = 1;
} finally {
  await codex.stopAndWait();
  await new Promise((resolve) => upstream.close(resolve));
  await rm(root, { recursive: true, force: true });
}
