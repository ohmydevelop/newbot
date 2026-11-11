// Optional browser regression. Use a locally installed Playwright or set PLAYWRIGHT_MODULE.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/artifact-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const name of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, name), { force: true });
const port = Number(process.env.ARTIFACT_TEST_PORT || 3102);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "tests/artifact-preview-server.ts"],
  {
    env: { ...process.env, NODE_ENV: "test", ARTIFACT_TEST_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const exited = new Promise((resolve) => server.once("exit", resolve));
let log = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Browser fixture did not start")),
    15000,
  );
  const collect = (data) => {
    log += data.toString();
    if (log.includes("Artifact UI fixture ready:")) {
      clearTimeout(timer);
      resolve();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`Browser fixture exited ${code}: ${log}`));
  });
});
let browser;
let page;
const checks = [];
const errors = [];
async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
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
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
    acceptDownloads: true,
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  let externalRequests = 0;
  page.on("request", (req) => {
    if (
      /^https?:/.test(req.url()) &&
      !req.url().startsWith(origin + "/") &&
      !req.url().startsWith(`http://localhost:${port}/`)
    )
      externalRequests++;
  });
  const dialog = () => page.getByRole("dialog");
  const open = async (name) => {
    await page
      .getByRole("button", { name: `查看 ${name}，版本 1`, exact: true })
      .click();
    await dialog().waitFor();
    await dialog().locator(".artifact-preview-body[aria-busy=false]").waitFor();
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await dialog().waitFor({ state: "hidden" });
  };
  await page.route("**/api/config", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue().catch(() => {});
  });
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("artifact-ui-test-password");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByPlaceholder("询问任何问题").fill("创建用于测试的文件");
  await check("sending waits for model configuration", async () => {
    assert.equal(
      await page
        .getByRole("button", { name: "发送消息", exact: true })
        .isDisabled(),
      true,
    );
  });
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page
    .getByRole("button", { name: "查看 summary.md，版本 1", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "查看 pixel.png，版本 1", exact: true })
    .waitFor();
  await check("file cards from native events", async () => {
    assert.equal(await page.locator(".artifact-card").count(), 9);
  });
  await check(
    "Markdown preview/source, inert HTML and explicit focus restoration",
    async () => {
      await open("summary.md");
      await dialog().getByRole("heading", { name: "项目交付说明" }).waitFor();
      assert.equal(await dialog().locator("img").count(), 0);
      assert.equal(
        await page.evaluate(() => globalThis.ARTIFACT_XSS),
        undefined,
      );
      await page.screenshot({
        animations: "disabled",
        path: `${output}/markdown-desktop.png`,
      });
      await dialog().getByRole("button", { name: "源码", exact: true }).click();
      assert.ok(
        (await dialog().locator(".code-block").textContent()).includes(
          "# 项目交付说明",
        ),
      );
      await close();
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "查看 summary.md，版本 1",
      );
    },
  );
  await check("keyboard focus remains inside the preview", async () => {
    await open("summary.md");
    for (let n = 0; n < 10; n++) {
      await page.keyboard.press("Tab");
      assert.equal(
        await page.evaluate(
          () => !!document.activeElement?.closest('[role="dialog"]'),
        ),
        true,
      );
    }
    await page.keyboard.press("Shift+Tab");
    assert.equal(
      await page.evaluate(
        () => !!document.activeElement?.closest('[role="dialog"]'),
      ),
      true,
    );
    await close();
  });
  await check("code syntax highlighting", async () => {
    await open("example.ts");
    await dialog().locator("pre.shiki").waitFor();
    assert.ok(
      (await dialog().locator("pre").textContent()).includes(
        "export function greet",
      ),
    );
    await close();
  });
  await check("JSON formatting and byte-preserving download", async () => {
    await open("report.json");
    assert.match(await dialog().locator("pre").textContent(), /"version": 1/);
    const event = page.waitForEvent("download");
    await dialog()
      .getByRole("button", { name: "下载 report.json", exact: true })
      .click();
    const download = await event;
    assert.equal(download.suggestedFilename(), "report.json");
    await download.saveAs(`${output}/report.json`);
    assert.equal(
      JSON.parse(readFileSync(`${output}/report.json`, "utf8")).version,
      1,
    );
    await close();
  });
  await check("download failures are visible and retryable", async () => {
    await open("report.json");
    const pattern = "**/api/artifacts/*/download";
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "测试下载失败" }),
      }),
    );
    await dialog()
      .getByRole("button", { name: "下载 report.json", exact: true })
      .click();
    await dialog().getByRole("alert").getByText("测试下载失败").waitFor();
    await page.unroute(pattern);
    const event = page.waitForEvent("download");
    await dialog()
      .getByRole("button", { name: "下载 report.json", exact: true })
      .click();
    assert.equal((await event).suggestedFilename(), "report.json");
    await close();
  });
  await check("CSV table with multiline and quoted cells", async () => {
    await open("metrics.csv");
    assert.equal(
      await dialog()
        .getByRole("cell", { name: "data, api", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await dialog()
        .getByRole("cell", { name: "多行备注 第二行", exact: true })
        .count(),
      1,
    );
    await page.screenshot({
      animations: "disabled",
      path: `${output}/csv-desktop.png`,
    });
    await close();
  });
  await check("HTML source never executes at the main origin", async () => {
    await open("page.html");
    await dialog().getByRole("button", { name: "源码", exact: true }).click();
    await dialog().locator("pre").waitFor();
    assert.ok(
      (await dialog().locator("pre").textContent()).includes("<script>"),
    );
    assert.equal(await dialog().locator("iframe").count(), 0);
    assert.equal(await page.evaluate(() => globalThis.ARTIFACT_XSS), undefined);
    await close();
  });
  await check("empty, invalid JSON and large preview feedback", async () => {
    await open("empty.txt");
    await dialog().getByText("文件为空。", { exact: true }).waitFor();
    await close();
    await open("broken.json");
    await dialog()
      .getByText("JSON 格式无效，已显示原始内容。", { exact: true })
      .waitFor();
    await close();
    await open("large.txt");
    await dialog()
      .getByText("仅显示部分内容，下载可查看完整文件。", { exact: true })
      .waitFor();
    assert.equal((await dialog().locator("pre").textContent()).length, 64000);
    await close();
  });
  await check("authenticated image decoding", async () => {
    await open("pixel.png");
    const image = dialog().getByRole("img", { name: "pixel.png" });
    await image.waitFor();
    await image.evaluate((img) => img.decode());
    assert.equal(await image.evaluate((img) => img.naturalWidth), 1);
    await close();
  });
  await check("content failure, visible retry and recovery", async () => {
    const items = await page.evaluate(async () => {
      const threads = await (await fetch("/api/threads")).json();
      return (
        await (await fetch(`/api/threads/${threads[0].id}/artifacts`)).json()
      ).artifacts;
    });
    const artifact = items.find((a) => a.name === "example.ts");
    const pattern = `${origin}/api/artifacts/${artifact.id}/content`;
    await page.route(pattern, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "测试读取失败" }),
      }),
    );
    await open("example.ts");
    await dialog().getByRole("alert").getByText("测试读取失败").waitFor();
    await page.unroute(pattern);
    await dialog()
      .getByRole("button", { name: "重新读取", exact: true })
      .click();
    await dialog().locator("pre.shiki").waitFor();
    await close();
  });
  await check("closing a loading preview cancels stale content", async () => {
    const pattern = "**/api/artifacts/*/content";
    await page.route(pattern, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.continue().catch(() => {});
    });
    await page
      .getByRole("button", { name: "查看 example.ts，版本 1", exact: true })
      .click();
    await dialog().getByText("正在读取文件…", { exact: true }).waitFor();
    await close();
    await page.unroute(pattern);
    await open("report.json");
    assert.match(await dialog().locator("pre").textContent(), /"version": 1/);
    assert.ok(
      !(await dialog().locator("pre").textContent()).includes(
        "export function",
      ),
    );
    await close();
  });
  await check(
    "workspace listing failure, retry, file selection and registration",
    async () => {
      const pattern = "**/api/workspace/files?*";
      await page.route(pattern, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试目录读取失败" }),
        }),
      );
      await page.getByRole("button", { name: "添加附件", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "添加工作区文件", exact: true })
        .click();
      await dialog().getByRole("alert").getByText("测试目录读取失败").waitFor();
      await page.unroute(pattern);
      await dialog()
        .getByRole("button", { name: "刷新文件列表", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "notes", exact: true })
        .waitFor();
      assert.equal(
        await dialog().getByText(".env", { exact: true }).count(),
        0,
      );
      await dialog()
        .getByRole("button", { name: "notes", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "manual.txt", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "添加到本轮对话", exact: true })
        .click();
      await dialog().waitFor({ state: "hidden" });
      await open("manual.txt");
      assert.match(await dialog().locator("pre").textContent(), /手动添加/);
      await close();
    },
  );
  await check(
    "refresh restores cards and immutable versions after workspace changes",
    async () => {
      await page.getByPlaceholder("询问任何问题").fill("修改文件");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await page
        .getByRole("button", { name: "查看 report.json，版本 2", exact: true })
        .waitFor();
      await page.reload();
      await page
        .getByRole("button", { name: "查看 report.json，版本 2", exact: true })
        .waitFor();
      await open("report.json");
      assert.match(await dialog().locator("pre").textContent(), /"version": 1/);
      await close();
      assert.equal(
        await page
          .getByRole("button", { name: "查看 manual.txt，版本 1", exact: true })
          .count(),
        1,
      );
    },
  );
  await check("dark theme", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await open("summary.md");
    await page.screenshot({
      animations: "disabled",
      path: `${output}/markdown-dark.png`,
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.dataset.theme),
      "dark",
    );
    await close();
  });
  await check("375px mobile layout and touch controls", async () => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
    await open("metrics.csv");
    const dimensions = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
      dialog: document
        .querySelector("[role=dialog]")
        .getBoundingClientRect()
        .toJSON(),
    }));
    assert.ok(dimensions.scroll <= dimensions.width);
    assert.ok(dimensions.dialog.x >= 0 && dimensions.dialog.right <= 375);
    for (const button of await dialog().locator("button").all()) {
      const box = await button.boundingBox();
      if (box)
        assert.ok(box.height >= 44, `Touch target is only ${box.height}px`);
    }
    await page.screenshot({
      animations: "disabled",
      path: `${output}/csv-mobile.png`,
    });
    await close();
    await page.getByRole("button", { name: "添加附件", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "添加工作区文件", exact: true })
      .click();
    await dialog()
      .getByRole("button", { name: "notes", exact: true })
      .waitFor();
    await page.screenshot({
      animations: "disabled",
      path: `${output}/workspace-mobile.png`,
    });
    await close();
  });
  await check("landscape modal stays inside the viewport", async () => {
    await page.setViewportSize({ width: 812, height: 375 });
    await open("report.json");
    const box = await dialog().boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= 375);
    await close();
    await page.getByRole("button", { name: "添加附件", exact: true }).click();
    await page
      .getByRole("menuitem", { name: "添加工作区文件", exact: true })
      .click();
    await dialog()
      .getByRole("button", { name: "notes", exact: true })
      .waitFor();
    const footer = await dialog()
      .getByRole("button", { name: "添加到本轮对话", exact: true })
      .boundingBox();
    assert.ok(footer.y >= 0 && footer.y + footer.height <= 375);
    await close();
  });
  await check("session expiry during file reads returns to login", async () => {
    await page.route("**/api/artifacts/*/content", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "请先登录" }),
      }),
    );
    await page
      .getByRole("button", { name: "查看 example.ts，版本 1", exact: true })
      .click();
    await page.getByLabel("登录密码").waitFor();
    await page.unroute("**/api/artifacts/*/content");
  });
  assert.equal(
    externalRequests,
    0,
    "Artifact preview unexpectedly made external requests",
  );
  assert.deepEqual(errors, [], "Browser page errors");
  writeFileSync(
    `${output}/result.json`,
    JSON.stringify(
      {
        checks,
        pageErrors: errors,
        externalRequests,
        screenshots: [
          "markdown-desktop.png",
          "csv-desktop.png",
          "markdown-dark.png",
          "csv-mobile.png",
          "workspace-mobile.png",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    `Artifact UI regression: ${checks.length} checks passed. Evidence: ${output}`,
  );
} catch (e) {
  if (page)
    await page
      .screenshot({ animations: "disabled", path: `${output}/failure.png` })
      .catch(() => {});
  writeFileSync(
    `${output}/failure.json`,
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
