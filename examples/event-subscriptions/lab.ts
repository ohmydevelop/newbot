import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "../../server/index.js";
import { FakeCodex } from "../../tests/fixture.js";
import { automationSchema } from "../../shared/automations.js";
import { ProviderRegistry } from "../../server/event-subscriptions/contracts.js";
import { SubscriptionEngine } from "../../server/event-subscriptions/engine.js";
import { loopbackPullAdapter } from "./loopback-pull.js";
import { automationBridge } from "./automation-bridge.js";
import { upstreamFixture } from "./upstream-fixture.js";

const directory = mkdtempSync(join(tmpdir(), "newbot-outbound-lab-"));
let clock = Date.now();
const codex = new FakeCodex();
codex.unload = async (id) => {
  codex.loaded.delete(id);
};
const nativeCall = codex.call.bind(codex);
codex.call = async (method, params) => {
  const result = await nativeCall(method, params);
  if (method === "thread/resume")
    (result as { modelProvider?: unknown }).modelProvider = (
      params as { modelProvider?: unknown }
    ).modelProvider;
  return result;
};
const upstream = await upstreamFixture();
const ctx = await createServer({
  directory: join(directory, "newbot"),
  cwd: join(directory, "work"),
  codex,
  providerRuntime: null,
  password: "isolated-experiment-password",
  automationClock: () => clock,
  automationTimer: false,
});
const adapter = loopbackPullAdapter(upstream.endpoint, () => upstream.token);
const registry = new ProviderRegistry(new Map([["loopback-pull-v1", adapter]]));
const providerId = registry.install(
  JSON.parse(readFileSync(new URL("./plugin.json", import.meta.url), "utf8")),
);
const bridge = automationBridge(ctx.automations);
let offlineTarget: string | undefined;
let lostReceipt = false;
const make = () =>
  new SubscriptionEngine({
    directory: join(directory, "subscriptions"),
    registry,
    now: () => clock,
    pollMs: 1000,
    deliver: async (target, event, id) => {
      if (target.taskId === offlineTarget)
        throw new Error("Injected target failure");
      const result = await bridge(target, event, id);
      if (lostReceipt) {
        lostReceipt = false;
        throw new Error("Injected lost delivery receipt");
      }
      return result;
    },
  });
