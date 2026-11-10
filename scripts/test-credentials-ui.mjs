import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/credentials-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const name of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, name), { force: true });
const port = Number(process.env.CREDENTIALS_TEST_PORT || 3126),
  origin = `http://127.0.0.1:${port}`;
const secret = "credential-fixture-private-value-ONLY-TEST";
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/credentials-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "development",
      CREDENTIALS_TEST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "",
  browser,
  page;
const exited = new Promise((r) => server.once("exit", r));
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Fixture startup timeout")),
    15000,
  );
  const collect = (data) => {
    log += data.toString();
    if (log.includes("Credentials UI fixture ready")) {
      clearTimeout(timer);
      resolve();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", () => {
    clearTimeout(timer);
    reject(new Error("Fixture exited before ready"));
  });
});
const checks = [],
  errors = [],
  external = [],
  apiResponses = [],
  inputRequests = [];
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
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith(origin + "/"))
      external.push(r.url());
    if (/\/api\/credentials\/[^/]+\/input$/.test(r.url()))
      inputRequests.push({
        url: r.url(),
        method: r.method(),
        binary: r.headers()["content-type"] === "application/octet-stream",
        expected: r.postData() === secret,
      });
  });
  page.on("response", async (r) => {
    if (
      r.url().startsWith(origin + "/api/") &&
      r.headers()["content-type"]?.includes("json")
    )
      apiResponses.push(await r.text().catch(() => ""));
  });
  const control = async (action) =>
    (
      await context.request.post(origin + "/api/test/private", {
        headers: { origin },
        data: { action },
      })
    ).json();
  const modal = () =>
    page.getByRole("dialog", { name: "临时验证 API Key", exact: true });
  const key = () => modal().getByLabel("临时 API Key", { exact: true });
  const submit = () =>
    modal().getByRole("button", { name: "仅验证一次", exact: true });
  const open = async () => {
    await page
      .getByRole("button", { name: "临时验证 secondary 的凭证", exact: true })
      .click();
    await key().waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector('.credential-modal input[type="password"]')
          ?.disabled,
    );
  };
  const close = async () => {
    await modal().getByRole("button", { name: "关闭", exact: true }).click();
    await modal().waitFor({ state: "hidden" });
  };
  const screenshot = (name) =>
    page.screenshot({
      path: resolve(output, name + ".png"),
      animations: "disabled",
    });
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("private-fixture-password");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByPlaceholder("询问任何问题").waitFor();
  await page.getByRole("button", { name: "个人工作台 私有实例" }).click();
  await page
    .getByRole("dialog", { name: "设置", exact: true })
    .getByRole("button", { name: "模型与 Provider", exact: true })
    .click();
  await check(
    "only eligible configured HTTPS providers expose temporary credential verification",
    async () => {
      await page
        .getByRole("button", { name: "临时验证 secondary 的凭证", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "临时验证 fixture 的凭证", exact: true })
          .count(),
        0,
      );
    },
  );
  await check(
    "trusted dialog shows fixed recipient and operation and focuses a masked ordinary DOM input",
    async () => {
      await open();
      assert.match(
        await modal().locator("code").textContent(),
        /^https:\/\/127\.0\.0\.1:\d+$/,
      );
      assert.equal(await key().getAttribute("type"), "password");
      assert.equal(
        await key().evaluate((el) => document.activeElement === el),
        true,
      );
      assert.equal(await modal().locator("iframe").count(), 0);
      await screenshot("private-desktop");
    },
  );
  await check(
    "real TLS consumer uses one key while browser clears it and receives only fixed completion",
    async () => {
      await key().fill(secret);
      await submit().click();
      await modal()
        .getByText(
          "端点已响应。凭证是否被校验由上游决定，尚未验证模型或工具兼容性。",
          { exact: true },
        )
        .waitFor();
      assert.equal(await key().inputValue(), "");
      assert.equal(await key().isDisabled(), true);
      assert.equal(await submit().isDisabled(), true);
      const stats = await control("inspect");
      assert.equal(stats.calls.length, 1);
      assert.deepEqual(stats.calls[0], {
        correct: true,
        method: "GET",
        path: "/v1/models",
        cookie: false,
        extraHeaders: false,
      });
      assert.deepEqual(
        inputRequests.map((r) => [r.method, r.binary, r.expected]),
        [["POST", true, true]],
      );
    },
  );
  await check(
    "ticket reads and repeated input cannot replay the consumed operation",
    async () => {
      const first = inputRequests[0];
      const repeat = await context.request.post(first.url, {
        headers: { origin, "content-type": "application/octet-stream" },
        data: secret,
      });
      assert.equal(repeat.status(), 409);
      await modal()
        .getByRole("button", { name: "读取状态", exact: true })
        .click();
      assert.equal((await control("inspect")).calls.length, 1);
      await close();
    },
  );
  await check(
    "cancel clears the field without sending the key or contacting the provider",
    async () => {
      await open();
      await key().fill(secret);
      const before = inputRequests.length;
      await modal()
        .getByRole("button", { name: "取消本次请求", exact: true })
        .click();
      await modal()
        .getByText("已取消；已经发送的请求无法撤回。", { exact: true })
        .waitFor();
      assert.equal(await key().inputValue(), "");
      assert.equal(inputRequests.length, before);
      assert.equal((await control("inspect")).calls.length, 1);
      await close();
    },
  );
  await check(
    "Escape cancels a waiting ticket and restores focus to its opener",
    async () => {
      await open();
      await key().fill(secret);
      await page.keyboard.press("Escape");
      await modal().waitFor({ state: "hidden" });
      await page.waitForFunction(() =>
        document.activeElement?.textContent.includes("临时验证 secondary"),
      );
      await page.waitForTimeout(100);
      assert.equal((await control("inspect")).pending, 0);
    },
  );
  await check(
    "upstream reflection and redirect never reach browser results or a second recipient",
    async () => {
      await control("redirect");
      await open();
      await key().fill(secret);
      await submit().click();
      await modal()
        .getByText("上游要求重定向，已停止发送。请检查服务端端点。", {
          exact: true,
        })
        .waitFor();
      assert.equal(await key().inputValue(), "");
      assert.equal((await control("inspect")).calls.length, 2);
      await close();
    },
  );
  await check(
    "changed configuration refuses dispatch without retaining the submitted key",
    async () => {
      await control("ok");
      await open();
      await control("change");
      await key().fill(secret);
      await submit().click();
      await modal()
        .getByText("配置已变化，凭证未发送。请重新读取配置后发起。", {
          exact: true,
        })
        .waitFor();
      assert.equal((await control("inspect")).calls.length, 2);
      assert.equal(await key().inputValue(), "");
      await close();
      await page
        .getByRole("dialog", { name: "设置", exact: true })
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await page.reload();
      await page.getByPlaceholder("询问任何问题").waitFor();
      await page.getByRole("button", { name: "个人工作台 私有实例" }).click();
      await page
        .getByRole("dialog", { name: "设置", exact: true })
        .getByRole("button", { name: "模型与 Provider", exact: true })
        .click();
    },
  );
  await check(
    "expired private request clears a populated field and cannot be submitted",
    async () => {
      await open();
      await key().fill(secret);
      await control("expire");
      await modal()
        .getByText("私密请求已过期，请重新发起。", { exact: true })
        .waitFor();
      assert.equal(await key().inputValue(), "");
      assert.equal(await submit().isDisabled(), true);
      await close();
    },
  );
  await check(
    "network loss clears the submitted key and retries only status without resending credentials",
    async () => {
      await open();
      await page.route("**/api/credentials/*/input", (route) =>
        route.abort("failed"),
      );
      await key().fill(secret);
      const before = inputRequests.length;
      await submit().click();
      await modal()
        .getByText("发送结果未确认，请读取状态；不会自动重发凭证。", {
          exact: true,
        })
        .waitFor();
      assert.equal(await key().inputValue(), "");
      await page.unroute("**/api/credentials/*/input");
      await modal()
        .getByRole("button", { name: "读取状态", exact: true })
        .click();
      assert.equal(inputRequests.length, before + 1);
      assert.equal((await control("inspect")).calls.length, 2);
      await close();
    },
  );
  await check(
    "mobile dark dialog has no horizontal overflow and remains keyboard operable",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: "dark" });
      await open();
      assert.equal(
        await key().evaluate((el) => document.activeElement === el),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.ok((await submit().boundingBox()).height >= 44);
      await screenshot("private-mobile-dark");
      await close();
    },
  );
  await check(
    "secret stays absent from storage, model calls, DB, app results, logs and browser errors",
    async () => {
      const stats = await control("inspect");
      assert.equal(stats.nativeSecretSeen, false);
      assert.equal(stats.dbSecretSeen, false);
      assert.equal(stats.modelTurns, 0);
      assert.equal(
        await page.evaluate(
          (value) =>
            JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
              value,
            ),
          secret,
        ),
        false,
      );
      assert.ok(!apiResponses.join("").includes(secret));
      assert.ok(!log.includes(secret));
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    },
  );
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        checks,
        pageErrors: errors,
        externalRequests: external,
        inputRequests: inputRequests.length,
        modelTurns: 0,
        secretScanPassed: true,
      },
      null,
      2,
    ),
  );
  console.log(`${checks.length} credential browser checks passed`);
} catch (error) {
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify(
      {
        checks,
        error: String(error).replaceAll(secret, "[redacted]"),
        pageErrors: errors.map((v) => v.replaceAll(secret, "[redacted]")),
        logTail: log.slice(-1200).replaceAll(secret, "[redacted]"),
      },
      null,
      2,
    ),
  );
  if (page) {
    await page
      .locator('input[type="password"]')
      .evaluateAll((elements) => elements.forEach((el) => (el.value = "")))
      .catch(() => {});
    await page
      .screenshot({ path: resolve(output, "failure.png") })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await exited;
}
