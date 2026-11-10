import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  output = resolve(".data/interaction-ui"),
  port = Number(process.env.INTERACTION_TEST_PORT || 3138),
  origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const file of ["result.json", "failure.json"])
  rmSync(resolve(output, file), { force: true });
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/interaction-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_TRANSPORT: "poll",
      INTERACTION_TEST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "",
  browser,
  page;
const exited = new Promise((r) => server.once("exit", r));
const ready = new Promise((res, rej) => {
  const timer = setTimeout(() => rej(Error("Fixture timeout: " + log)), 15000);
  const collect = (d) => {
    log += d;
    if (log.includes("Interaction UI fixture ready")) {
      clearTimeout(timer);
      res();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", () => {
    clearTimeout(timer);
    rej(Error("Fixture exited: " + log));
  });
});
const checks = [],
  errors = [];
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
    viewport: { width: 1280, height: 900 },
    colorScheme: "light",
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  const draft = () => page.getByRole("textbox", { name: "消息", exact: true }),
    dialog = () => page.getByRole("dialog", { name: "设置", exact: true }),
    account = () => page.getByRole("button", { name: /个人工作台/ }),
    inspect = async () =>
      (await context.request.get(origin + "/api/test/interaction")).json();
  const focus = async (locator) =>
    page.waitForFunction(
      (el) => document.activeElement === el,
      await locator.elementHandle(),
    );
  const contained = async (selector) =>
    assert.equal(
      await page.evaluate(
        (selector) => !!document.activeElement?.closest(selector),
        selector,
      ),
      true,
    );
  const fit = async () =>
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  const modalFits = async () => {
    const b = await dialog().boundingBox();
    assert.ok(b.y >= 0 && b.y + b.height <= page.viewportSize().height + 1);
    await fit();
  };
  const theme = async (value) => {
    await account().click();
    await dialog().getByLabel("外观", { exact: true }).selectOption(value);
    await page.keyboard.press("Escape");
  };
  await page.goto(origin);
  await check(
    "login keeps native password manager semantics and shortcuts cannot navigate away",
    async () => {
      await page.getByLabel("登录密码").fill("interaction-ui-fixture-login");
      await page.keyboard.press("Control+k");
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal(
        await page.getByLabel("登录密码").getAttribute("autocomplete"),
        "current-password",
      );
      await page.getByRole("button", { name: "继续", exact: true }).click();
      await draft().waitFor();
    },
  );
  await check(
    "skip link reaches the composer and keyboard focus remains visible",
    async () => {
      await page.locator(".skip-link").focus();
      await page.keyboard.press("Enter");
      await focus(draft());
      const ring = await page
        .locator(".composer")
        .evaluate((el) => getComputedStyle(el).outlineStyle);
      assert.equal(ring, "solid");
    },
  );
  await check(
    "IME composition and Safari 229 Enter keep text without creating a turn",
    async () => {
      const before = await inspect();
      await draft().fill("中文输入尚未确认");
      await draft().dispatchEvent("keydown", {
        key: "Enter",
        code: "Enter",
        isComposing: true,
        bubbles: true,
        cancelable: true,
      });
      await draft().dispatchEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      });
      await page.waitForTimeout(100);
      assert.equal((await inspect()).turns, before.turns);
      assert.equal(await draft().inputValue(), "中文输入尚未确认");
    },
  );
  await check(
    "Shift Enter adds a line and a plain Enter submits exactly once",
    async () => {
      const before = await inspect();
      await draft().fill("第一行");
      await draft().press("Shift+Enter");
      await draft().press("End");
      await draft().type("第二行");
      assert.ok((await draft().inputValue()).includes("\n"));
      await draft().press("Enter");
      await page.getByText(/收到：第一行/).waitFor();
      assert.equal((await inspect()).turns, before.turns + 1);
      await focus(draft());
    },
  );
  await check(
    "search shortcut traps Tab and Escape restores its composer launcher",
    async () => {
      await draft().fill("保留草稿");
      await draft().focus();
      await page.keyboard.press("Control+k");
      const search = page.getByRole("dialog", {
        name: "搜索聊天",
        exact: true,
      });
      await search.waitFor();
      await focus(
        search.getByRole("textbox", { name: "搜索对话", exact: true }),
      );
      for (let i = 0; i < 25; i++) {
        await page.keyboard.press(i % 2 ? "Shift+Tab" : "Tab");
        await contained('[role="dialog"]');
      }
      await search.locator(".search-results button").last().focus();
      await page.keyboard.press("Tab");
      await focus(search.getByRole("button", { name: "关闭", exact: true }));
      await page.keyboard.press("Shift+Tab");
      await focus(search.locator(".search-results button").last());
      await page.keyboard.press("Escape");
      await focus(draft());
      assert.equal(await draft().inputValue(), "保留草稿");
    },
  );
  await check(
    "settings prevents global shortcuts from replacing its draft and restores its button",
    async () => {
      await account().click();
      await dialog().waitFor();
      await page.keyboard.press("Control+k");
      await page.keyboard.press("Control+Shift+o");
      assert.equal(await page.getByRole("dialog").count(), 1);
      for (let i = 0; i < 15; i++) {
        await page.keyboard.press("Tab");
        await contained('[role="dialog"]');
      }
      await page.keyboard.press("Escape");
      await focus(account());
      assert.equal(await draft().inputValue(), "保留草稿");
    },
  );
  await check(
    "menu keyboard actions open rename and return focus to the surviving menu trigger",
    async () => {
      const more = page.getByRole("button", {
        name: "更多操作：富文本主题检查",
        exact: true,
      });
      await more.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("menuitem", { name: "重命名", exact: true }).focus();
      await page.keyboard.press("Enter");
      const rename = page.getByRole("dialog", {
        name: "重命名对话",
        exact: true,
      });
      await focus(
        rename.getByRole("textbox", { name: "对话名称", exact: true }),
      );
      await page.keyboard.press("Escape");
      await focus(more);
    },
  );
  await check(
    "nested private-input dialog blocks shortcuts, returns within settings and never consumes a credential",
    async () => {
      await account().click();
      await dialog()
        .getByRole("button", { name: "安全与运行", exact: true })
        .click();
      const open = dialog().getByRole("button", {
        name: "发起单次提权检查",
        exact: true,
      });
      await open.click();
      await page
        .getByRole("dialog", { name: "单次提权检查", exact: true })
        .waitFor();
      await page.keyboard.press("Control+Shift+o");
      await page.keyboard.press("Control+k");
      await page.keyboard.press("Escape");
      await focus(open);
      assert.equal(await page.getByRole("dialog").count(), 1);
      await page.keyboard.press("Escape");
      await focus(account());
      assert.equal((await inspect()).launched, 0);
    },
  );
  await check(
    "system appearance follows OS changes while explicit light preference stays fixed",
    async () => {
      await theme("system");
      await page.emulateMedia({ colorScheme: "dark" });
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === "dark",
      );
      assert.equal(
        await page.locator('meta[name="theme-color"]').getAttribute("content"),
        "#212121",
      );
      await theme("light");
      await page.emulateMedia({ colorScheme: "light" });
      await page.emulateMedia({ colorScheme: "dark" });
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "light",
      );
    },
  );
  await check(
    "rich text uses the selected theme for code, formulas, diagrams and ECharts",
    async () => {
      await page
        .getByRole("button", { name: "富文本主题检查", exact: true })
        .click();
      await page.locator(".diagram svg").waitFor();
      await page.locator(".chart svg").waitFor();
      await page.locator(".katex").first().waitFor();
      const light = await page.locator(".diagram svg").innerHTML();
      await theme("dark");
      await page.waitForFunction(() =>
        document.querySelector(".diagram svg")?.id.endsWith("-dark"),
      );
      assert.notEqual(await page.locator(".diagram svg").innerHTML(), light);
      for (const selector of [".chart", ".diagram"])
        assert.equal(
          await page
            .locator(selector)
            .evaluate((el) => getComputedStyle(el).backgroundColor),
          "rgb(33, 33, 33)",
        );
      await page.screenshot({ path: resolve(output, "rich-dark.png") });
      await theme("light");
      await page.waitForFunction(() =>
        document.querySelector(".diagram svg")?.id.endsWith("-light"),
      );
      await page.screenshot({ path: resolve(output, "rich-light.png") });
    },
  );
  await check(
    "secondary text meets contrast across both themes and common surfaces",
    async () => {
      for (const value of ["light", "dark"]) {
        await theme(value);
        const colors = await page.evaluate(() => {
          const s = getComputedStyle(document.documentElement);
          return ["--muted", "--bg", "--surface", "--hover"].map((k) =>
            s.getPropertyValue(k).trim(),
          );
        });
        const luminance = (hex) => {
          const expanded =
            hex.length === 4
              ? "#" + [...hex.slice(1)].map((c) => c + c).join("")
              : hex;
          const rgb = expanded
            .replace("#", "")
            .match(/../g)
            .map((c) => parseInt(c, 16) / 255)
            .map((c) =>
              c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
            );
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        for (const surface of colors.slice(1)) {
          const a = luminance(colors[0]),
            b = luminance(surface);
          assert.ok((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) >= 4.5);
        }
      }
    },
  );
  await check(
    "appearance survives reload and reduced motion disables product animations",
    async () => {
      await theme("dark");
      await page.reload();
      await draft().waitFor();
      assert.equal(
        await page.locator("html").getAttribute("data-theme"),
        "dark",
      );
      await page.keyboard.press("Control+k");
      await page.getByRole("dialog").waitFor();
      assert.equal(
        await page
          .getByRole("dialog")
          .evaluate((el) => getComputedStyle(el).animationName),
        "none",
      );
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "mobile sidebar is modal, contains focus and Escape restores the toggle",
    async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
      const sidebar = page.getByRole("dialog", {
        name: "对话导航",
        exact: true,
      });
      await sidebar.waitFor();
      for (let i = 0; i < 28; i++) {
        await page.keyboard.press("Tab");
        await contained(".sidebar");
      }
      await sidebar.locator(".account-button").focus();
      await page.keyboard.press("Tab");
      await focus(sidebar.locator(".brand-button"));
      await page.keyboard.press("Shift+Tab");
      await focus(sidebar.locator(".account-button"));
      await page.keyboard.press("Escape");
      await focus(page.getByRole("button", { name: "展开侧栏", exact: true }));
      assert.equal(await draft().getAttribute("aria-hidden"), null);
      await fit();
    },
  );
  await check(
    "mobile sidebar menus layer above the drawer and nested settings return to navigation",
    async () => {
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
      const sidebar = page.getByRole("dialog", {
        name: "对话导航",
        exact: true,
      });
      await sidebar
        .getByRole("button", { name: "更多操作：富文本主题检查", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
      await page
        .getByRole("dialog", { name: "重命名对话", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await sidebar.waitFor();
      await account().click();
      await dialog().waitFor();
      await page.keyboard.press("Escape");
      await focus(account());
      await page.keyboard.press("Escape");
      await focus(page.getByRole("button", { name: "展开侧栏", exact: true }));
    },
  );
  await check(
    "mobile controls have 44px targets and input fields avoid automatic text zoom",
    async () => {
      const open = page.getByRole("button", { name: "展开侧栏", exact: true });
      await open.click();
      for (const selector of [
        ".sidebar-top .icon-button",
        ".history-more",
        ".history-link",
      ]) {
        const sizes = await page.locator(selector).evaluateAll((els) =>
          els.map((el) => ({
            w: el.getBoundingClientRect().width,
            h: el.getBoundingClientRect().height,
          })),
        );
        assert.ok(sizes.every((s) => s.h >= 44 && s.w >= 44));
      }
      await account().click();
      await modalFits();
      const appearance = dialog().getByLabel("外观", { exact: true });
      assert.ok(
        parseFloat(
          await appearance.evaluate((el) => getComputedStyle(el).fontSize),
        ) >= 16,
      );
      await page.screenshot({ path: resolve(output, "settings-mobile.png") });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await fit();
    },
  );
  await check(
    "320px layout keeps the composer and search usable without horizontal overflow",
    async () => {
      await page.setViewportSize({ width: 320, height: 640 });
      await draft().fill("窄屏仍可继续输入");
      await draft().focus();
      await page.keyboard.press("Control+k");
      const search = page.getByRole("dialog", {
        name: "搜索聊天",
        exact: true,
      });
      await search
        .getByRole("textbox", { name: "搜索对话", exact: true })
        .fill("很长的搜索关键词".repeat(12));
      await fit();
      await page.keyboard.press("Escape");
      await focus(draft());
      assert.equal(await draft().inputValue(), "窄屏仍可继续输入");
      await fit();
    },
  );
  await check(
    "landscape and short viewport settings keep close and focused fields reachable",
    async () => {
      await page.setViewportSize({ width: 667, height: 375 });
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
      await account().click();
      await modalFits();
      const nav = dialog().getByRole("navigation", { name: "设置分类" });
      await nav
        .getByRole("button", { name: "安全与运行", exact: true })
        .focus();
      const bounds = await page.evaluate(() => {
        const r = document.activeElement.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      });
      assert.ok(bounds.top >= 0 && bounds.bottom <= 375);
      await page.screenshot({
        path: resolve(output, "settings-landscape.png"),
      });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "drawer breakpoint changes leave no stale focus trap or hidden desktop workspace",
    async () => {
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
      await page.setViewportSize({ width: 1024, height: 768 });
      await page.waitForFunction(
        () => !document.querySelector('.sidebar[role="dialog"]'),
      );
      await draft().focus();
      await focus(draft());
      assert.notEqual(
        await page.locator(".main").getAttribute("aria-hidden"),
        "true",
      );
      await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
      await draft().focus();
      await page.keyboard.press("Control+Shift+o");
      await focus(draft());
      assert.equal(await draft().inputValue(), "");
    },
  );
  assert.deepEqual(errors, []);
  const counts = await inspect();
  assert.equal(counts.turns, 1);
  assert.equal(counts.launched, 0);
  assert.equal(counts.pendingPrivateInputs, 0);
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      { checks, passed: checks.length, counts, pageErrors: errors },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Interaction UI: ${checks.length} checks passed`);
} catch (error) {
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify({ checks, error: String(error), errors, log }, null, 2),
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
  for (const file of readdirSync(output))
    chmodSync(resolve(output, file), 0o600);
}