let engine = make();
const checks: string[] = [];
try {
  assert.equal(ctx.app.server.listening, false);
  await ctx.service.settings();
  const tasks = await Promise.all(
    ["订阅实验 A", "订阅实验 B"].map((name) =>
      ctx.automations.save({
        id: randomUUID(),
        expectedRevision: 0,
        content: automationSchema.parse({
          name,
          prompt: "汇总本次测试事件",
          triggers: [],
          eventTriggers: [{ id: randomUUID(), source: "webhook" }],
          notification: "none",
        }),
      }),
    ),
  );
  const targets = tasks.map((t) => ({
    taskId: t.id,
    triggerId: t.eventTriggers[0].id,
    revision: t.revision,
    events: [],
  }));
  const id = engine.subscribe({
    providerId,
    connectionId: "lab-account",
    resource: "inbox",
    targets,
  });
  await engine.tick();
  assert.equal(upstream.requests.filter((r) => r.path === "/pull").length, 1);
  checks.push("两个任务共享一次出站拉取；Newbot 未监听 HTTP 端口");
  await engine.close();
  upstream.events.push({
    id: "first",
    type: "message.received",
    payload: { text: "first local fixture event" },
  });
  clock += 2000;
  const child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./crash-worker.ts", import.meta.url)),
      join(directory, "subscriptions"),
      upstream.endpoint,
      String(clock),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const kill = setTimeout(() => child.kill("SIGKILL"), 15000);
  const exit = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  }).finally(() => clearTimeout(kill));
  assert.equal(exit, 73, stderr);
  engine = make();
  assert.equal(engine.inspect(id).cursor, "1");
  assert.equal(engine.inspect(id).awaitingAck, true);
  assert.equal(upstream.acknowledgments.includes("1"), false);
  assert.equal(
    ctx.db.raw.prepare("SELECT COUNT(*) n FROM automation_runs").get()!.n,
    0,
  );
  clock += 2000;
  offlineTarget = tasks[1].id;
  lostReceipt = true;
  await engine.tick();
  assert.equal(
    ctx.db.raw.prepare("SELECT COUNT(*) n FROM automation_runs").get()!.n,
    1,
  );
  await engine.close();
  engine = make();
  offlineTarget = undefined;
  clock += 2000;
  await engine.tick();
  assert.equal(
    ctx.db.raw.prepare("SELECT COUNT(*) n FROM automation_runs").get()!.n,
    2,
  );
  assert.deepEqual(engine.inspect(id).deliveries, { accepted: 2 });
  checks.push(
    "子进程在落盘后 ack 前退出；恢复后完成确认及双目标派发，回执丢失未重复创建 run",
  );

  await ctx.automations.tick();
  const first = tasks.map((t) => ctx.automations.read(t.id).runs[0]);
  for (const run of first) {
    assert.equal(run.state, "running", JSON.stringify(run));
    codex.finish(run.threadId!);
  }
  await ctx.automations.tick();
  upstream.controls.disconnect = true;
  clock += 2000;
  await engine.tick();
  assert.equal(engine.inspect(id).state, "retry");
  assert.equal(engine.inspect(id).cursor, "1");
  upstream.events.push({
    id: "second",
    type: "message.received",
    payload: { text: "after connection loss" },
  });
  upstream.controls.disconnect = false;
  clock += 2000;
  await engine.tick();
  await ctx.automations.tick();
  const second = tasks.map((t) => ctx.automations.read(t.id).runs[0]);
  for (let i = 0; i < tasks.length; i++) {
    assert.equal(second[i].state, "running", JSON.stringify(second[i]));
    assert.equal(second[i].threadId, first[i].threadId);
    assert.notEqual(second[i].turnId, first[i].turnId);
    codex.finish(second[i].threadId!);
  }
  await ctx.automations.tick();
  assert.equal(
    ctx.db.raw.prepare("SELECT COUNT(*) n FROM threads").get()!.n,
    2,
  );
  checks.push(
    "真实 HTTP 连接中断后补齐；每个任务两次执行保持同一会话、不同 turn",
  );
  upstream.controls.repeat = true;
  clock += 2000;
  await engine.tick();
  assert.equal(
    ctx.db.raw.prepare("SELECT COUNT(*) n FROM automation_runs").get()!.n,
    4,
  );
  checks.push("上游重复投递没有新增运行");

  ctx.automations.control(tasks[0].id, tasks[0].revision, "pause");
  const changed = tasks[1];
  await ctx.automations.save({
    id: changed.id,
    expectedRevision: changed.revision,
    content: automationSchema.parse({ ...changed, name: "已修改任务" }),
  });
  upstream.controls.repeat = false;
  upstream.events.push({
    id: "stale",
    type: "message.received",
    payload: { text: "must not execute" },
  });
  clock += 2000;
  await engine.tick();
  assert.equal(engine.inspect(id).deliveries.discarded, 2);
  assert.equal(
    ctx.db.raw.prepare("SELECT COUNT(*) n FROM automation_runs").get()!.n,
    4,
  );
  checks.push("暂停任务和修改任务均拒绝旧绑定事件");
  const updated = ctx.automations.list().find((t) => t.id === changed.id)!;
  ctx.automations.control(updated.id, updated.revision, "delete");
  upstream.events.push({
    id: "after-delete",
    type: "message.received",
    payload: { text: "deleted task must not run" },
  });
  clock += 2000;
  await engine.tick();
  assert.equal(engine.inspect(id).deliveries.discarded, 4);
  assert.equal(
    ctx.db.raw.prepare("SELECT COUNT(*) n FROM automation_runs").get()!.n,
    4,
  );
  checks.push("删除任务后迟到事件被丢弃，没有新增运行");
  const report = {
    result: "passed",
    recordedAt: new Date().toISOString(),
    checks,
    subscriptions: 1,
    tasks: 2,
    runs: 4,
    newbotListening: ctx.app.server.listening,
    conversations: tasks.map((t, i) => ({
      taskId: t.id,
      threadId: first[i].threadId,
      turnIds: [first[i].turnId, second[i].turnId],
    })),
    pullRequests: upstream.requests.filter((r) => r.path === "/pull").length,
    limitations: [
      "上游为本地 HTTP 替身，未验证真实 Gmail/GitHub 或 OAuth",
      "使用 FakeCodex，未调用真实模型",
      "消费者没有监听端口，但未配置或测试物理防火墙",
      "实验插件清单与内部 webhook 类型桥不代表生产插件/UI 已接通",
    ],
  };
  const reportArg = process.argv.indexOf("--report");
  if (reportArg !== -1) {
    const path = resolve(process.argv[reportArg + 1]);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  await engine.close();
  await ctx.app.close();
  await upstream.close();
  rmSync(directory, { recursive: true, force: true });
}
