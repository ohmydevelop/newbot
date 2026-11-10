import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const before = process.env.CONTROLS_PHASE === "before";
const output = resolve(
  process.env.UI_EVIDENCE_DIR || ".issue/2026-11-09/evidence-03",
);
mkdirSync(output, { recursive: true });
if (!before)
  for (const file of ["controls-result.json", "failure.json", "failure.png"])
    rmSync(resolve(output, file), { force: true });
const port = 3144,
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/issue-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_TRANSPORT: "poll",
      ISSUE_TEST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "",
  browser,
  page;
const errors = [],
  checks = [];
const ready = new Promise((done, reject) => {
  const timer = setTimeout(() => reject(Error(log)), 15000);
  const collect = (d) => {
    log += d;
    if (log.includes("Issue UI fixture ready")) {
      clearTimeout(timer);
      done();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", () => {
    clearTimeout(timer);
    reject(Error(log));
  });
});
async function check(name, run) {
  await run();
  checks.push(name);
  console.log("PASS " + name);
}
const menu = () => page.getByRole("menu").last();
const settings = () => page.getByRole("dialog", { name: "设置", exact: true });
async function closeMenu() {
  const current = menu();
  await page.keyboard.press("Escape");
  await current.waitFor({ state: "hidden" });
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-haspopup") === "menu",
  );
}
async function closeSettings() {
  await page.keyboard.press("Escape");
  await settings().waitFor({ state: "hidden" });
}
async function snapshot(name) {
  await page.screenshot({
    path: resolve(output, name + ".png"),
    animations: "disabled",
  });
}
async function inspectMenu() {
  await menu().evaluate(async (node) => {
    await Promise.all(
      node
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const items = menu().getByRole("menuitem");
  const rows = await items.evaluateAll((nodes) =>
    nodes.map((n) => {
      const rect = n.getBoundingClientRect(),
        icon = n.querySelector(".action-menu-icon"),
        label = n.querySelector(".action-menu-label");
      return {
        height: rect.height,
        iconX: icon?.getBoundingClientRect().left,
        textX: label?.getBoundingClientRect().left,
        hidden: icon?.getAttribute("aria-hidden"),
      };
    }),
  );
  assert.ok(
    rows.length > 0 && rows.every((r) => r.height >= 40 && r.hidden === "true"),
  );
  assert.ok(
    rows.every(
      (r) =>
        Math.abs(r.iconX - rows[0].iconX) < 1 &&
        Math.abs(r.textX - rows[0].textX) < 1,
    ),
    "icons and labels must align in columns",
  );
  const bounds = await menu().boundingBox(),
    view = page.viewportSize();
  assert.ok(
    bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.x + bounds.width <= view.width &&
      bounds.y + bounds.height <= view.height,
  );
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
    colorScheme: "dark",
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("issue-fixture-login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  const account = () => page.getByRole("button", { name: /个人工作台/ });
  await account().click();
  await page.getByRole("button", { name: "工具连接", exact: true }).click();
  // Radix hides the underlying dialog from the accessibility tree while its menu is open.
  const pluginTrigger = () =>
    page.locator('button[aria-label="测试插件 更多操作"]');
  await pluginTrigger().click();
  if (before) {
    await snapshot("menu-before");
  } else {
    await check(
      "plugin actions have aligned icons, a separated destructive action and a persistent expanded anchor",
      async () => {
        await inspectMenu();
        assert.equal(await menu().getByRole("separator").count(), 1);
        assert.equal(
          await menu()
            .getByRole("menuitem", { name: "卸载", exact: true })
            .getAttribute("data-variant"),
          "destructive",
        );
        assert.equal(await pluginTrigger().getAttribute("data-state"), "open");
        await snapshot("plugin-menu-desktop-dark");
        await menu().screenshot({
          path: resolve(output, "menu-detail-after.png"),
          animations: "disabled",
        });
        await page.keyboard.press("ArrowDown");
        assert.ok(
          await menu()
            .getByRole("menuitem")
            .evaluateAll((nodes) =>
              nodes.some((n) => n === document.activeElement),
            ),
        );
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          (el) => el === document.activeElement,
          await pluginTrigger().elementHandle(),
        );
      },
    );
    await check(
      "destructive menu actions retain confirmation, with distinct confirm and cancel buttons",
      async () => {
        await pluginTrigger().click();
        await menu()
          .getByRole("menuitem", { name: "卸载", exact: true })
          .click();
        const dialog = page.getByRole("dialog", {
          name: "卸载 测试插件",
          exact: true,
        });
        const confirm = dialog.getByRole("button", {
            name: "卸载",
            exact: true,
          }),
          cancel = dialog.getByRole("button", { name: "保留", exact: true });
        assert.notEqual(
          await confirm.evaluate((el) => getComputedStyle(el).backgroundColor),
          await cancel.evaluate((el) => getComputedStyle(el).backgroundColor),
        );
        await snapshot("destructive-confirmation-dark");
        await cancel.click();
        await dialog.waitFor({ state: "hidden" });
      },
    );
    await check(
      "independent tools and add menus use the same action geometry without invoking tools",
      async () => {
        await page
          .getByRole("button", { name: "offline 更多操作", exact: true })
          .click();
        await inspectMenu();
        assert.equal(await menu().getByRole("separator").count(), 1);
        await snapshot("tool-menu-desktop-dark");
        await page.keyboard.press("End");
        await closeMenu();
        await page
          .getByRole("button", { name: "添加工具或插件", exact: true })
          .click();
        await inspectMenu();
        await closeMenu();
        assert.equal(
          (await (await context.request.get(origin + "/api/test/issue")).json())
            .calls.length,
          0,
        );
        await closeSettings();
      },
    );
    await check(
      "attachment and approval menus have consistent icons, grouping and selected state",
      async () => {
        await page
          .getByRole("button", { name: "添加附件", exact: true })
          .click();
        await inspectMenu();
        assert.equal(await menu().getByRole("separator").count(), 1);
        await snapshot("composer-menu-desktop-dark");
        await closeMenu();
        await page
          .getByRole("button", { name: "会话审批：请求批准", exact: true })
          .click();
        await menu()
          .getByRole("menuitem", { name: "请求批准", exact: true })
          .waitFor();
        await inspectMenu();
        assert.equal(await menu().locator(".action-menu-trailing").count(), 1);
        await snapshot("approval-menu-desktop-dark");
        await closeMenu();
      },
    );
    await check(
      "history menus use the shared action style and Escape returns focus",
      async () => {
        const input = page.getByRole("textbox", { name: "消息", exact: true });
        await input.fill("控件交互检查");
        await input.press("Enter");
        await page.getByText("测试回复完成。", { exact: true }).waitFor();
        const trigger = page.locator(".history-more").first();
        await trigger.click();
        await inspectMenu();
        await snapshot("history-menu-desktop-dark");
        await page.keyboard.press("Escape");
        await page.waitForFunction(
          (el) => el === document.activeElement,
          await trigger.elementHandle(),
        );
      },
    );
    await check(
      "light and dark desktop and phone menus fit their anchors and expose 44px touch rows",
      async () => {
        for (const theme of ["light", "dark"]) {
          await account().click();
          await page.getByLabel("外观", { exact: true }).selectOption(theme);
          await page
            .getByRole("button", { name: "工具连接", exact: true })
            .click();
          await pluginTrigger().click();
          await inspectMenu();
          await snapshot(`plugin-menu-desktop-${theme}`);
          await closeMenu();
          await closeSettings();
          await page.setViewportSize({ width: 375, height: 812 });
          await page.reload();
          await page
            .getByRole("button", { name: "展开侧栏", exact: true })
            .waitFor();
          await page
            .getByRole("button", { name: "展开侧栏", exact: true })
            .click();
          await account().click();
          await page
            .getByRole("button", { name: "工具连接", exact: true })
            .click();
          await pluginTrigger().click();
          await inspectMenu();
          assert.ok(
            await menu()
              .getByRole("menuitem")
              .evaluateAll((nodes) =>
                nodes.every((n) => n.getBoundingClientRect().height >= 44),
              ),
          );
          const touch = await pluginTrigger().boundingBox();
          assert.ok(touch.width >= 44 && touch.height >= 44);
          await snapshot(`plugin-menu-phone-${theme}`);
          await closeMenu();
          await closeSettings();
          await page.setViewportSize({ width: 1280, height: 900 });
          await page.reload();
          await account().waitFor();
        }
      },
    );
    assert.deepEqual(errors, []);
    writeFileSync(
      resolve(output, "controls-result.json"),
      JSON.stringify({ checks, errors }, null, 2) + "\n",
    );
  }
} catch (e) {
  await page
    ?.screenshot({
      path: resolve(output, "failure.png"),
      animations: "disabled",
    })
    .catch(() => {});
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify({ error: String(e), checks, errors, log }, null, 2),
  );
  throw e;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((r) =>
    server.exitCode !== null ? r() : server.once("exit", r),
  );
}
