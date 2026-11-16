import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
const origin = process.env.AUTOMATION_PUBLIC_ORIGIN,
  directory = process.env.AUTOMATION_PUBLIC_DATA;
if (!origin || !directory)
  throw Error("Explicit public origin and data directory are required");
const out = resolve(
  process.env.AUTOMATION_EVIDENCE_DIR || ".data/automation-public",
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch(),
  page = await browser.newPage({
    viewport: { width: 1280, height: 844 },
    locale: "zh-CN",
  });
let task, run;
const evidence = { origin, checks: [], passed: false };
async function api(path, body) {
  const response = await page.request.fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: { Origin: origin },
    ...(body ? { data: body } : {}),
  });
  assert.equal(response.status(), 200, `HTTP ${response.status()} ${path}`);
  return response.json();
}
try {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page
    .getByLabel("登录密码")
    .fill((await readFile(join(directory, "initial-password"), "utf8")).trim());
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: /^自动任务/ })
    .click();
  await page.getByRole("heading", { name: "自动任务", exact: true }).waitFor();
  evidence.checks.push("public-login-sidebar-automation-entry");
  const id = randomUUID();
  task = await api("/api/automations/save", {
    id,
    expectedRevision: 0,
    content: {
      name: "自动任务部署验收",
      prompt: "只回复：自动任务部署验收通过。不要调用工具。",
      notification: "none",
      mode: "chat",
      triggers: [
        {
          id: randomUUID(),
          frequency: "once",
          date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          time: "08:00",
          timezone: "Asia/Shanghai",
        },
      ],
    },
  });
  task = (
    await api("/api/automations/control", {
      id: task.id,
      revision: task.revision,
      action: "pause",
    })
  ).task;
  run = (
    await api("/api/automations/run", {
      id: task.id,
      revision: task.revision,
      requestId: randomUUID(),
    })
  ).run;
  for (
    let i = 0;
    i < 90 &&
    ["queued", "dispatching", "running", "waiting"].includes(run.state);
    i++
  ) {
    await new Promise((r) => setTimeout(r, 2000));
    run = (await api("/api/automations/" + task.id)).runs.find(
      (r) => r.id === run.id,
    );
  }
  assert.equal(run.state, "succeeded");
  evidence.run = { id: run.id, threadId: run.threadId, state: run.state };
  evidence.checks.push("public-server-real-model-automation-completed");
  await page.getByRole("button", { name: "刷新自动任务", exact: true }).click();
  await page
    .locator(".automation-row-copy")
    .filter({ hasText: task.name })
    .first()
    .click();
  await page.getByRole("tab", { name: "运行记录", exact: true }).click();
  await page
    .getByRole("button", { name: "打开会话", exact: true })
    .first()
    .waitFor();
  await page
    .locator(".automation-page")
    .screenshot({ path: join(out, "public-run.png") });
  await page
    .getByRole("button", { name: "打开会话", exact: true })
    .first()
    .click();
  await page
    .getByText("自动任务部署验收通过。", { exact: true })
    .waitFor({ timeout: 30000 });
  evidence.checks.push("public-result-opens-real-conversation");
  await api("/api/automations/control", {
    id: task.id,
    revision: task.revision,
    action: "delete",
  });
  task = null;
  await api("/api/agent/action", {
    action: "thread/archive",
    threadId: run.threadId,
  });
  run = null;
  evidence.checks.push("only-created-test-task-deleted-and-chat-archived");
  evidence.release = await api("/release-manifest.json");
  evidence.passed = true;
} finally {
  if (run && ["queued", "running", "waiting"].includes(run.state))
    await api("/api/automations/stop", { id: run.id }).catch(() => {});
  if (task)
    await api("/api/automations/control", {
      id: task.id,
      revision: task.revision,
      action: "delete",
    }).catch(() => {});
  await writeFile(
    join(out, "public-smoke.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await browser.close();
}
console.log(JSON.stringify(evidence));
