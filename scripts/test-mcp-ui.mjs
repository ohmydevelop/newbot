// MCP Apps regression for the shared independent-origin HTTP headers.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "tests/preview.ts"],
  {
    env: { ...process.env, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const exited = new Promise((resolve) => server.once("exit", resolve));
let log = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("MCP fixture did not start")),
    15000,
  );
  const collect = (data) => {
    log += data;
    if (log.includes("Isolated browser fixture:")) {
      clearTimeout(timer);
      resolve();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`Fixture exit ${code}: ${log}`));
  });
});
let browser;
try {
  await ready;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:3101");
  await page.getByLabel("登录密码").fill("browser-test-password-only");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByPlaceholder("询问任何问题").fill("测试 MCP 应用");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  const app = page.frameLocator(".mcp-app iframe");
  await app.getByText("CPU: 25%", { exact: true }).waitFor();
  await app.getByRole("button", { name: "刷新数据", exact: true }).click();
  const approval = page.getByRole("dialog", { name: "允许这次操作？" });
  await approval
    .getByRole("button", { name: "仅允许这一次", exact: true })
    .click();
  await app.getByText(/工具交互成功/).waitFor();
  assert.deepEqual(errors, []);
  const output = resolve(".data/html-preview");
  mkdirSync(output, { recursive: true, mode: 0o700 });
  await page.screenshot({
    animations: "disabled",
    path: resolve(output, "mcp-regression.png"),
  });
  writeFileSync(
    resolve(output, "mcp-result.json"),
    JSON.stringify(
      {
        initialization: true,
        toolResult: true,
        approval: true,
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS MCP Apps SDK initialization, result and approved tool call under the shared HTTP sandbox",
  );
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await exited;
}
