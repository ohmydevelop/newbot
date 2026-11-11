import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const { chromium } = await import(
  "/home/a/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"
);
const output = resolve(".issue/2026-11-10/evidence-issue-06/S4/ui");
mkdirSync(output, { recursive: true });
const origin = "http://127.0.0.1:3163";
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/conversation-recovery-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_TRANSPORT: "poll",
      RECOVERY_FLOW_TEST_PORT: "3163",
      UI_TEST_CANDIDATE: resolve(".data/issue-06-web"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let browser,
  page,
  log = "";
const checks = [],
  errors = [],
  exit = new Promise((r) => server.once("exit", r));
const wait = async (fn) => {
  const until = Date.now() + 15000;
  while (!(await fn())) {
    if (Date.now() > until) throw Error("assertion timed out");
    await new Promise((r) => setTimeout(r, 50));
  }
};
try {
  await new Promise((r, j) => {
    const t = setTimeout(() => j(Error(log)), 15000);
    const read = (d) => {
      log += d;
      if (log.includes("Conversation recovery UI fixture ready")) {
        clearTimeout(t);
        r();
      }
    };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
  });
  browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  await context.request.post(origin + "/api/login", {
    headers: { origin },
    data: { password: "recovery-ui-fixture-login" },
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  const draft = page.getByPlaceholder("询问任何问题"),
    send = page.getByRole("button", { name: "发送消息", exact: true });
  const count = async () =>
    (
      await context.request.post(origin + "/api/test/recovery", {
        headers: { origin },
        data: { action: "inspect" },
      })
    ).json();
  const fresh = async () =>
    page.getByRole("button", { name: /^新聊天/ }).click();
  await draft.waitFor();
  await fresh();
  let release, reached, completed;
  const fulfilled = new Promise((r) => (completed = r));
  const ready = new Promise((r) => (reached = r));
  await page.route("**/api/agent/run", async (route) => {
    const response = await route.fetch();
    await new Promise((r) => {
      release = r;
      reached();
    });
    await route.fulfill({ response });
    completed();
  });
  await draft.fill("normal submission");
  await send.click();
  await ready;
  assert.equal(
    await page.getByText("上次发送等待确认", { exact: true }).count(),
    0,
  );
  await draft.fill("newer typing");
  release();
  await fulfilled;
  await page.unroute("**/api/agent/run");
  await page
    .getByText("Received: normal submission", { exact: true })
    .waitFor();
  assert.equal(await draft.inputValue(), "newer typing");
  checks.push(
    "normal submission has no unknown notice; late response preserves newer typing",
  );
  await fresh();
  const before = (await count()).turns;
  await page.route("**/api/agent/run", async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await draft.fill("accepted response lost");
  await send.click();
  await page
    .getByText("Received: accepted response lost", { exact: true })
    .waitFor();
  await wait(
    async () =>
      Object.keys(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.ma_pending_runs || "{}"),
        ),
      ).length === 0,
  );
  assert.equal((await count()).turns, before + 1);
  await page.unroute("**/api/agent/run");
  checks.push(
    "lost accepted response resolves automatically without duplicate execution",
  );
  await fresh();
  let payload;
  await page.route("**/api/agent/run", (route) => {
    payload = route.request().postDataJSON();
    return route.abort("failed");
  });
  await draft.fill("unregistered draft");
  await send.click();
  await page.getByText("上次发送等待确认", { exact: true }).waitFor();
  await page.unroute("**/api/agent/run");
  await page
    .locator(".history-link")
    .getByText("Beta Chat", { exact: true })
    .click();
  await draft.fill("other conversation usable");
  await wait(() => send.isEnabled());
  assert.equal(
    await page.getByText("上次发送等待确认", { exact: true }).count(),
    0,
  );
  await send.click();
  await page
    .getByText("Received: other conversation usable", { exact: true })
    .waitFor();
  checks.push("unknown request does not lock other conversation");
  await page.getByRole("button", { name: "待确认的发送", exact: true }).click();
  assert.equal(await draft.inputValue(), "unregistered draft");
  await page.getByRole("button", { name: "检查发送状态", exact: true }).click();
  await page
    .getByRole("button", { name: "放弃尚未登记的发送", exact: true })
    .click();
  await page
    .getByText("尚未登记的发送已放弃，草稿保留；迟到请求不会执行。", {
      exact: true,
    })
    .waitFor();
  assert.equal(
    (
      await context.request.post(origin + "/api/agent/run", {
        headers: { origin },
        data: payload,
      })
    ).status(),
    409,
  );
  checks.push("original draft restored; abandonment fences delayed request");
  await fresh();
  let submitPayload;
  await page.route("**/api/agent/run", async (route) => {
    submitPayload = route.request().postDataJSON();
    await route.fetch();
    await route.abort("failed");
  });
  await page.route("**/api/agent/runs/*", (route) => route.abort("failed"));
  await draft.fill("recover after refresh");
  await send.click();
  await page.getByText("上次发送等待确认", { exact: true }).waitFor();
  const savedCount = (await count()).turns;
  await page.unroute("**/api/agent/run");
  await page.unroute("**/api/agent/runs/*");
  await page.reload();
  await wait(
    async () =>
      Object.keys(
        await page.evaluate(() =>
          JSON.parse(sessionStorage.ma_pending_runs || "{}"),
        ),
      ).length === 0,
  );
  assert.equal((await count()).turns, savedCount);
  checks.push("refresh resolves accepted state using GET only");
  await page.screenshot({ path: join(output, "recovery-desktop.png") });
  assert.deepEqual(errors, []);
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify({ checks, errors, synthetic: true }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }));
} catch (e) {
  if (page)
    await page
      .screenshot({ path: join(output, "failure.png") })
      .catch(() => {});
  throw e;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await exit;
}
