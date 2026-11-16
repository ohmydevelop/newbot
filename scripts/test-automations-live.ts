import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Codex } from "../server/codex";
import { createServer } from "../server/index";
const root = process.env.AUTOMATION_STAGE_DIR;
if (!root)
  throw Error("AUTOMATION_STAGE_DIR must be an isolated production snapshot");
const output = resolve(
  process.env.AUTOMATION_EVIDENCE_DIR || ".data/automation-live",
);
await mkdir(output, { recursive: true });
let clock = Date.parse("2026-11-16T00:00:00Z");
const evidence: any = {
  scope:
    "Isolated production snapshot with real configured model; no browser, no external email, no production task changes",
  checks: [],
};
async function start() {
  const native = new Codex(join(root!, "work"), () => ({
    CODEX_HOME: join(root!, "codex"),
    HOME: root!,
  }));
  const ctx = await createServer({
    directory: join(root!, "data"),
    cwd: join(root!, "work"),
    codex: native,
    password: "isolated-automation-test",
    origins: ["http://localhost:3100"],
    automationClock: () => clock,
    automationTimer: false,
  });
  await native.start();
  assert.equal(native.state, "ready");
  return ctx;
}
let ctx = await start();
try {
  const input = {
    name: "自动任务真实模型验收",
    prompt: "只回复：自动任务验收通过。不要调用工具。",
    mode: "chat",
    notification: "app",
    triggers: [
      {
        id: randomUUID(),
        frequency: "daily",
        time: "00:01",
        timezone: "UTC",
        date: "2026-11-16",
      },
    ],
  };
  const task = await ctx.automations.save({
    id: randomUUID(),
    expectedRevision: 0,
    content: input,
  });
  clock += 120000;
  await ctx.automations.tick();
  async function complete() {
    let run = ctx.automations.read(task.id).runs[0];
    for (
      let i = 0;
      i < 180 &&
      ["running", "dispatching", "queued", "waiting"].includes(run.state);
      i++
    ) {
      await new Promise((r) => setTimeout(r, 1000));
      await ctx.automations.tick();
      run = ctx.automations.result(run.id);
    }
    assert.equal(run.state, "succeeded", JSON.stringify(run));
    const t = await ctx.service.read(run.threadId!);
    const answer = t.turns
      .flatMap((v) => v.items)
      .filter((v) => v.type === "agentMessage")
      .map((v: any) => v.text)
      .join("\n");
    assert.match(answer, /验收通过/);
    assert.equal(ctx.service.runtimeSettings.get(run.threadId!).mode, "chat");
    return {
      id: run.id,
      threadId: run.threadId,
      requestId: run.requestId,
      state: run.state,
    };
  }
  const scheduled = await complete();
  evidence.checks.push(
    "scheduled-without-browser-real-model",
    "chat-mode-preserved",
  );
  await ctx.app.close();
  ctx = await start();
  assert.equal(ctx.automations.read(task.id).runs.length, 1);
  assert.equal(ctx.automations.result(scheduled.id).state, "succeeded");
  await ctx.automations.tick();
  assert.equal(ctx.automations.read(task.id).runs.length, 1);
  evidence.checks.push("restart-preserves-task-and-result-without-replay");
  clock += 1000;
  ctx.automations.runNow(task.id, task.revision, randomUUID());
  await ctx.automations.tick();
  const manual = await complete();
  assert.notEqual(scheduled.threadId, manual.threadId);
  evidence.checks.push("run-now-new-independent-conversation");
  ctx.automations.control(task.id, task.revision, "pause");
  clock += 86400000;
  await ctx.automations.tick();
  assert.equal(ctx.automations.read(task.id).runs.length, 2);
  evidence.checks.push("paused-due-time-does-not-dispatch");
  evidence.runs = [scheduled, manual];
  evidence.passed = true;
} catch (e) {
  evidence.passed = false;
  evidence.error = e instanceof Error ? e.message : "failed";
  throw e;
} finally {
  await writeFile(
    join(output, "native-live.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await ctx.app.close();
}
console.log(JSON.stringify(evidence));
