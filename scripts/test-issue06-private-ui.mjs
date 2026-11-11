import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    "/home/a/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"
);
const output = resolve(".issue/2026-11-10/evidence-issue-06/S3/ui");
mkdirSync(output, { recursive: true });
const origin = "http://127.0.0.1:3164";
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/issue-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_TRANSPORT: "poll",
      ISSUE_TEST_PORT: "3164",
      ISSUE_RICH_UI: "1",
      ISSUE_MEMORY_PROVIDERS: "1",
      UI_TEST_CANDIDATE: resolve(".data/issue-06-web"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "",
  browser,
  page;
const checks = [],
  errors = [];
const exited = new Promise((r) => server.once("exit", r));
try {
  await new Promise((r, j) => {
    const timer = setTimeout(() => j(Error(log)), 20000);
    const read = (d) => {
      log += d;
      if (log.includes("Issue UI fixture ready")) {
        clearTimeout(timer);
        r();
      }
    };
    server.stdout.on("data", read);
    server.stderr.on("data", read);
    server.once("exit", () => {
      clearTimeout(timer);
      j(Error(log));
    });
  });
  browser = await chromium.launch({
    headless: true,
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || "/usr/bin/chromium",
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const login = await context.request.post(origin + "/api/login", {
    headers: { origin },
    data: { password: "issue-fixture-login" },
  });
  assert.equal(login.status(), 200);
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole("button", { name: "搜索聊天", exact: true }).waitFor();
  assert.equal(
    await page
      .locator(".sidebar-top")
      .getByRole("button", { name: "搜索聊天", exact: true })
      .count(),
    1,
  );
  await page.getByRole("button", { name: "搜索聊天", exact: true }).click();
  await page
    .getByRole("dialog", { name: "搜索聊天", exact: true })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  checks.push("header search");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "扩展", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await page.getByRole("tab", { name: "连接器", exact: true }).click();
  await settings
    .getByRole("button", { name: "添加连接器", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "添加连接器", exact: true });
  await editor
    .getByRole("textbox", { name: "连接器名称", exact: true })
    .fill("MCP_A · 项目连接");
  await editor
    .getByRole("combobox", { name: "连接方式", exact: true })
    .selectOption("http");
  await editor
    .getByRole("textbox", { name: "服务地址", exact: true })
    .fill("https://connector.example/mcp");
  await editor
    .getByRole("combobox", { name: "认证方式", exact: true })
    .selectOption("bearer");
  await editor
    .getByLabel("Bearer Token", { exact: true })
    .fill("ui-private-synthetic-token");
  await editor.getByRole("button", { name: "添加请求头", exact: true }).click();
  await editor.getByLabel("请求头名称 1", { exact: true }).fill("X-Api-Key");
  await editor
    .getByLabel("请求头私密值 1", { exact: true })
    .fill("ui-private-synthetic-header");
  for (const width of [1440, 390])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.emulateMedia({ colorScheme: theme });
      assert.ok(
        await editor.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page.screenshot({
        path: join(output, `connector-${width}-${theme}.png`),
      });
      checks.push(`connector ${width} ${theme}`);
    }
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  await editor.waitFor({ state: "hidden" });
  assert.equal(
    await settings.getByText("MCP_A · 项目连接", { exact: true }).isVisible(),
    true,
  );
  checks.push("name saved, internal identifier automatic");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await settings.getByRole("button", { name: "安全", exact: true }).click();
  assert.equal(
    await settings.getByText("单次提权检查", { exact: false }).count(),
    0,
  );
  assert.equal(
    await settings.getByText("执行策略", { exact: true }).count(),
    0,
  );
  checks.push("global security scope");
  await settings.getByRole("button", { name: "网关", exact: true }).click();
  await settings.getByRole("button", { name: "添加网关", exact: true }).click();
  const gateway = page.getByRole("dialog", { name: "添加网关", exact: true });
  await gateway.waitFor();
  assert.equal(
    await gateway.getByRole("button", { name: "取消", exact: true }).count(),
    0,
  );
  assert.equal(
    await gateway.getByRole("button", { name: "保存", exact: true }).count(),
    1,
  );
  assert.equal(
    await gateway.getByLabel("密钥保存方式", { exact: true }).count(),
    0,
  );
  checks.push("gateway save and close, persistent credentials");
  await page.screenshot({ path: join(output, "gateway-desktop.png") });
  await gateway.getByRole("button", { name: "关闭", exact: true }).click();
  await settings.getByRole("button", { name: "关闭", exact: true }).click();
  const cfg = (
    await context.request.get(origin + "/api/config?view=saved")
  ).json();
  const configuration = (await cfg).configuration;
  const connector = configuration.mcp.find(
    (m) => m.name === "MCP_A · 项目连接",
  );
  assert.ok(connector.privateFields.fields.every((f) => f.stored));
  assert.ok(!JSON.stringify(configuration).includes("ui-private-synthetic"));
  checks.push("connector credentials stored without public echo");
  const target = configuration.providers.find((p) => p.id === "fixture");
  const ticket = await context.request.post(
    origin + "/api/credentials/requests",
    {
      headers: { origin },
      data: {
        operation: "credential.fields.save",
        requestId: crypto.randomUUID(),
        scope: "provider",
        targetId: "fixture",
        expectedRevision: configuration.revisions["provider:fixture"],
        expectedFieldsRevision: target.privateFields.revision,
        fields: [{ kind: "bearer", name: "Authorization" }],
        clearValues: true,
      },
    },
  );
  assert.equal(ticket.status(), 200);
  const ticketId = (await ticket.json()).id;
  const empty = await context.request.post(
    origin + `/api/credentials/${ticketId}/input`,
    {
      headers: { origin, "Content-Type": "application/octet-stream" },
      data: Buffer.from("{}").toString("base64"),
    },
  );
  assert.equal((await empty.json()).state, "succeeded");
  if (
    await page
      .getByRole("button", { name: "展开侧栏", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  await page.getByRole("button", { name: /^新聊天/ }).click();
  await page.getByPlaceholder("询问任何问题").fill("需要私密授权的测试");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const card = page.getByRole("region", { name: "任务私密授权" });
  await card.waitFor();
  assert.equal(
    await page.getByText("上次发送等待确认", { exact: true }).count(),
    0,
  );
  for (const width of [1440, 390])
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      await page.emulateMedia({ colorScheme: theme });
      assert.ok(
        await card.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
      );
      await page.screenshot({
        path: join(output, `authorization-${width}-${theme}.png`),
      });
    }
  await page.reload();
  await card.waitFor();
  checks.push("authorization wait restored after refresh");
  await card
    .getByLabel("API Key / Token", { exact: true })
    .fill("ui-transient-private-marker");
  await card
    .getByRole("combobox", { name: "授权范围", exact: true })
    .selectOption("thread");
  await card.getByRole("button", { name: "授权并继续", exact: true }).click();
  await card.waitFor({ state: "hidden" });
  const calls = await context.request.get(origin + "/api/test/issue");
  assert.equal((await calls.json()).calls.length, 1);
  assert.ok(
    !JSON.stringify(
      await page.evaluate(() => ({ ...localStorage, ...sessionStorage })),
    ).includes("ui-transient-private-marker"),
  );
  checks.push(
    "private authorization dispatches once and never enters browser storage",
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "会话私密授权", exact: true }).click();
  const access = page.getByRole("dialog", {
    name: "会话私密授权",
    exact: true,
  });
  await access
    .getByLabel("接收方", { exact: true })
    .selectOption("provider:fixture");
  await access.getByRole("button", { name: "更新授权", exact: true }).click();
  await access
    .getByLabel("API Key / Token", { exact: true })
    .fill("ui-transient-second-marker");
  await access.getByRole("button", { name: "保存授权", exact: true }).click();
  await access.getByText("会话授权已更新。", { exact: true }).waitFor();
  assert.equal(
    (await (await context.request.get(origin + "/api/test/issue")).json()).calls
      .length,
    1,
  );
  await access
    .getByRole("button", { name: "撤销会话授权", exact: true })
    .click();
  await access.getByText("会话授权已撤销。", { exact: true }).waitFor();
  await access.getByRole("button", { name: "关闭", exact: true }).click();
  checks.push("manual authorization and revocation do not replay a model turn");
  const loading = await context.newPage();
  let unlock;
  const hold = new Promise((r) => (unlock = r));
  await loading.route(/\/api\/config\?view=saved$/, async (route) => {
    await hold;
    await route.continue();
  });
  await loading.goto(origin);
  await loading
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: "扩展", exact: true })
    .click();
  await loading.getByRole("tab", { name: "连接器", exact: true }).click();
  const add = loading.getByRole("button", { name: "添加连接器", exact: true });
  assert.equal(await add.isDisabled(), true);
  unlock();
  await loading.waitForFunction(
    () => !document.querySelector('[aria-label="添加连接器"]')?.disabled,
  );
  await add.click();
  await loading
    .getByRole("dialog", { name: "添加连接器", exact: true })
    .waitFor();
  await loading.close();
  checks.push(
    "add connector waits for configuration instead of ignoring early clicks",
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify({ checks, errors, synthetic: true }, null, 2),
  );
  console.log(JSON.stringify({ checks, errors }));
} catch (error) {
  if (page)
    await page
      .screenshot({ path: join(output, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await exited;
}
