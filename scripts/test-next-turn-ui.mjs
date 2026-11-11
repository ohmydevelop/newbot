// Isolated browser acceptance for saved next-turn choices. No external provider calls.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".issue/2026-11-10/evidence-issue-04/S4/browser");
mkdirSync(output, { recursive: true });
const origin = "http://127.0.0.1:3158";
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/issue-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_TRANSPORT: "poll",
      ISSUE_TEST_PORT: "3158",
      ISSUE_MEMORY_PROVIDERS: "1",
      ISSUE_RICH_UI: "1",
      ISSUE_ACTIVITY_UI: "1",
      ISSUE_TURN_MS: "180000",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const exited = new Promise((r) => server.once("exit", r));
const result = {
  checks: [],
  errors: [],
  candidate: process.env.UI_TEST_CANDIDATE || "dist/web",
};
let browser,
  page,
  log = "";
try {
  await new Promise((done, fail) => {
    const timer = setTimeout(() => fail(Error(log)), 15000);
    const read = (c) => {
      log += c;
      if (log.includes("Issue UI fixture ready")) {
        clearTimeout(timer);
        done();
      }
    };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
    server.once("exit", () => {
      clearTimeout(timer);
      fail(Error(log));
    });
  });
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  const post = async (url, data) => {
    const r = await context.request.post(origin + url, {
      headers: { origin },
      data,
    });
    const body = await r.json();
    assert.equal(r.status(), 200, JSON.stringify(body));
    return body;
  };
  const action = (action, p = {}) =>
    post("/api/agent/action", { action, ...p });
  await post("/api/login", { password: "issue-fixture-login" });
  const first = await post("/api/agent/run", {
    requestId: crypto.randomUUID(),
    text: "Next turn choices",
    provider: "fixture",
    model: "fixture-model",
  });
  const threadId = first.threadId;
  const baseline = await (
    await context.request.get(origin + "/api/test/issue")
  ).json();
  const view = async () =>
    (await context.request.get(origin + "/api/threads/" + threadId)).json();
  const wait = async (fn) => {
    const end = Date.now() + 12000;
    while (!(await fn())) {
      if (Date.now() > end) throw Error("State did not converge");
      await new Promise((r) => setTimeout(r, 60));
    }
  };
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => result.errors.push(e.message));
  await page.goto(origin);
  await page
    .locator(".history-link")
    .filter({ hasText: "Next turn choices" })
    .click();
  await page.getByRole("button", { name: "停止回答", exact: true }).waitFor();
  const controls = await page
    .locator(".runtime-picker-trigger,.approval-trigger,.skill-picker-trigger")
    .evaluateAll((es) =>
      es.map((e) => ({
        label: e.getAttribute("aria-label"),
        disabled: e.disabled,
      })),
    );
  assert.ok(controls.length >= 3 && controls.every((c) => !c.disabled));
  result.checks.push(
    "model, permission and skill controls stay enabled during a native turn",
  );
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("Draft kept while changing settings");
  await page
    .getByRole("button", { name: "选择模型与推理强度", exact: true })
    .click();
  await page.getByRole("button", { name: /第二网关.*模型分组/ }).click();
  await page
    .getByRole("listbox", { name: /第二网关/ })
    .getByRole("option", { name: "secondary-model", exact: true })
    .click();
  await wait(async () => (await view()).runtime.provider === "secondary");
  await page.getByRole("button", { name: "推理强度：高", exact: true }).click();
  await wait(async () => (await view()).runtime.effort === "high");
  await page.keyboard.press("Escape");
  await page.locator(".approval-trigger").click();
  await page
    .getByRole("menuitemradio", { name: "帮我批准", exact: true })
    .click();
  await wait(async () => (await view()).runtime.approval === "review");
  assert.equal(
    await page.getByRole("textbox", { name: "消息", exact: true }).inputValue(),
    "Draft kept while changing settings",
  );
  let current = await view();
  assert.equal(current.runtime.pending.state, "pending");
  assert.equal(current.runtime.applied.provider, "fixture");
  assert.equal(current.runtime.applied.approval, "ask");
  const before = (await context.request.get(origin + "/api/test/issue")).json();
  assert.equal((await before).calls.length, 1);
  assert.deepEqual((await before).unloads, baseline.unloads);
  await page.getByRole("button", { name: "选择技能", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "代码审查" }).click();
  await wait(async () => (await view()).nextInput.skills.length === 1);
  await page
    .getByRole("button", { name: "选择专家或插件", exact: true })
    .click();
  await page.getByRole("option").filter({ hasText: "测试插件" }).click();
  await wait(async () => (await view()).nextInput.plugins.length === 1);
  result.checks.push(
    "next-turn model, approval, skill and plugin are saved without native mutation or draft loss",
  );
  await page.reload();
  await page
    .locator(".history-link")
    .filter({ hasText: "Next turn choices" })
    .click();
  await page
    .getByRole("button", { name: "移除技能 代码审查", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "移除插件 测试插件", exact: true })
    .waitFor();
  assert.ok(await page.locator(".runtime-pending").isVisible());
  result.checks.push(
    "refresh restores pending settings and both reference kinds",
  );
  for (const theme of ["light", "dark"])
    for (const width of [1366, 390]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: 900 });
      await page
        .getByRole("button", { name: "选择模型与推理强度", exact: true })
        .click();
      await page
        .getByRole("button", { name: "撤销下轮设置", exact: true })
        .waitFor();
      const box = await page.locator(".runtime-panel").boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width + 1);
      await page.screenshot({
        path: resolve(output, `next-turn-${theme}-${width}.png`),
      });
      await page.keyboard.press("Escape");
    }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page
    .getByRole("button", { name: "选择模型与推理强度", exact: true })
    .click();
  await page.getByRole("button", { name: "撤销下轮设置", exact: true }).click();
  await wait(async () => (await view()).runtime.provider === "fixture");
  await page.keyboard.press("Escape");
  assert.equal((await view()).runtime.applied.approval, "ask");
  result.checks.push(
    "cancellation restores prior intent without touching the running turn",
  );
  // Re-select the pending values before completing the first native turn.
  current = await view();
  await action("session/update", {
    threadId,
    expectedRevision: current.runtime.revision,
    provider: "secondary",
    model: "secondary-model",
    effort: "high",
    approval: "review",
  });
  await post("/api/test/activity", { threadId, state: "completed" });
  await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("NEXT_WITH_SAVED_CHOICES");
  await post("/api/test/runtime", { failResume: true });
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await wait(async () => (await view()).runtime.pending?.state === "failed");
  assert.equal(
    await page.getByRole("textbox", { name: "消息", exact: true }).inputValue(),
    "NEXT_WITH_SAVED_CHOICES",
  );
  assert.equal((await view()).nextInput.skills.length, 1);
  assert.equal(
    (await (await context.request.get(origin + "/api/test/issue")).json()).calls
      .length,
    1,
  );
  await page
    .getByRole("button", { name: "选择模型与推理强度", exact: true })
    .click();
  await page
    .getByRole("button", { name: "撤销下轮设置", exact: true })
    .waitFor();
  await page.screenshot({ path: resolve(output, "failed-application.png") });
  await post("/api/test/runtime", { failResume: false });
  await page
    .locator(".runtime-pending-details")
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await wait(async () => !(await view()).runtime.pending);
  await page.keyboard.press("Escape");
  result.checks.push(
    "failed native application preserves draft and references, blocks dispatch, and can be explicitly retried",
  );
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await wait(async () =>
    (await context.request.get(origin + "/api/test/issue"))
      .json()
      .then((v) => v.calls.length === 2),
  );
  const state = await (
    await context.request.get(origin + "/api/test/issue")
  ).json();
  const dispatched = state.calls.at(-1);
  assert.equal(dispatched.model, "secondary-model");
  assert.equal(dispatched.effort, "high");
  assert.equal(dispatched.approvalsReviewer, "auto_review");
  assert.equal(dispatched.input.filter((i) => i.type === "skill").length, 1);
  assert.equal(dispatched.input.filter((i) => i.type === "mention").length, 1);
  await wait(async () => {
    const t = await view();
    return (
      !t.runtime.pending &&
      !t.nextInput.skills.length &&
      !t.nextInput.plugins.length
    );
  });
  result.checks.push(
    "next native call uses saved values and structured references exactly once",
  );
  assert.equal(state.restarts, 0);
  assert.equal(state.providerWrites, 0);
  assert.deepEqual(result.errors, []);
} catch (e) {
  result.failure = String(e.stack || e);
  process.exitCode = 1;
  await page
    ?.screenshot({ path: resolve(output, "failure.png") })
    .catch(() => {});
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await exited;
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
}
