import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/artifact-lifecycle");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const name of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, name), { force: true });
const origin = "http://127.0.0.1:3102";
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "tests/artifact-preview-server.ts"],
  {
    env: { ...process.env, NODE_ENV: "test", ARTIFACT_LIFECYCLE_FIXTURE: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const exited = new Promise((resolve) => server.once("exit", resolve));
let log = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Fixture startup timeout")),
    15000,
  );
  const collect = (data) => {
    log += data;
    if (log.includes("Artifact UI fixture ready:")) {
      clearTimeout(timer);
      resolve();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`Fixture exited ${code}: ${log}`));
  });
});
let browser, page;
const checks = [],
  errors = [];
const check = async (name, fn) => {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
};
try {
  await ready;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
    colorScheme: "light",
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  const dialog = () => page.locator('[role="dialog"]:not(.sidebar)');
  const close = async () => {
    await dialog().getByRole("button", { name: "关闭", exact: true }).click();
    await dialog().waitFor({ state: "hidden" });
  };
  const control = async (action) => {
    const response = await context.request.post(
      `${origin}/api/test/lifecycle`,
      { headers: { origin }, data: { action } },
    );
    assert.equal(response.status(), 200);
  };
  const open = async (version = 1) => {
    await page
      .getByRole("button", {
        name: `查看 report.json，版本 ${version}`,
        exact: true,
      })
      .click();
    await dialog().locator(".artifact-preview-body[aria-busy=false]").waitFor();
    await dialog()
      .getByLabel("文件版本", { exact: true })
      .waitFor({ state: "visible" });
  };
  const storage = async () => {
    await page.getByRole("button", { name: "个人工作台 私有实例" }).click();
    await dialog()
      .getByRole("button", { name: "文件存储", exact: true })
      .click();
    await dialog()
      .getByRole("progressbar", { name: "文件存储使用量" })
      .waitFor();
  };
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("artifact-ui-test-password");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await check(
    "closing the browser page does not stop capture; reconnect restores the completed artifacts",
    async () => {
      await page.getByPlaceholder("询问任何问题").fill("创建持久文件");
      const response = page.waitForResponse((r) =>
        r.url().endsWith("/api/agent/run"),
      );
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      assert.equal((await response).status(), 200);
      await page.close();
      page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(origin);
      await page
        .getByRole("button", { name: "创建持久文件", exact: true })
        .click();
      await page
        .getByRole("button", { name: "查看 report.json，版本 1", exact: true })
        .waitFor();
    },
  );
  await check(
    "an open historical artifact stays on its saved version when a new version arrives",
    async () => {
      await open();
      assert.match(await dialog().locator("pre").textContent(), /"version": 1/);
      await control("revise-json");
      await dialog()
        .getByRole("button", { name: "刷新文件版本", exact: true })
        .click();
      await dialog()
        .getByLabel("文件版本", { exact: true })
        .getByRole("option", { name: /v2/ })
        .waitFor({ state: "attached" });
      assert.match(await dialog().locator("pre").textContent(), /"version": 1/);
      assert.equal(
        await dialog().getByLabel("文件版本", { exact: true }).inputValue(),
        await dialog()
          .getByLabel("文件版本", { exact: true })
          .getByRole("option", { name: /v1/ })
          .getAttribute("value"),
      );
    },
  );
  await check(
    "version switching replaces content and downloads exactly the selected snapshot",
    async () => {
      await dialog()
        .getByLabel("文件版本", { exact: true })
        .selectOption({ label: "v2 · 最新" });
      await dialog()
        .locator(".artifact-preview-body[aria-busy=false]")
        .waitFor();
      assert.match(await dialog().locator("pre").textContent(), /"version": 2/);
      const event = page.waitForEvent("download");
      await dialog()
        .getByRole("button", { name: "下载 report.json", exact: true })
        .click();
      const download = await event;
      await download.saveAs(resolve(output, "selected.json"));
      assert.equal(
        JSON.parse(readFileSync(resolve(output, "selected.json"), "utf8"))
          .version,
        2,
      );
      await page.screenshot({
        animations: "disabled",
        path: resolve(output, "versions-desktop.png"),
      });
      await close();
      assert.equal(
        await page
          .getByRole("button", {
            name: "查看 report.json，版本 2",
            exact: true,
          })
          .count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("button", {
            name: "查看 report.json，版本 1",
            exact: true,
          })
          .count(),
        0,
      );
    },
  );
  await check(
    "refresh preserves grouped history and lets users return to the earlier version",
    async () => {
      await page.reload();
      await open(2);
      await dialog()
        .getByLabel("文件版本", { exact: true })
        .selectOption({ label: "v1" });
      await dialog()
        .locator(".artifact-preview-body[aria-busy=false]")
        .waitFor();
      assert.match(await dialog().locator("pre").textContent(), /"version": 1/);
      await close();
    },
  );
  await check(
    "version list failure does not hide the current file and can be retried",
    async () => {
      await page.route("**/api/artifacts/*/versions", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试版本不可用" }),
        }),
      );
      await open(2);
      await dialog()
        .getByRole("alert")
        .getByText("版本列表读取失败，可重试刷新。")
        .waitFor();
      assert.match(await dialog().locator("pre").textContent(), /"version": 2/);
      await page.unroute("**/api/artifacts/*/versions");
      await dialog()
        .getByRole("button", { name: "刷新文件版本", exact: true })
        .click();
      await dialog()
        .getByLabel("文件版本", { exact: true })
        .getByRole("option", { name: /v1/ })
        .waitFor({ state: "attached" });
      await close();
    },
  );
  await check(
    "HTML version switching revokes the previous runtime and loads the selected snapshot",
    async () => {
      await page
        .getByRole("button", { name: "查看 page.html，版本 1", exact: true })
        .click();
      await dialog().locator(".html-preview[aria-busy=false] iframe").waitFor();
      const old = page
        .frames()
        .find((f) => f.url().includes("/artifact-content/"))
        .url();
      await control("revise-html");
      await dialog()
        .getByRole("button", { name: "刷新文件版本", exact: true })
        .click();
      await dialog()
        .getByLabel("文件版本", { exact: true })
        .getByRole("option", { name: /v2/ })
        .waitFor({ state: "attached" });
      const revoked = page.waitForResponse(
        (r) =>
          r.request().method() === "DELETE" &&
          r.url().includes(old.split("/").pop()),
      );
      await dialog()
        .getByLabel("文件版本", { exact: true })
        .selectOption({ label: "v2 · 最新" });
      await revoked;
      const inside = page
        .frameLocator('iframe[title="page.html 隔离预览"]')
        .frameLocator('iframe[title="HTML page"]');
      await inside
        .getByRole("heading", { name: "HTML version two", exact: true })
        .waitFor();
      assert.equal((await context.request.get(old)).status(), 410);
      await close();
    },
  );
  await check(
    "storage usage and cleanup report orphan reservations without removing referenced files",
    async () => {
      await storage();
      await page.screenshot({
        animations: "disabled",
        path: resolve(output, "storage-desktop.png"),
      });
      await dialog()
        .getByRole("button", { name: "清理未使用文件", exact: true })
        .click();
      await dialog()
        .getByRole("status")
        .getByText(/已清理 1 项/)
        .waitFor();
      assert.equal(
        await dialog()
          .getByRole("button", { name: "清理未使用文件", exact: true })
          .isDisabled(),
        true,
      );
      await close();
      await open(2);
      assert.match(await dialog().locator("pre").textContent(), /"version": 2/);
      await close();
    },
  );
  await check(
    "missing snapshots retain metadata and recover by restoring the exact snapshot",
    async () => {
      await control("hide-snapshot");
      await open(2);
      await dialog()
        .getByLabel("文件版本", { exact: true })
        .selectOption({ label: "v1" });
      await dialog()
        .getByRole("alert")
        .getByText(/文件快照缺失/)
        .waitFor();
      await control("restore-snapshot");
      await dialog()
        .getByRole("button", { name: "重新读取", exact: true })
        .click();
      await dialog().locator("pre").waitFor();
      assert.match(await dialog().locator("pre").textContent(), /"version": 1/);
      await close();
    },
  );
  await check(
    "storage read failures offer a visible refresh action",
    async () => {
      await page.route("**/api/storage", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试存储暂不可用" }),
        }),
      );
      await page.getByRole("button", { name: "个人工作台 私有实例" }).click();
      await dialog()
        .getByRole("button", { name: "文件存储", exact: true })
        .click();
      await dialog().getByRole("alert").getByText("测试存储暂不可用").waitFor();
      await page.unroute("**/api/storage");
      await dialog()
        .getByRole("button", { name: "刷新存储用量", exact: true })
        .click();
      await dialog().getByRole("progressbar").waitFor();
      await close();
    },
  );
  await check(
    "version and storage controls remain readable in dark mode",
    async () => {
      await page.emulateMedia({ colorScheme: "dark" });
      await open(2);
      await page.screenshot({
        animations: "disabled",
        path: resolve(output, "versions-dark.png"),
      });
      await close();
      await storage();
      await page.screenshot({
        animations: "disabled",
        path: resolve(output, "storage-dark.png"),
      });
      assert.equal(
        await page.evaluate(() => document.documentElement.dataset.theme),
        "dark",
      );
      await close();
      await page.emulateMedia({ colorScheme: "light" });
    },
  );
  await check(
    "375px version controls and storage settings remain within the viewport",
    async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.reload();
      await open(2);
      await page.screenshot({
        animations: "disabled",
        path: resolve(output, "versions-mobile.png"),
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await close();
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
      await storage();
      await page.screenshot({
        animations: "disabled",
        path: resolve(output, "storage-mobile.png"),
      });
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await close();
    },
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify({ checks, pageErrors: errors }, null, 2),
  );
  console.log(
    `Artifact lifecycle: ${checks.length} checks passed. Evidence: ${output}`,
  );
} catch (e) {
  if (page)
    await page
      .screenshot({
        animations: "disabled",
        path: resolve(output, "failure.png"),
      })
      .catch(() => {});
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify(
      { error: String(e), checks, pageErrors: errors, fixtureLog: log },
      null,
      2,
    ),
  );
  throw e;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await exited;
}
