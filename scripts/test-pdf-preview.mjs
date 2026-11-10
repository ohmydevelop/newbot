// Isolated, real-browser PDF regression. Generate fixtures with create-pdf-fixtures.py first.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/pdf-preview");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const name of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, name), { force: true });
const port = Number(process.env.ARTIFACT_TEST_PORT || 3102);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "tests/artifact-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      ARTIFACT_PDF_FIXTURE: "1",
      ARTIFACT_TEST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const exited = new Promise((resolve) => server.once("exit", resolve));
let log = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("PDF fixture did not start")),
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
    reject(new Error(`Fixture exited ${code}: ${log}`));
  });
});
let browser, page;
const checks = [],
  errors = [],
  external = [],
  requests = [],
  ranges = [],
  consoles = [];
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
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") consoles.push(m.text());
  });
  page.on("request", (req) => {
    requests.push(req.url());
    if (/^https?:/.test(req.url()) && !req.url().startsWith(origin + "/"))
      external.push(req.url());
  });
  page.on("response", (res) => {
    if (/\/api\/artifacts\/[^/]+\/pdf$/.test(res.url()))
      ranges.push({
        url: res.url(),
        status: res.status(),
        headers: res.headers(),
        request: res.request().headers(),
      });
  });
  const dialog = () => page.getByRole("dialog");
  const open = async (name, version = 1) => {
    await page
      .getByRole("button", {
        name: `查看 ${name}，版本 ${version}`,
        exact: true,
      })
      .click();
    await dialog().waitFor();
  };
  const loaded = async (text) => {
    await dialog()
      .locator(".pdf-pages[aria-busy=false]")
      .waitFor({ timeout: 25000 });
    await dialog()
      .locator(".pdf-page-text pre")
      .filter({ hasText: text })
      .waitFor({ state: "attached", timeout: 15000 });
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await dialog().waitFor({ state: "hidden" });
  };
  const action = async () => {
    const response = await page.evaluate(async () => {
      const r = await fetch("/api/test/pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return r.status;
    });
    assert.equal(response, 200);
  };
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("artifact-ui-test-password");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByPlaceholder("询问任何问题").fill("创建测试 PDF");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page
    .getByRole("button", { name: "查看 preview.pdf，版本 1", exact: true })
    .waitFor();
  await check("PDF renderer and worker load only when opened", async () => {
    assert.equal(
      requests.some((url) => /PdfPreview-|pdf\.worker/.test(url)),
      false,
    );
    await open("preview.pdf");
    await loaded("PDF preview sample");
    assert.ok(requests.some((url) => /pdf\.worker\.min-.*\.mjs/.test(url)));
    assert.ok(
      requests.some((url) => /\.bcmap/.test(url)),
      "Chinese CMap should be served locally",
    );
    const worker = requests.find((url) => /pdf\.worker\.min-.*\.mjs/.test(url));
    const response = await context.request.get(worker, {
      headers: { "accept-encoding": "gzip" },
    });
    assert.match(
      response.headers()["content-security-policy"],
      /wasm-unsafe-eval/,
    );
    assert.match(response.headers()["content-type"], /javascript/);
    assert.match(response.headers()["content-encoding"], /gzip|br/);
  });
  await check("real canvas, Chinese text and inert PDF actions", async () => {
    const text = await dialog().locator(".pdf-page-text pre").textContent();
    assert.match(text, /中文预览/);
    const pixels = await dialog()
      .locator("canvas")
      .evaluate((canvas) => {
        const { data } = canvas
          .getContext("2d")
          .getImageData(0, 0, canvas.width, canvas.height);
        let dark = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i] < 180 && data[i + 1] < 180 && data[i + 2] < 180) dark++;
        return { dark, width: canvas.width, height: canvas.height };
      });
    assert.ok(pixels.dark > 1000);
    assert.ok(pixels.width * pixels.height <= 8_000_000);
    assert.equal(
      await dialog()
        .locator("iframe,a,input:not([aria-label='PDF 页码'])")
        .count(),
      0,
    );
    await dialog()
      .locator("canvas")
      .click({ position: { x: 100, y: 270 } });
    await page.screenshot({
      path: `${output}/pdf-desktop.png`,
      animations: "disabled",
    });
  });
  await check("pagination, page jump and landscape page", async () => {
    assert.equal(
      await dialog()
        .getByRole("button", { name: "上一页", exact: true })
        .isDisabled(),
      true,
    );
    await dialog().getByRole("button", { name: "下一页", exact: true }).click();
    await loaded("Page two");
    await page.screenshot({
      path: `${output}/pdf-table.png`,
      animations: "disabled",
    });
    await dialog().getByLabel("PDF 页码").fill("3");
    await dialog().getByLabel("PDF 页码").press("Enter");
    await loaded("Page three");
    await page.screenshot({
      path: `${output}/pdf-chart.png`,
      animations: "disabled",
    });
    const size = await dialog()
      .locator("canvas")
      .evaluate((c) => [c.width, c.height]);
    assert.ok(size[0] > size[1]);
    assert.equal(
      await dialog()
        .getByRole("button", { name: "下一页", exact: true })
        .isDisabled(),
      true,
    );
    await dialog().getByRole("button", { name: "上一页", exact: true }).click();
    await loaded("Page two");
  });
  await check("zoom and bounded canvas memory", async () => {
    const initial = await dialog()
      .locator("canvas")
      .evaluate((c) => c.width);
    await dialog().getByLabel("PDF 缩放").selectOption("1.5");
    await loaded("Page two");
    const size = await dialog()
      .locator("canvas")
      .evaluate((c) => [c.width, c.height]);
    assert.ok(size[0] > initial);
    assert.ok(size[0] * size[1] <= 8_000_000);
    assert.ok(size.every((n) => n <= 8192));
    await dialog().getByLabel("PDF 缩放").selectOption("1.25");
    await loaded("Page two");
    await dialog().getByLabel("PDF 缩放").selectOption("1");
    await loaded("Page two");
    await close();
  });
  await check("large PDF uses authenticated verified byte ranges", async () => {
    await open("range.pdf");
    await loaded("Range transport sample");
    assert.ok(
      requests.some((url) => /openjpeg-.*\.wasm/.test(url)),
      "JPX decoding uses the local WASM asset",
    );
    const colors = await dialog()
      .locator("canvas")
      .evaluate((canvas) => {
        const pixels = canvas
          .getContext("2d")
          .getImageData(
            Math.floor(canvas.width / 2),
            Math.floor(canvas.height * 0.55),
            32,
            32,
          ).data;
        const values = new Set();
        for (let i = 0; i < pixels.length; i += 4)
          values.add(`${pixels[i]},${pixels[i + 1]},${pixels[i + 2]}`);
        return values.size;
      });
    assert.ok(colors > 100, "The JPX raster must actually render");
    await page.screenshot({
      path: `${output}/pdf-jpx.png`,
      animations: "disabled",
    });
    const response = await page.evaluate(async () => {
      const t = await (await fetch("/api/threads")).json();
      return (await (await fetch(`/api/threads/${t[0].id}/artifacts`)).json())
        .artifacts;
    });
    const artifact = response.find((a) => a.name === "range.pdf");
    const reads = ranges.filter((r) => r.url.endsWith(`/${artifact.id}/pdf`));
    assert.ok(reads.length > 2);
    for (const read of reads) {
      assert.equal(read.status, 206);
      assert.match(read.headers["content-range"], /^bytes \d+-\d+\/\d+$/);
      assert.equal(read.request["if-range"], `"${artifact.sha256}"`);
    }
    const event = page.waitForEvent("download");
    await dialog()
      .getByRole("button", { name: "下载 range.pdf", exact: true })
      .click();
    const download = await event;
    await download.saveAs(`${output}/range-download.pdf`);
    assert.deepEqual(
      readFileSync(`${output}/range-download.pdf`),
      readFileSync(".data/pdf-fixtures/range.pdf"),
    );
    await close();
  });
  await check(
    "malformed, encrypted and excessive-page PDFs have clear feedback",
    async () => {
      for (const [name, message] of [
        ["broken.pdf", "PDF 无法读取"],
        ["password.pdf", "此 PDF 需要密码"],
        ["many-pages.pdf", "PDF 页数超过预览限制"],
      ]) {
        await open(name);
        await dialog()
          .getByRole("alert")
          .filter({ hasText: message })
          .waitFor({ timeout: 25000 });
        assert.equal(
          await dialog()
            .getByRole("button", { name: "重试预览", exact: true })
            .count(),
          1,
        );
        assert.equal(
          await dialog()
            .getByRole("button", { name: `下载 ${name}`, exact: true })
            .isEnabled(),
          true,
        );
        await close();
      }
    },
  );
  await check(
    "oversized workspace PDF is refused without creating a card",
    async () => {
      await page.getByRole("button", { name: "添加附件", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "添加工作区文件", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "oversized.pdf", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "添加到本轮对话", exact: true })
        .click();
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "文件超过 8 MiB" })
        .waitFor();
      await close();
      assert.equal(
        await page
          .getByRole("button", {
            name: "查看 oversized.pdf，版本 1",
            exact: true,
          })
          .count(),
        0,
      );
    },
  );
  await check(
    "range failures and inconsistent headers support retry",
    async () => {
      const pattern = "**/api/artifacts/*/pdf";
      await page.route(pattern, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试 PDF 读取失败" }),
        }),
      );
      await open("preview.pdf");
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "测试 PDF 读取失败" })
        .waitFor();
      await page.unroute(pattern);
      await page.route(pattern, (route) =>
        route.fulfill({
          status: 206,
          headers: { "content-range": "bytes 0-1/2", etag: '"incorrect"' },
          body: "xx",
        }),
      );
      await dialog()
        .getByRole("button", { name: "重试预览", exact: true })
        .click();
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "PDF 分段响应不一致" })
        .waitFor();
      await page.unroute(pattern);
      await dialog()
        .getByRole("button", { name: "重试预览", exact: true })
        .click();
      await loaded("PDF preview sample");
      await close();
    },
  );
  await check("closing an in-flight PDF leaves no stale renderer", async () => {
    const pattern = "**/api/artifacts/*/pdf";
    await page.route(pattern, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.continue().catch(() => {});
    });
    await open("range.pdf");
    await dialog().getByText("正在读取 PDF 页面…", { exact: true }).waitFor();
    await close();
    await page.unroute(pattern);
    await open("preview.pdf");
    await loaded("PDF preview sample");
    assert.equal(await dialog().locator("canvas").count(), 1);
    await close();
  });
  await check(
    "PDF versions remain distinct after switching and refresh",
    async () => {
      await action();
      await page
        .getByRole("button", { name: "查看 preview.pdf，版本 2", exact: true })
        .waitFor();
      await open("preview.pdf", 2);
      await loaded("PDF VERSION TWO");
      const options = await dialog()
        .getByLabel("文件版本", { exact: true })
        .locator("option")
        .allTextContents();
      assert.equal(options.length, 2);
      const old = await dialog()
        .getByLabel("文件版本", { exact: true })
        .locator("option")
        .filter({ hasText: "v1" })
        .getAttribute("value");
      await dialog().getByLabel("文件版本", { exact: true }).selectOption(old);
      await loaded("PDF preview sample");
      const event = page.waitForEvent("download");
      await dialog()
        .getByRole("button", { name: "下载 preview.pdf", exact: true })
        .click();
      await (await event).saveAs(`${output}/v1-download.pdf`);
      assert.deepEqual(
        readFileSync(`${output}/v1-download.pdf`),
        readFileSync(".data/pdf-fixtures/preview.pdf"),
      );
      await close();
      await page.reload();
      await open("preview.pdf", 2);
      await loaded("PDF VERSION TWO");
      await close();
    },
  );
  await check("dark theme and mobile portrait controls", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.reload();
    await open("preview.pdf", 2);
    await loaded("PDF VERSION TWO");
    const size = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(size.scroll <= size.width);
    for (const button of await dialog().locator("button").all()) {
      const box = await button.boundingBox();
      if (box) assert.ok(box.height >= 44);
    }
    await page.screenshot({
      path: `${output}/pdf-mobile-dark.png`,
      animations: "disabled",
    });
    await close();
  });
  await check(
    "mobile landscape keeps document and download reachable",
    async () => {
      await page.setViewportSize({ width: 812, height: 375 });
      await open("preview.pdf", 2);
      await loaded("PDF VERSION TWO");
      const documentArea = await dialog().locator(".pdf-pages").boundingBox();
      assert.ok(
        documentArea.height >= 140,
        "Landscape PDF needs usable page space",
      );
      const box = await dialog().boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 375);
      for (const control of [
        dialog().getByLabel("PDF 缩放"),
        dialog().getByRole("button", { name: "下载 preview.pdf", exact: true }),
      ]) {
        const rect = await control.boundingBox();
        assert.ok(rect.y >= 0 && rect.y + rect.height <= 375);
      }
      await page.screenshot({
        path: `${output}/pdf-landscape.png`,
        animations: "disabled",
      });
      await close();
    },
  );
  await check("session expiry during range read returns to login", async () => {
    await page.route("**/api/artifacts/*/pdf", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "请先登录" }),
      }),
    );
    await page
      .getByRole("button", { name: "查看 range.pdf，版本 1", exact: true })
      .click();
    await page.getByLabel("登录密码").waitFor();
  });
  assert.deepEqual(external, [], "PDF triggered external requests");
  assert.deepEqual(errors, [], "Browser page errors");
  writeFileSync(
    `${output}/result.json`,
    JSON.stringify(
      {
        checks,
        pageErrors: errors,
        externalRequests: external,
        ranges,
        consoleMessages: consoles,
        fixtureHash: createHash("sha256")
          .update(readFileSync(".data/pdf-fixtures/preview.pdf"))
          .digest("hex"),
      },
      null,
      2,
    ),
  );
  console.log(
    `PDF preview regression: ${checks.length} checks passed. Evidence: ${output}`,
  );
} catch (error) {
  await page
    ?.screenshot({ path: `${output}/failure.png`, animations: "disabled" })
    .catch(() => {});
  writeFileSync(
    `${output}/failure.json`,
    JSON.stringify(
      {
        error: String(error),
        checks,
        pageErrors: errors,
        consoleMessages: consoles,
        fixtureLog: log,
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await exited;
}
