import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/sudo-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const file of ["result.json", "failure.json"])
  rmSync(resolve(output, file), { force: true });
const port = Number(process.env.SUDO_TEST_PORT || 3128),
  origin = `http://127.0.0.1:${port}`,
  secret = "test sudo 私密 password";
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/sudo-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "development",
      SUDO_TEST_PORT: String(port),
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
    if (log.includes("Sudo UI fixture ready")) {
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
  errors = [],
  responses = [],
  writes = [];
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
    if (/\/api\/credentials\/[^/]+\/input$/.test(r.url()))
      writes.push({
        binary: r.headers()["content-type"] === "application/octet-stream",
        correct: r.postDataBuffer()?.equals(Buffer.from(secret)),
      });
  });
  const control = async (action) =>
    (
      await context.request.post(origin + "/api/test/sudo", {
        headers: { origin },
        data: { action },
      })
    ).json();
  const modal = () =>
    page.getByRole("dialog", { name: "单次提权检查", exact: true });
  const field = () => modal().getByLabel("本机 sudo 密码", { exact: true });
  const submit = () =>
    modal().getByRole("button", { name: "授权单次检查", exact: true });
  const opener = () =>
    page.getByRole("button", { name: "发起单次提权检查", exact: true });
  const open = async () => {
    await opener().click();
    await field().waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector('.credential-modal input[type="password"]')
          ?.disabled,
    );
  };
  const close = async () => {
    await modal().getByRole("button", { name: "关闭", exact: true }).click();
    await modal().waitFor({ state: "hidden" });
    await page.waitForFunction(
      () => document.activeElement?.textContent === "发起单次提权检查",
    );
  };
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("sudo-ui-fixture-login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByPlaceholder("询问任何问题").waitFor();
  await page.getByRole("button", { name: "个人工作台 私有实例" }).click();
  await page
    .getByRole("dialog", { name: "设置", exact: true })
    .getByRole("button", { name: "安全与运行", exact: true })
    .click();
  await check(
    "fixed root identity operation and masked input have visible scope and keyboard focus",
    async () => {
      await open();
      assert.match(
        await modal().textContent(),
        /root 执行一次 \/usr\/bin\/id -u/,
      );
      assert.equal(await field().getAttribute("type"), "password");
      assert.equal(
        await field().evaluate((el) => document.activeElement === el),
        true,
      );
      await page.screenshot({ path: resolve(output, "desktop.png") });
    },
  );
  await check(
    "Unicode password is submitted once as binary and success never echoes process output",
    async () => {
      await field().fill(secret);
      await submit().click();
      await modal()
        .getByText("单次提权检查成功，执行身份为 root；密码已丢弃。", {
          exact: true,
        })
        .waitFor();
      assert.equal(await field().inputValue(), "");
      assert.equal(writes.length, 1);
      assert.deepEqual(writes[0], { binary: true, correct: true });
      assert.equal((await control("inspect")).launched, 1);
      await close();
      assert.equal(
        await opener().evaluate((el) => document.activeElement === el),
        true,
      );
    },
  );
  await check(
    "system NOPASSWD success explicitly reports input was not used or validated",
    async () => {
      await control("nopass");
      await open();
      await field().fill(secret);
      await submit().click();
      await modal()
        .getByText(
          "单次提权检查成功，系统未要求密码；输入未发送，也未验证密码。",
          { exact: true },
        )
        .waitFor();
      await close();
    },
  );
  await check(
    "reflected process content is discarded and failure offers no automatic retry",
    async () => {
      await control("echo");
      await open();
      await field().fill(secret);
      await submit().click();
      await modal()
        .getByText(
          "提权检查未完成，可能是密码、系统策略或执行环境不支持。不会自动重试。",
          { exact: true },
        )
        .waitFor();
      assert.equal(await field().inputValue(), "");
      assert.equal(await submit().isDisabled(), true);
      await close();
    },
  );
  await check(
    "cancel before sending clears input and starts no privileged process",
    async () => {
      const before = (await control("success")).launched;
      await open();
      await field().fill(secret);
      await modal()
        .getByRole("button", { name: "取消本次请求", exact: true })
        .click();
      await modal()
        .getByText("已取消；已经发送的请求无法撤回。", { exact: true })
        .waitFor();
      assert.equal(await field().inputValue(), "");
      assert.equal((await control("inspect")).launched, before);
      await close();
    },
  );
  await check(
    "expiry clears a populated password without submitting",
    async () => {
      await open();
      await field().fill(secret);
      await control("expire");
      await modal()
        .getByText("私密请求已过期，请重新发起。", { exact: true })
        .waitFor();
      assert.equal(await field().inputValue(), "");
      await close();
    },
  );
  await check(
    "timeout terminates an isolated consumer and leaves a final readable state",
    async () => {
      await control("hang");
      await open();
      await field().fill(secret);
      await submit().click();
      await modal()
        .getByText(
          "提权检查未完成，可能是密码、系统策略或执行环境不支持。不会自动重试。",
          { exact: true },
        )
        .waitFor();
      assert.equal((await control("inspect")).pending, 0);
      await close();
    },
  );
  await check(
    "network failure never resends a password when reading status",
    async () => {
      await control("success");
      await open();
      await page.route("**/api/credentials/*/input", (r) => r.abort("failed"));
      await field().fill(secret);
      const before = writes.length;
      await submit().click();
      await modal()
        .getByText("发送结果未确认，请读取状态；不会自动重发凭证。", {
          exact: true,
        })
        .waitFor();
      assert.equal(await field().inputValue(), "");
      await page.unroute("**/api/credentials/*/input");
      await modal()
        .getByRole("button", { name: "读取状态", exact: true })
        .click();
      await page.waitForTimeout(200);
      assert.equal(writes.length, before + 1);
      await close();
    },
  );
  await check(
    "small-screen dark dialog has no horizontal overflow and keyboard close restores opener",
    async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: "dark" });
      await open();
      await field().fill(secret);
      await page.screenshot({ path: resolve(output, "mobile-dark.png") });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.keyboard.press("Escape");
      await modal().waitFor({ state: "hidden" });
      await page.waitForFunction(
        () => document.activeElement?.textContent === "发起单次提权检查",
      );
      assert.equal(
        await opener().evaluate((el) => document.activeElement === el),
        true,
      );
      await open();
      assert.equal(await field().inputValue(), "");
      await close();
    },
  );
  await check(
    "stale server policy refuses execution and wipes the submitted password",
    async () => {
      await open();
      const before = (await control("change")).launched;
      await field().fill(secret);
      await submit().click();
      await modal()
        .getByText(
          "提权检查未完成，可能是密码、系统策略或执行环境不支持。不会自动重试。",
          { exact: true },
        )
        .waitFor();
      assert.equal((await control("inspect")).launched, before);
      assert.equal(await field().inputValue(), "");
      await close();
    },
  );
  await check(
    "API, native calls, database and browser storage contain no submitted password",
    async () => {
      const status = await control("inspect");
      assert.equal(status.nativeSecretSeen, false);
      assert.equal(status.dbSecretSeen, false);
      assert.equal(status.modelTurns, 0);
      const storage = await page.evaluate(() =>
        JSON.stringify({
          local: { ...localStorage },
          session: { ...sessionStorage },
        }),
      );
      for (const value of [storage, ...responses, log])
        assert.ok(!value.includes(secret));
      assert.deepEqual(errors, []);
    },
  );
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify({ checks, passed: checks.length, modelTurns: 0 }, null, 2),
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
