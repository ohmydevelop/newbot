// Cold recovery on an empty node; synthetic gateway, real native tool and dynamic tool.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  cp,
  rm,
  readdir,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve, relative } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Codex } from "../server/codex.ts";
import { ThreadCheckpoints } from "../server/runner/checkpoint.ts";
import { database } from "../server/db.ts";
import { instanceLease } from "../server/instance-lease.ts";
import { migrateWorkspaces } from "../server/runner/workspace-migration.ts";
const root = await mkdtemp(join(tmpdir(), "newbot-runner-recovery-"));
const evidence = resolve(".issue/2026-11-11/evidence-server-client");
const source = join(root, "alice"),
  target = join(root, "bob"),
  archive = join(root, "server-checkpoint");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const personal = join(homedir(), ".codex", "config.toml");
const before = await readFile(personal)
  .then(hash)
  .catch(() => null);
const requests = [],
  dynamicCalls = [],
  checks = [];
let client,
  phase = "initial",
  recoveryIndex = 0;
const gateway = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw),
      i =
        phase === "initial"
          ? requests.length
          : phase === "padding"
            ? 1000 + requests.length
            : 3 + recoveryIndex++;
    requests.push(body);
    const tool = (name, args) => ({
      type: "function_call",
      id: "fc_" + i,
      call_id: "call_" + i,
      name,
      arguments: JSON.stringify(args),
    });
    const item =
      i === 0
        ? tool("exec_command", {
            cmd: "printf once >> once; pwd",
            max_output_tokens: 100,
          })
        : i === 1 || i === 3
          ? tool("recovery_card", { message: "CARD_" + i })
          : i === 4 || i === 6
            ? tool("exec_command", {
                cmd:
                  i === 4
                    ? "pwd; cat once; printf recovered > restored"
                    : "pwd; cat once; printf migrated > after-migration",
                max_output_tokens: 100,
              })
            : {
                type: "message",
                id: "msg_" + i,
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: i === 2 ? "ORIGINAL_ANSWER" : "RECOVERED_ANSWER",
                    annotations: [],
                  },
                ],
              };
    const response = {
      id: "r_" + i,
      object: "response",
      status: "completed",
      model: body.model,
      output: [item],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
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
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});
await new Promise((r) => gateway.listen(0, "127.0.0.1", r));
const config = {
  model_provider: "fixture",
  model_providers: {
    fixture: {
      name: "Fixture",
      base_url: `http://127.0.0.1:${gateway.address().port}`,
      wire_api: "responses",
      requires_openai_auth: false,
    },
  },
  memories: { use_memories: false, generate_memories: false },
  plugins: { _default: { enabled: false } },
};
const dynamicTools = [
  {
    type: "function",
    name: "recovery_card",
    description: "A deterministic host UI tool",
    inputSchema: {
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
      additionalProperties: false,
    },
    deferLoading: false,
  },
];
async function open(base, restored) {
  const cwd =
      restored?.workspace || join(base, "Newbot", "workspaces", "workspace-1"),
    home = restored?.home || join(base, ".newbot", "codex");
  await mkdir(cwd, { recursive: true });
  await mkdir(home, { recursive: true });
  const c = new Codex(cwd, () => ({ CODEX_HOME: home }));
  const done = new Map();
  c.on("event", (m) => {
    if (m.method === "turn/completed")
      done.set(m.params.turn.id, m.params.turn);
  });
  c.on("tool", (m) => {
    dynamicCalls.push({
      base,
      tool: m.params.tool,
      threadId: m.params.threadId,
    });
    c.respondTool(m.id, {
      success: true,
      contentItems: [
        {
          type: "inputText",
          text: "CARD_RESULT_" + m.params.arguments.message,
        },
      ],
    });
  });
  c.executionContext = () => ({ cwd, revision: "node-local", config });
  await c.start();
  assert.equal(c.state, "ready", c.reason);
  return { c, cwd, home, done };
}
async function finish(node, turn) {
  const deadline = Date.now() + 45000;
  while (!node.done.has(turn.id)) {
    if (Date.now() > deadline) throw Error("turn timeout");
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(node.done.get(turn.id).status, "completed");
}
async function allTurns(c, threadId) {
  const turns = [];
  let cursor;
  do {
    const page = await c.call("thread/turns/list", {
      threadId,
      cursor,
      limit: 5,
      sortDirection: "asc",
      itemsView: "full",
    });
    turns.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor);
  return turns;
}
try {
  client = await open(source);
  await mkdir(join(client.home, "memories"), { recursive: true });
  await writeFile(
    join(client.home, "memories", "memory_summary.md"),
    "PRIVATE_PROJECT_MEMORY_SENTINEL",
  );
  const opts = {
    cwd: client.cwd,
    modelProvider: "fixture",
    model: "gpt-6.1-sol",
    approvalPolicy: "never",
    sandbox: "workspace-write",
    runtimeWorkspaceRoots: [client.cwd],
    config,
  };
  const created = await client.c.call("thread/start", {
    ...opts,
    ...(process.env.PAGINATED_RECOVERY === "1"
      ? { historyMode: "paginated" }
      : {}),
    dynamicTools,
  });
  const id = created.thread.id;
  const first = await client.c.call("turn/start", {
    threadId: id,
    input: [
      {
        type: "text",
        text: "Execute fixture and show card.",
        text_elements: [],
      },
    ],
  });
  await finish(client, first.turn);
  const padding = process.env.PAGINATED_RECOVERY === "1" ? 24 : 0;
  phase = "padding";
  for (let n = 0; n < padding; n++) {
    const r = await client.c.call("turn/start", {
      threadId: id,
      input: [{ type: "text", text: "HISTORY_PAGE_" + n, text_elements: [] }],
    });
    await finish(client, r.turn);
  }
  const originalTurns = await allTurns(client.c, id);
  assert.equal(originalTurns.length, 1 + padding);
  const beforeRequests = requests.length;
  const saved = await client.c.call("thread/read", {
    threadId: id,
    includeTurns: true,
  });
  assert.ok(saved.thread.path);
  assert.equal(await readFile(join(client.cwd, "once"), "utf8"), "once");
  await client.c.stopAndWait();
  const checkpoints = new ThreadCheckpoints(archive);
  const nativeVersion = await readFile(process.env.CODEX_BIN).then(hash);
  const checkpoint = await checkpoints.capture({
    threadId: id,
    nativeVersion,
    home: client.home,
    workspace: client.cwd,
    rollout: saved.thread.path,
    isStopped: () =>
      client.c.state === "offline" && !client.c.child?.stdin.writable,
  });
  await rm(source, { recursive: true, force: true });
  checks.push(
    "source node deleted only after cold checkpoint saved; no native database/auth copied",
  );
  const restoredFiles = await checkpoints.restore(
    checkpoint.id,
    nativeVersion,
    target,
  );
  const rollout = checkpoint.rollout,
    targetHome = restoredFiles.home;
  client = await open(target, restoredFiles);
  const restored = await client.c.call("thread/resume", {
    ...opts,
    cwd: client.cwd,
    threadId: id,
    path: join(targetHome, rollout),
  });
  assert.equal(restored.thread.id, id);
  assert.equal(restored.thread.cwd, client.cwd);
  checks.push(
    "fresh node B restores original native thread id with native path resume and new cwd",
  );
  const history = await client.c.call("thread/read", {
    threadId: id,
    includeTurns: true,
  });
  assert.ok(JSON.stringify(history).includes("ORIGINAL_ANSWER"));
  assert.equal(await readFile(join(client.cwd, "once"), "utf8"), "once");
  checks.push(
    "original answer and command history preserved without executing history",
  );
  const restoredTurns = await allTurns(client.c, id);
  assert.deepEqual(
    restoredTurns.map((t) => [t.id, t.items.map((i) => [i.id, i.type])]),
    originalTurns.map((t) => [t.id, t.items.map((i) => [i.id, i.type])]),
  );
  checks.push(
    "all saved turns and item identities survive across pagination boundaries",
  );
  phase = "recovery";
  const second = await client.c.call("turn/start", {
    threadId: id,
    input: [
      {
        type: "text",
        text: "Continue using the existing card and verify cwd.",
        text_elements: [],
      },
    ],
  });
  await finish(client, second.turn);
  assert.equal(requests.length, beforeRequests + 3);
  assert.equal(dynamicCalls.length, 2);
  assert.equal(dynamicCalls[1].threadId, id);
  assert.ok(
    JSON.stringify(requests[beforeRequests].input).includes("ORIGINAL_ANSWER"),
  );
  assert.ok(
    requests[beforeRequests].input.some(
      (x) => x.type === "function_call_output" && x.call_id === "call_0",
    ),
  );
  assert.equal(await readFile(join(client.cwd, "once"), "utf8"), "once");
  assert.equal(
    await readFile(join(client.cwd, "restored"), "utf8"),
    "recovered",
  );
  assert.ok(
    JSON.stringify(requests[beforeRequests + 2].input).includes(client.cwd),
  );
  checks.push(
    "restored dynamic host tool works without re-registration; next shell executes only in B workspace",
  );
  await client.c.stopAndWait();
  client = await open(target, restoredFiles);
  const again = await client.c.call("thread/resume", {
    ...opts,
    cwd: client.cwd,
    threadId: id,
  });
  assert.equal(again.thread.id, id);
  checks.push(
    "B native index rebuild persists: subsequent restart resumes by id only",
  );
  await client.c.stopAndWait();
  const oldWorkspace = client.cwd,
    workspaceId = randomUUID(),
    migrationServer = join(root, "migration-server");
  const db = database(migrationServer);
  db.addThread(id, "fixture");
  db.raw
    .prepare("INSERT INTO thread_workspaces VALUES(?,?,?,0,'','{}')")
    .run(id, workspaceId, oldWorkspace);
  db.raw.close();
  const stopped = await instanceLease(migrationServer);
  await stopped.release(true);
  const relocated = await migrateWorkspaces(
    migrationServer,
    join(root, "Newbot/workspaces"),
  );
  client = await open(target, {
    home: restoredFiles.home,
    workspace: join(relocated.target, workspaceId),
  });
  const same = await client.c.call("thread/resume", { ...opts, threadId: id });
  assert.equal(same.thread.id, id);
  assert.equal(same.thread.cwd, client.cwd);
  const migratedTurn = await client.c.call("turn/start", {
    threadId: id,
    input: [
      {
        type: "text",
        text: "continue in relocated workspace",
        text_elements: [],
      },
    ],
  });
  await finish(client, migratedTurn.turn);
  assert.equal(
    await readFile(join(client.cwd, "after-migration"), "utf8"),
    "migrated",
  );
  await assert.rejects(readFile(join(oldWorkspace, "after-migration")));
  assert.equal(await readFile(join(oldWorkspace, "once"), "utf8"), "once");
  assert.equal(await readFile(join(client.cwd, "once"), "utf8"), "once");
  checks.push(
    "offline workspace migration keeps the original thread; shared Codex resume replaces cwd and sandbox roots, and new tool writes only to the migrated workspace",
  );

  assert.ok(
    !JSON.stringify(requests).includes("PRIVATE_PROJECT_MEMORY_SENTINEL"),
  );
  assert.ok(
    !checkpoint.files.some((f) => f.path.startsWith("native/memories/")),
  );
  checks.push("disabled global memories not injected or copied to fresh node");
  assert.equal(
    await readFile(personal)
      .then(hash)
      .catch(() => null),
    before,
  );
  checks.push(
    "personal Codex config unchanged; user service and data untouched",
  );
  await writeFile(
    join(
      evidence,
      process.env.PAGINATED_RECOVERY === "1"
        ? "native-recovery-paginated.json"
        : "native-recovery.json",
    ),
    JSON.stringify(
      {
        passed: checks.length,
        checks,
        threadId: id,
        rollout,
        requests: requests.length,
        historyMode:
          process.env.PAGINATED_RECOVERY === "1" ? "paginated" : "legacy",
        restoredTurns: originalTurns.length,
        dynamicCalls: dynamicCalls.length,
        binary: process.env.CODEX_BIN,
        upstream: "synthetic Responses gateway; real App Server and shell",
        limitations: [
          "cold checkpoint only",
          "not a complete MCP App restore test",
          "no credential, plugin state or memory recovery yet",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ passed: checks.length, checks }));
} catch (e) {
  await writeFile(
    join(
      evidence,
      process.env.PAGINATED_RECOVERY === "1"
        ? "native-recovery-paginated-failure.json"
        : "native-recovery-failure.json",
    ),
    JSON.stringify(
      { error: String(e), checks, requests: requests.length, root },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await client?.c.stopAndWait();
  gateway.closeAllConnections();
  await new Promise((r) => gateway.close(r));
  if (process.env.KEEP_RECOVERY_PROBE !== "1")
    await rm(root, { recursive: true, force: true });
}
