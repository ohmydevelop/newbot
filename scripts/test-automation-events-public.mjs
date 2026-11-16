import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join } from "node:path";
import { chromium } from "playwright";
import { eventHeaders } from "./send-automation-event.mjs";

const origin = process.env.AUTOMATION_PUBLIC_ORIGIN;
const directory = process.env.AUTOMATION_PUBLIC_DATA;
if (!origin || !directory)
  throw Error("Explicit production origin and data directory required");
const out = resolve(
  process.env.AUTOMATION_EVIDENCE_DIR || ".data/automation-events-public",
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
  locale: "zh-CN",
});
let task, activeRun;
const threads = new Set();
const evidence = { origin, passed: false, checks: [], runs: [] };
async function api(path, body) {
  const response = await page.request.fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: { Origin: origin },
    ...(body ? { data: body } : {}),
  });
  assert.equal(response.status(), 200, `HTTP ${response.status()} ${path}`);
  return response.json();
}
async function complete(id) {
  activeRun = id;
  for (let i = 0; i < 90; i++) {
    const run = (await api("/api/automations/" + task.id)).runs.find(
      (r) => r.id === id,
    );
    if (run.threadId) threads.add(run.threadId);
    if (!["queued", "dispatching", "running", "waiting"].includes(run.state)) {
      assert.equal(run.state, "succeeded", run.error);
      evidence.runs.push({
        id: run.id,
        threadId: run.threadId,
        turnId: run.turnId,
        state: run.state,
      });
      activeRun = null;
      return run;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw Error("Public model run timed out");
}
try {
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  await page
    .getByLabel("登录密码")
    .fill((await readFile(join(directory, "initial-password"), "utf8")).trim());
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const trigger = { id: randomUUID(), source: "webhook" };
  task = await api("/api/automations/save", {
    id: randomUUID(),
    expectedRevision: 0,
    content: {
      name: "事件接入部署验收",
      prompt: "只回复：持续会话验收通过。不要调用工具。",
      notification: "none",
      mode: "chat",
      triggers: [],
      eventTriggers: [trigger],
    },
  });
  const auth = await api("/api/automations/event-settings", {
    taskId: task.id,
    triggerId: trigger.id,
    revision: task.revision,
  });
  const raw = JSON.stringify({
      type: "verification",
      message: "部署后的签名事件",
    }),
    id = randomUUID();
  async function send() {
    const response = await fetch(origin + auth.path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...eventHeaders("webhook", auth.secret, raw, { id }),
      },
      body: raw,
      redirect: "error",
    });
    assert(
      [200, 202].includes(response.status),
      `Event HTTP ${response.status}`,
    );
    return response.json();
  }
  const first = await complete((await send()).runId);
  assert.equal((await send()).runId, first.id);
  evidence.checks.push("public-https-signed-event-without-cookie-deduplicated");
  const second = await complete(
    (
      await api("/api/automations/run", {
        id: task.id,
        revision: task.revision,
        requestId: randomUUID(),
      })
    ).run.id,
  );
  assert.equal(second.threadId, first.threadId);
  assert.notEqual(second.turnId, first.turnId);
  evidence.checks.push("event-and-manual-real-model-runs-share-one-thread");
  await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: /^自动任务/ })
    .click();
  await page
    .locator(".automation-row-copy")
    .filter({ hasText: task.name })
    .first()
    .click();
  await page
    .getByRole("button", { name: "Webhook 连接设置", exact: true })
    .click();
  await page.getByLabel("事件密钥", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("事件密钥", { exact: true }).getAttribute("type"),
    "password",
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth),
    390,
  );
  const actions = await page
    .locator(".automation-detail-actions")
    .evaluate((el) => ({
      statusHeight: el.querySelector("span").getBoundingClientRect().height,
      heights: [...el.querySelectorAll("button")].map(
        (button) => button.getBoundingClientRect().height,
      ),
    }));
  assert(actions.statusHeight < 25);
  assert(Math.max(...actions.heights) - Math.min(...actions.heights) < 1);
  await page.screenshot({ path: join(out, "public-event-connection-390.png") });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "任务会话", exact: true }).click();
  await page.getByText("持续会话验收通过。", { exact: true }).first().waitFor();
  evidence.checks.push("mobile-browser-connection-popup-and-task-chat");
  evidence.release = await api("/release-manifest.json");
  evidence.passed = true;
} finally {
  if (activeRun)
    await api("/api/automations/stop", { id: activeRun }).catch(() => {});
  if (task)
    await api("/api/automations/control", {
      id: task.id,
      revision: task.revision,
      action: "delete",
    }).catch(() => {});
  for (const threadId of threads)
    await api("/api/agent/action", {
      action: "thread/archive",
      threadId,
    }).catch(() => {});
  await writeFile(
    join(out, "public-events.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  await browser.close();
}
console.log(JSON.stringify(evidence));
