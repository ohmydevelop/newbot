import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createA2uiLab } from "./a2ui-lab.mjs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/a2ui-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const file of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, file), { force: true });
const app = await createA2uiLab(0);
const origin = app.listeningOrigin;
const checks = [],
  errors = [],
  external = [],
  mutations = [];
let browser, page;
async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
}
try {
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
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith(origin + "/")
    )
      external.push(request.url());
    if (request.method() !== "GET") mutations.push(request.method());
  });
  const content = page.getByRole("region", { name: "样例内容", exact: true });
  const select = async (id) => {
    await page.getByLabel("样例", { exact: true }).selectOption(id);
    await page
      .getByRole("status")
      .filter({ hasText: id === "incremental" ? "6 / 6" : "2 / 2" })
      .waitFor();
  };
  const action = async () =>
    JSON.parse(await page.getByTestId("actions").textContent());
  const screenshot = (name) =>
    page.screenshot({
      path: resolve(output, `${name}.png`),
      animations: "disabled",
    });
  const response = await page.goto(origin);
  await check(
    "official original text renders through the published React surface",
    async () => {
      await content
        .getByText("Hello, Minimal Catalog!", { exact: true })
        .waitFor();
      assert.equal(await page.getByLabel("协议兼容验证").inputValue(), "v0.9");
      assert.equal(await content.locator("iframe,script").count(), 0);
    },
  );
  await check(
    "official button emits only a local structured action",
    async () => {
      await select("button");
      await content
        .getByRole("button", { name: "Click Me", exact: true })
        .click();
      await page.getByTestId("actions").waitFor();
      const [result] = await action();
      assert.equal(result.name, "button_clicked");
      assert.equal(result.surfaceId, "gallery-interactive-button");
      assert.equal(result.sourceComponentId, "action_button");
      assert.deepEqual(result.context, {});
      assert.ok(Number.isFinite(Date.parse(result.timestamp)));
    },
  );
  await check(
    "official field updates its bound text without a model request",
    async () => {
      await select("binding");
      await content.getByRole("textbox").fill("本地测试 A2UI");
      await content
        .getByText("You typed: 本地测试 A2UI", { exact: true })
        .waitFor();
      await screenshot("binding-desktop");
    },
  );
  await check(
    "official incremental fixture resolves rows and action contexts",
    async () => {
      await select("incremental");
      await content.getByText("Spice Route", { exact: true }).waitFor();
      assert.equal(
        await content
          .getByRole("button", { name: "Book now", exact: true })
          .count(),
        4,
      );
      await content
        .getByRole("button", { name: "Book now", exact: true })
        .last()
        .click();
      await page.getByTestId("actions").waitFor();
      const [result] = await action();
      assert.equal(result.name, "book_now");
      assert.deepEqual(result.context, { restaurantName: "Spice Route" });
      await screenshot("incremental-desktop");
    },
  );
  await check(
    "deleteSurface removes rendered content and local actions",
    async () => {
      await page.getByRole("button", { name: "清空", exact: true }).click();
      await content.getByText("当前没有界面").waitFor();
      assert.equal(await page.getByTestId("actions").count(), 0);
      assert.equal(await content.getByRole("button").count(), 0);
    },
  );
  await check(
    "forward references and data updates render one message at a time",
    async () => {
      const next = page.getByRole("button", {
        name: "下一条消息",
        exact: true,
      });
      for (let count = 1; count <= 4; count++) {
        await next.click();
        await page
          .getByRole("status")
          .filter({ hasText: `${count} / 6` })
          .waitFor();
      }
      await content.getByText("The Golden Fork", { exact: true }).waitFor();
      assert.equal(
        await content.getByText("Spice Route", { exact: true }).count(),
        0,
      );
      await next.click();
      await content.getByText("Spice Route", { exact: true }).waitFor();
      assert.equal(await content.getByRole("button").count(), 0);
      await next.click();
      await content
        .getByRole("button", { name: "Book now", exact: true })
        .last()
        .waitFor();
      assert.equal(await next.isDisabled(), true);
    },
  );
  await check(
    "replay rebuilds the sample and discards edited local data",
    async () => {
      await select("binding");
      await content.getByRole("textbox").fill("discard-me");
      await page.getByRole("button", { name: "重放", exact: true }).click();
      await content.getByText("You typed:", { exact: true }).waitFor();
      assert.equal(await content.getByRole("textbox").inputValue(), "");
    },
  );
  await check(
    "v0.9.1 input compatibility preserves rendering and action association",
    async () => {
      await select("button");
      await page.getByLabel("协议兼容验证").selectOption("v0.9.1");
      await content
        .getByRole("button", { name: "Click Me", exact: true })
        .click();
      await page.getByTestId("actions").waitFor();
      assert.equal((await action())[0].surfaceId, "gallery-interactive-button");
    },
  );
  await check("host controls support keyboard focus", async () => {
    await page.getByLabel("样例", { exact: true }).focus();
    await page.keyboard.press("Tab");
    assert.equal(
      await page
        .getByLabel("协议兼容验证")
        .evaluate((el) => el === document.activeElement),
      true,
    );
  });
  await check("mobile sample and host controls fit the viewport", async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await select("binding");
    await content.getByRole("textbox").fill("手机测试");
    await content.getByText("You typed: 手机测试", { exact: true }).waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await screenshot("binding-mobile");
  });
  await check(
    "dark theme remains readable and contains no overflow",
    async () => {
      await page.emulateMedia({ colorScheme: "dark" });
      await select("incremental");
      await content.getByText("Spice Route", { exact: true }).waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await screenshot("incremental-mobile-dark");
    },
  );
  await check(
    "lab blocks network and execution and leaves product endpoints absent",
    async () => {
      assert.match(
        response.headers()["content-security-policy"],
        /connect-src 'none'/,
      );
      assert.equal(
        (
          await context.request.post(origin + "/api/agent/run", { data: {} })
        ).status(),
        404,
      );
      assert.equal(
        (await context.request.get(origin + "/api/config")).status(),
        404,
      );
      assert.deepEqual(external, []);
      assert.deepEqual(mutations, []);
      assert.deepEqual(errors, []);
      assert.equal(await page.getByRole("alert").count(), 0);
    },
  );
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        checks,
        pageErrors: errors,
        externalRequests: external,
        browserMutations: mutations,
      },
      null,
      2,
    ),
  );
  console.log(`${checks.length} A2UI browser checks passed`);
} catch (error) {
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify(
      { checks, error: String(error), pageErrors: errors },
      null,
      2,
    ),
  );
  if (page)
    await page
      .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await app.close();
}
