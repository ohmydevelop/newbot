// One real model turn: generate a native form, fill in the real chat UI, and
// continue that same Codex turn. Uses existing server-side model credentials.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "../server/index.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const directory = mkdtempSync(join(tmpdir(), "newbot-a2ui-live-"));
const output = resolve(".data/a2ui-live");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const file of ["result.json", "failure.json"])
  rmSync(join(output, file), { force: true });
process.env.CODEX_BIN ||= resolve("node_modules/.bin/codex");
const password = randomBytes(24).toString("base64url"),
  port = Number(process.env.A2UI_LIVE_PORT || 3125),
  origin = `http://127.0.0.1:${port}`;
const ctx = await createServer({
    providerRuntime: null,
  directory: join(directory, "app"),
  cwd: join(directory, "workspace"),
  password,
  origins: [origin],
});
let browser, threadId, turnId, timer, model;
const stages = [],
  nativeRequests = [],
  errors = [],
  turns = [];
process.once("SIGTERM", () => {
  void ctx.app.close().finally(() => process.exit(1));
});
ctx.runtime.on("tool", (request) => {
  nativeRequests.push({
    tool: request.params.tool,
    callId: request.params.callId,
    threadId: request.params.threadId,
    turnId: request.params.turnId,
  });
});
ctx.runtime.on(
  "approval",
  (request) =>
    void ctx.service
      .handle("approval/respond", { id: request.id, allow: false })
      .catch(() => {}),
);
const call = ctx.runtime.call.bind(ctx.runtime);
ctx.runtime.call = async (method, params) => {
  if (method === "turn/start") turns.push(params.threadId);
  return call(method, params);
};
try {
  await ctx.app.listen({ host: "127.0.0.1", port });
  await ctx.runtime.start();
  assert.equal(ctx.runtime.state, "ready");
  const settings = await ctx.service.settings();
  model = process.env.A2UI_LIVE_MODEL || settings.model;
  assert.ok(settings.models.some((m) => m.model === model));
  stages.push("native runtime ready");
  const login = await fetch(origin + "/api/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const headers = {
    origin,
    cookie: login.headers.get("set-cookie").split(";")[0],
  };
  const done = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error("Native A2UI proof timed out")),
      180_000,
    );
    ctx.runtime.on("event", (event) => {
      if (event.method === "turn/completed") resolve(event.params);
    });
  });
  done.catch(() => {});
  const response = await fetch(origin + "/api/agent/run", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({
      requestId: randomUUID(),
      model,
      text: "A2UI native integration proof. Use only the newbot_ui tool, exactly once with waitForAction:true, to generate a small task form. Use A2UI v0.9 and catalog newbot:ui/v1. Surface ID native-proof, root Column. Include a Text heading, one TextField labelled 任务名称 bound to /taskName (initial data value 待填写), and one Button labelled 提交任务 with action event name submit and context taskName bound to /taskName. All referenced Text labels must exist. Wait for the actual tool result; afterwards reply with NATIVE_A2UI_OK followed by the submitted task name. Do not use shell, filesystem, MCP, delegation, or any other tools. Do not output the JSON in Markdown. This proof only collects ordinary test text and makes no real external changes.",
    }),
  });
  assert.equal(response.status, 200);
  const run = await response.json();
  threadId = run.threadId;
  turnId = run.turn.id;
  stages.push("one native turn started");
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1100 },
  });
  await context.addInitScript(
    ({ threadId }) =>
      localStorage.setItem("ma_preferences", JSON.stringify({ threadId })),
    { threadId },
  );
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByLabel("登录密码").fill(password);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  const panel = page.getByRole("region", {
    name: "助手生成的表单",
    exact: true,
  });
  await panel
    .getByLabel("任务名称", { exact: true })
    .waitFor({ timeout: 150_000 });
  const view = [
    ...ctx.service.events.threads
      .get(threadId)
      .turns.flatMap((turn) => turn.items),
  ].find((item) => item.a2ui)?.a2ui;
  assert.equal(view.state, "waiting");
  assert.equal(view.turnId, turnId);
  assert.equal(nativeRequests.length, 1);
  assert.equal(nativeRequests[0].callId, view.itemId);
  stages.push("real model form rendered in chat");
  const marker = `测试任务_${randomBytes(5).toString("hex")}`;
  await panel.getByLabel("任务名称", { exact: true }).fill(marker);
  await page.screenshot({
    path: join(output, "waiting-desktop.png"),
    animations: "disabled",
  });
  await panel.getByRole("button", { name: "提交任务", exact: true }).click();
  const end = await done;
  assert.equal(end.threadId, threadId);
  assert.equal(end.turn.id, turnId);
  assert.equal(end.turn.status, "completed");
  await page
    .getByText(new RegExp(`NATIVE_A2UI_OK.*${marker}`))
    .waitFor({ timeout: 20_000 });
  await page
    .getByRole("button", { name: "发送消息", exact: true })
    .waitFor({ timeout: 15_000 });
  const history = await ctx.service.read(threadId);
  assert.equal(
    history.turns
      .flatMap((turn) => turn.items)
      .filter((item) =>
        ["commandExecution", "mcpToolCall", "fileChange", "webSearch"].includes(
          item.type,
        ),
      ).length,
    0,
  );
  assert.equal(turns.length, 1);
  assert.equal(ctx.service.ui.pending, 0);
  assert.deepEqual(errors, []);
  stages.push(
    "browser input returned to the same native turn and final answer",
  );
  await page.screenshot({
    path: join(output, "completed-desktop.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.locator(".sidebar").waitFor({ state: "hidden" });
  await panel.getByLabel("任务名称", { exact: true }).scrollIntoViewIfNeeded();
  assert.equal(
    await panel.getByLabel("任务名称", { exact: true }).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        document.elementFromPoint(
          rect.x + rect.width / 2,
          rect.y + rect.height / 2,
        ) === element
      );
    }),
    true,
  );
  await page.screenshot({
    path: join(output, "completed-mobile-dark.png"),
    animations: "disabled",
  });
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      {
        model,
        threadId,
        turnId,
        stages,
        nativeRequests,
        turnStarts: turns.length,
        pendingForms: ctx.service.ui.pending,
        pageErrors: errors,
        marker,
      },
      null,
      2,
    ),
  );
  console.log(
    `Native A2UI proof passed (${model}): real form → browser input → same-turn final response`,
  );
} catch (error) {
  writeFileSync(
    join(output, "failure.json"),
    JSON.stringify(
      {
        error: String(error),
        model,
        threadId,
        turnId,
        stages,
        nativeRequests,
        turnStarts: turns.length,
        pendingForms: ctx.service.ui.pending,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  clearTimeout(timer);
  await browser?.close();
  if (threadId && ctx.runtime.active.has(threadId))
    await ctx.runtime
      .call("turn/interrupt", { threadId, turnId })
      .catch(() => {});
  if (threadId && !ctx.runtime.active.has(threadId))
    await ctx.runtime.call("thread/archive", { threadId }).catch(() => {});
  await ctx.app.close();
  rmSync(directory, { recursive: true, force: true });
}
