import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/credential-isolation-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const name of ["result.json", "failure.json"])
  rmSync(resolve(output, name), { force: true });
const port = Number(process.env.CREDENTIAL_ISOLATION_TEST_PORT || 3131),
  origin = `http://127.0.0.1:${port}`,
  secret = "credential-fixture-private-value-ONLY-TEST";
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/credential-isolation-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "development",
      AGENT_TRANSPORT: "poll",
      CREDENTIAL_ISOLATION_TEST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "",
  browser,
  page;
const exited = new Promise((r) => server.once("exit", r));
const ready = new Promise((res, rej) => {
  const timer = setTimeout(() => rej(new Error("Fixture timeout")), 15000);
  const collect = (d) => {
    log += d;
    if (log.includes("Isolation UI fixture ready")) {
      clearTimeout(timer);
      res();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", () => {
    clearTimeout(timer);
    rej(new Error("Fixture exited"));
  });
});
const checks = [],
  responses = [],
  errors = [];
let inputs = 0;
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log("PASS " + name);
}
try {
  await ready;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", async (r) => {
    if (
      r.url().startsWith(origin + "/api/") &&
      r.headers()["content-type"]?.includes("json")
    )
      responses.push(await r.text().catch(() => ""));
  });
  page.on("request", (r) => {
    if (/\/api\/credentials\/[^/]+\/input$/.test(r.url())) inputs++;
  });
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("private-fixture-password");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByPlaceholder("询问任何问题").waitFor();
  await check(
    "gateway private save consumes a key once; failed model discovery cannot echo it",
    async () => {
      await page.getByRole("button", { name: "个人工作台 私有实例" }).click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings
        .getByRole("button", { name: "网关", exact: true })
        .click();
      await settings
        .getByRole("button", { name: "编辑 备用 Provider", exact: true })
        .click();
      const editor = page.getByRole("dialog", {
        name: "备用 Provider",
        exact: true,
      });
      const input = editor.getByLabel("API Key", { exact: true });
      await input.fill(secret);
      await editor
        .getByRole("button", { name: "保存并获取模型", exact: true })
        .click();
      // The fixture's TLS endpoint intentionally returns reflected data, not a model
      // catalogue. Configuration is saved, but discovery must fail without echo.
      await editor
        .getByText(
          "网关已保存，模型列表未能获取。可手动填写模型，或重试获取。",
          {
            exact: false,
          },
        )
        .waitFor();
      assert.equal(await input.inputValue(), "");
      assert.ok(!(await editor.textContent()).includes(secret));
      await editor
        .getByRole("button", { name: "关闭", exact: true })
        .last()
        .click();
      await editor.waitFor({ state: "hidden" });
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
      assert.equal(inputs, 1);
    },
  );
  await check(
    "failed tool diagnostics remain hidden in actual poll events and visible chat",
    async () => {
      const text = page.getByPlaceholder("询问任何问题");
      await text.fill("Show the isolation fixture results.");
      await text.press("Enter");
      await page
        .getByRole("button", { name: "停止回答", exact: true })
        .waitFor();
      const result = await context.request.post(
        origin + "/api/test/isolation",
        { headers: { origin }, data: {} },
      );
      assert.equal((await result.json()).ready, true);
      const tool = page.getByText("调用工具 · failed_result", { exact: true });
      await tool.waitFor({ state: "attached" });
      const execution = page.locator(".process-group").filter({ has: tool }).locator("button.process-toggle");
      await execution.waitFor();
      if ((await execution.getAttribute("aria-expanded")) === "false")
        await execution.click();
      await page
        .getByText("调用工具 · failed_result", { exact: true })
        .waitFor();
      assert.ok(!(await page.locator("body").textContent()).includes(secret));
    },
  );
  await check(
    "successful structured tool content stays available beside the fixed failure message",
    async () => {
      await page.locator("summary").filter({ hasText: "safe_result" }).click();
      await page.getByText(/"count": 3/).waitFor();
      await page
        .locator("summary")
        .filter({ hasText: "failed_result" })
        .click();
      await page
        .locator(".tool-item.failed")
        .getByText("工具执行失败", { exact: true })
        .waitFor();
      assert.ok(!(await page.locator("body").textContent()).includes(secret));
      await page.screenshot({ path: resolve(output, "chat.png") });
    },
  );
  await check(
    "refresh restores sanitized history without submitting the credential again",
    async () => {
      await page.reload();
      const tool = page.getByText("调用工具 · failed_result", { exact: true });
      await tool.waitFor({ state: "attached" });
      const execution = page.locator(".process-group").filter({ has: tool }).locator("button.process-toggle");
      await execution.waitFor();
      if ((await execution.getAttribute("aria-expanded")) === "false")
        await execution.click();
      await page
        .getByText("调用工具 · failed_result", { exact: true })
        .waitFor();
      assert.equal(inputs, 1);
      assert.ok(!(await page.locator("body").textContent()).includes(secret));
    },
  );
  await check(
    "browser storage, API responses and logs contain no submitted or reflected credential",
    async () => {
      const storage = await page.evaluate(() =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
        }),
      );
      for (const value of [storage, log, ...responses])
        assert.ok(!value.includes(secret));
      assert.deepEqual(errors, []);
    },
  );
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      { checks, passed: checks.length, credentialInputs: inputs },
      null,
      2,
    ),
    { mode: 0o600 },
  );
} catch (error) {
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify({ checks, error: String(error) }, null, 2),
    { mode: 0o600 },
  );
  await page
    ?.screenshot({ path: resolve(output, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  if (server.exitCode === null) server.kill("SIGKILL");
}
