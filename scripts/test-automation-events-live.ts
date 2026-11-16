import assert from "node:assert/strict";
import { mkdtemp, mkdir, copyFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { database } from "../server/db.js";
import { Codex } from "../server/codex.js";
import { createServer } from "../server/index.js";
// @ts-expect-error Shared executable sender is JavaScript.
import { eventHeaders } from "./send-automation-event.mjs";
const source = process.env.AUTOMATION_PUBLIC_DATA;
if (!source)
  throw Error(
    "Explicit production data directory required; copies model settings only",
  );
const out = resolve(
  process.env.AUTOMATION_EVIDENCE_DIR || ".data/automation-events-live",
);
await mkdir(out, { recursive: true });
const root = await mkdtemp(join(tmpdir(), "newbot-event-model-")),
  directory = join(root, "data"),
  cwd = join(root, "work");
await mkdir(cwd);
const original = new DatabaseSync(join(source, "newbot.sqlite"), {
    readOnly: true,
  }),
  db = database(directory);
for (const table of [
  "provider_configuration",
  "managed_credentials",
  "private_field_sets",
]) {
  const columns = (
    original.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  ).map((c) => c.name);
  const rows = original
    .prepare(
      `SELECT * FROM ${table}${table !== "provider_configuration" ? " WHERE scope='provider'" : ""}`,
    )
    .all();
  for (const row of rows)
    db.raw
      .prepare(
        `INSERT INTO ${table} (${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")})`,
      )
      .run(...columns.map((k) => row[k]));
}
original.close();
db.raw.close();
await copyFile(
  join(source, "private-credentials.key"),
  join(directory, "private-credentials.key"),
);
const origin = "http://127.0.0.1:3177";
let ctx: Awaited<ReturnType<typeof createServer>> | undefined;
const checks: string[] = [];
const records: any[] = [];
async function start() {
  const native = new Codex(cwd, () => ({ CODEX_HOME: join(root, "codex") }));
  const app = await createServer({
    directory,
    cwd,
    codex: native,
    password: "local-events-verification",
    origins: [origin],
    automationTimer: false,
  });
  await native.start();
  assert.equal(native.state, "ready", native.reason);
  await app.service.settings();
  await app.app.listen({ port: 3177, host: "127.0.0.1" });
  return app;
}
async function complete(taskId: string, runId: string) {
  for (let i = 0; i < 180; i++) {
    await ctx!.automations.tick();
    const r = ctx!.automations.result(runId);
    if (!["queued", "dispatching", "running", "waiting"].includes(r.state)) {
      assert.equal(r.state, "succeeded", JSON.stringify(r));
      const thread = await ctx!.service.read(r.threadId!);
      const turn = thread.turns.find((t) => t.id === r.turnId);
      assert(turn);
      const text = turn.items
        .filter((i) => i.type === "agentMessage")
        .map((i: any) => i.text)
        .join("\n");
      records.push({
        runId: r.id,
        threadId: r.threadId,
        turnId: r.turnId,
        text,
      });
      return r;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw Error("Real model timeout");
}
try {
  ctx = await start();
  const trigger = {
    id: randomUUID(),
    source: "webhook",
    events: [],
    repository: "",
    actions: [],
  };
  let task = await ctx.automations.save({
    id: randomUUID(),
    expectedRevision: 0,
    content: {
      name: "持续会话事件验收",
      prompt:
        "记录本次事件中的词语。如果本会话前面曾收到别的词语，请同时列出以前收到的词语。只用中文简短回答，不调用工具。",
      triggers: [],
      eventTriggers: [trigger],
      notification: "none",
      mode: "chat",
    },
  });
  const cookie = `ma_session=${ctx.db.createSession()}`;
  const auth = (
    await ctx.app.inject({
      method: "POST",
      url: "/api/automations/event-settings",
      headers: { origin, cookie },
      payload: {
        taskId: task.id,
        triggerId: trigger.id,
        revision: task.revision,
      },
    })
  ).json();
  async function send(word: string, id: string) {
    const raw = JSON.stringify({ type: "test", word });
    const headers = eventHeaders("webhook", auth.secret, raw, { id });
    const result = await fetch(origin + auth.path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: raw,
    });
    assert([200, 202].includes(result.status));
    return result.json();
  }
  const id = randomUUID(),
    first = await send("松柏", id);
  const r1 = await complete(task.id, first.runId);
  assert.match(records[0].text, /松柏/);
  assert.equal((await send("松柏", id)).runId, r1.id);
  checks.push("real-http-standard-webhook-real-model-once");
  const second = await send("银杏", randomUUID());
  assert.equal(ctx.automations.result(second.runId).state, "queued");
  await ctx.app.close();
  ctx = await start();
  assert.equal((await send("松柏", id)).runId, r1.id);
  assert.equal(ctx.automations.read(task.id).runs.length, 2);
  checks.push(
    "restart-restores-binding-key-queued-event-and-durable-deduplication",
  );
  const r2 = await complete(task.id, second.runId);
  assert.equal(r1.threadId, r2.threadId);
  assert.notEqual(r1.turnId, r2.turnId);
  assert.match(records[1].text, /松柏/);
  assert.match(records[1].text, /银杏/);
  checks.push("same-task-thread-retains-prior-event-context");
  const archived = await ctx.app.inject({
    method: "POST",
    url: "/api/agent/action",
    headers: { origin, cookie },
    payload: { action: "thread/archive", threadId: r2.threadId },
  });
  assert.equal(archived.statusCode, 200, archived.body);
  task = ctx.automations.read(task.id).task;
  assert.equal(task.enabled, false);
  task = await ctx.automations.resume(task.id, task.revision);
  task = ctx.automations.control(task.id, task.revision, "pause")!;
  ctx.db.raw.prepare("UPDATE threads SET archived=1 WHERE id=?").run(r2.threadId!);
  task = await ctx.automations.resume(task.id, task.revision);
  checks.push("native-restore-reconciles-already-restored-conversation-after-lost-receipt");
  checks.push(
    "native-chat-archive-pauses-task-and-explicit-resume-restores-binding",
  );
  task = await ctx.automations.save({
    id: task.id,
    expectedRevision: task.revision,
    content: {
      ...task,
      mode: "plan",
      prompt: "本轮只回复：模式切换验收通过。不要调用工具。",
    },
  });
  const manual = ctx.automations.runNow(task.id, task.revision, randomUUID());
  const r3 = await complete(task.id, manual.id);
  assert.equal(r3.threadId, r1.threadId);
  assert.equal(ctx.service.runtimeSettings.get(r3.threadId!).mode, "plan");
  checks.push("manual-run-after-task-mode-edit-same-native-thread");
  assert.equal(
    ctx.db.raw.prepare("SELECT COUNT(*) n FROM threads").get()!.n,
    1,
  );
  checks.push("one-native-conversation-for-three-independent-runs");
  await writeFile(
    join(out, "live-model.json"),
    JSON.stringify(
      {
        passed: true,
        scope:
          "Isolated copy of model configuration and provider credentials only; actual configured model and native Codex; local real HTTP sender, not GitHub/OpenClaw/Hermes service runtimes; no production tasks or email",
        checks,
        records,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks }));
} catch (e) {
  await writeFile(
    join(out, "live-model-failure.json"),
    JSON.stringify({ error: String(e), checks, records }, null, 2),
  );
  throw e;
} finally {
  await ctx?.app.close();
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 1000,
  });
}
