import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    "/home/a/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs"
);
const output = resolve(".issue/2026-11-10/evidence-issue-06/S2");
mkdirSync(output, { recursive: true });
const origin = "http://127.0.0.1:3162";
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/issue-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_TRANSPORT: "poll",
      ISSUE_TEST_PORT: "3162",
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
  await editor.getByRole("button", { name: "连接方式", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "远程服务", exact: true })
    .click();
  await editor
    .getByRole("textbox", { name: "服务地址", exact: true })
    .fill("https://connector.example/mcp");
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
