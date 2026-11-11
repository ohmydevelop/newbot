import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { resolve, extname } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(
  process.env.UI_EVIDENCE_DIR || ".issue/2026-11-09/evidence-04",
);
mkdirSync(output, { recursive: true });
const port = 3145,
  origin = `http://127.0.0.1:${port}`,
  candidate = process.env.UI_TEST_CANDIDATE
    ? resolve(process.env.UI_TEST_CANDIDATE)
    : null;
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/issue-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_TRANSPORT: "poll",
      ISSUE_TEST_PORT: String(port),
      ISSUE_RICH_UI: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "",
  browser,
  page,
  stage = "startup";
const checks = [],
  errors = [];
let uploads = 0;
let pluginMode = "",
  releasePlugins,
  releaseSkill,
  failMutation = false;
const calls = [];
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
async function check(name, fn) {
  if (
    process.env.UI_STAGE === "layout" &&
    !/settings keep|responsive/.test(name)
  )
    return;
  stage = name;
  await fn();
  checks.push(name);
  console.log("PASS " + name);
}
const input = () => page.getByRole("textbox", { name: "消息", exact: true });
const picker = (kind) =>
  page.getByRole("dialog", { name: "选择" + kind, exact: true });
const model = () =>
  page.getByRole("dialog", { name: "选择模型与推理强度", exact: true });
const snapshot = async (name) =>
  page.screenshot({
    path: resolve(output, name + ".png"),
    animations: "disabled",
  });
try {
  await ready;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  await context.route("**/*", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.origin !== origin) return route.continue();
    if (req.method() === "POST" && url.pathname === "/api/attachments")
      uploads++;
    if (req.method() === "POST" && url.pathname === "/api/agent/action") {
      const action = req.postDataJSON()?.action;
      calls.push(action);
      if (action === "session/update" && failMutation) {
        failMutation = false;
        return route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "设置已变化，请重试" }),
        });
      }
      if (action === "plugin/list" && pluginMode === "fail")
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "目录测试错误" }),
        });
      if (action === "plugin/list" && pluginMode === "delay")
        await new Promise((done) => {
          releasePlugins = done;
        });
    }
    if (url.pathname.startsWith("/api/skills/") && releaseSkill === true)
      await new Promise((done) => {
        releaseSkill = done;
      });
    if (
      req.method() === "GET" &&
      !url.pathname.startsWith("/api/") &&
      candidate &&
      existsSync(candidate)
    ) {
      const file = resolve(
        candidate,
        url.pathname === "/"
          ? "index.html"
          : "." + decodeURIComponent(url.pathname),
      );
      if (file.startsWith(candidate + "/") && existsSync(file)) {
        const type =
          {
            ".html": "text/html",
            ".js": "text/javascript",
            ".css": "text/css",
            ".svg": "image/svg+xml",
            ".wasm": "application/wasm",
            ".woff2": "font/woff2",
            ".mjs": "text/javascript",
          }[extname(file)] || "application/octet-stream";
        return route.fulfill({
          status: 200,
          contentType: type,
          body: readFileSync(file),
        });
      }
    }
    return route.continue();
  });
  page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("issue-fixture-login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await input().waitFor();
  await check(
    "plugin button opens searchable panel without changing draft; repeat focuses same panel",
    async () => {
      await input().fill("保留原草稿");
      const trigger = page.getByRole("button", {
        name: "选择插件",
        exact: true,
      });
      await trigger.click();
      await picker("插件").waitFor();
      await picker("插件")
        .getByRole("option", { name: /测试插件/ })
        .waitFor();
      await trigger.click();
      await trigger.click();
      assert.equal(await page.locator(".composer-selection-panel").count(), 1);
      assert.equal(await input().inputValue(), "保留原草稿");
      await picker("插件")
        .getByRole("combobox", { name: "搜索插件" })
        .fill("no-matching-plugin");
      await picker("插件")
        .getByText("没有匹配的结果", { exact: true })
        .waitFor();
      await picker("插件").getByRole("combobox").fill("test-plugin");
      await picker("插件")
        .getByRole("option", { name: /测试插件/ })
        .click();
      await picker("插件")
        .getByRole("option", { name: /测试插件/ })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: "移除插件 测试插件", exact: true })
          .count(),
        1,
      );
      assert.equal(await input().inputValue(), "保留原草稿");
      await snapshot("plugin-search-desktop-dark");
    },
  );
  await check(
    "outside click closes picker; Escape returns focus; entry switch keeps one panel",
    async () => {
      await page.locator(".topbar .workspace-title").click();
      await picker("插件").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "选择插件", exact: true }).click();
      await picker("插件").waitFor();
      await page.keyboard.press("Escape");
      await picker("插件").waitFor({ state: "hidden" });
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("aria-label") === "选择插件",
      );
      await page.getByRole("button", { name: "选择插件", exact: true }).click();
      await page.getByRole("button", { name: "选择技能", exact: true }).click();
      await picker("技能").waitFor();
      assert.equal(await page.locator(".composer-selection-panel").count(), 1);
      await page.keyboard.press("Escape");
      await picker("技能").waitFor({ state: "hidden" });
      await page.waitForFunction(
        () => document.activeElement?.getAttribute("aria-label") === "选择技能",
      );
    },
  );
  await check(
    "manual @ at caret selects and preserves suffix; duplicate reference remains unique",
    async () => {
      await input().fill("前文 @test 后文");
      await input().press("Home");
      for (let i = 0; i < 8; i++) await input().press("ArrowRight");
      await picker("插件")
        .getByRole("option", { name: /测试插件/ })
        .waitFor();
      // Cached entries can appear before the refreshed directory is ready.
      await picker("插件").locator('[role="option"]:enabled').first().waitFor();
      await input().press("Enter");
      await picker("插件").waitFor({ state: "hidden" });
      assert.equal(await input().inputValue(), "前文  后文");
      assert.equal(
        await page
          .getByRole("button", { name: "移除插件 测试插件", exact: true })
          .count(),
        1,
      );
    },
  );
  await check(
    "manual $ supports keyboard selection and IME never submits",
    async () => {
      await input().fill("$code");
      await picker("技能")
        .getByRole("option", { name: /code-review/ })
        .waitFor();
      await picker("技能").locator('[role="option"]:enabled').first().waitFor();
      const sent = calls.filter((c) => c === "turn/start").length;
      await input().evaluate((el) => {
        el.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            isComposing: true,
            bubbles: true,
          }),
        );
      });
      assert.equal(calls.filter((c) => c === "turn/start").length, sent);
      assert.equal(await input().inputValue(), "$code");
      await input().press("ArrowDown");
      await input().press("Enter");
      await page.getByLabel("下一条消息的技能").waitFor();
      await picker("技能").waitFor({ state: "hidden" });
    },
  );
  await check(
    "typing while plugin list is delayed preserves loading; errors retry in same panel",
    async () => {
      releasePlugins = undefined;
      pluginMode = "delay";
      await page.getByRole("button", { name: "选择插件", exact: true }).click();
      await page.waitForFunction(
        () => !!document.querySelector(".picker-feedback [role=status]"),
      );
      await picker("插件").getByRole("combobox").fill("测试");
      assert.equal(
        await picker("插件")
          .getByText("正在读取选择目录", { exact: true })
          .count(),
        1,
      );
      pluginMode = "";
      releasePlugins();
      await picker("插件")
        .getByRole("option", { name: /测试插件/ })
        .waitFor();
      pluginMode = "fail";
      await picker("插件")
        .getByRole("button", { name: "刷新选择目录" })
        .click();
      await picker("插件").getByRole("alert").waitFor();
      pluginMode = "";
      await picker("插件")
        .getByRole("button", { name: "重试", exact: true })
        .click();
      await picker("插件").getByRole("alert").waitFor({ state: "hidden" });
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "model groups collapse, search temporarily expands, and redundant compatibility text is absent",
    async () => {
      await page.getByRole("button", { name: "选择模型与推理强度" }).click();
      await model()
        .getByRole("button", { name: "测试网关 模型分组", exact: true })
        .waitFor();
      const group = model().getByRole("button", {
        name: "测试网关 模型分组",
        exact: true,
      });
      await group.click();
      assert.equal(await group.getAttribute("aria-expanded"), "false");
      await model().getByRole("searchbox").fill("fixture-model");
      assert.equal(await group.getAttribute("aria-expanded"), "true");
      await model().getByRole("searchbox").fill("");
      assert.equal(await group.getAttribute("aria-expanded"), "false");
      await group.click();
      assert.equal(
        await model().getByText("兼容性待验证", { exact: true }).count(),
        0,
      );
      await snapshot("runtime-desktop-dark");
    },
  );
  await check(
    "reasoning slider reflects six supported values and commits final keyboard choice",
    async () => {
      const slider = model().getByRole("slider", {
        name: "推理强度",
        exact: true,
      });
      await slider.waitFor();
      assert.equal(await slider.getAttribute("aria-valuemax"), "5");
      await slider.focus();
      await page.keyboard.press("End");
      await page.waitForFunction(
        () =>
          document.querySelector(".runtime-picker-trigger small")
            ?.textContent === "Ultra",
      );
      assert.equal(await slider.getAttribute("aria-valuetext"), "Ultra");
      await model()
        .getByRole("button", { name: "恢复模型默认推理强度" })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector(".runtime-picker-trigger small")
            ?.textContent === "中",
      );
      await page.keyboard.press("Escape");
      await model().waitFor({ state: "hidden" });
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "选择模型与推理强度",
      );
    },
  );
  await check(
    "model selection and mention panel do not overlap; draft survives closing",
    async () => {
      await input().fill("保留草稿 @test");
      await picker("插件").waitFor();
      await page.getByRole("button", { name: "选择模型与推理强度" }).click();
      await model().waitFor();
      await picker("插件").waitFor({ state: "hidden" });
      await page.keyboard.press("Escape");
      await model().waitFor({ state: "hidden" });
      assert.equal(await input().inputValue(), "保留草稿 @test");
    },
  );
  await check(
    "message area accepts files; nested drag leaves do not flicker or duplicate uploads",
    async () => {
      const dt = await page.evaluateHandle(() => {
        const d = new DataTransfer();
        d.items.add(
          new File(["drop test"], "wide.txt", { type: "text/plain" }),
        );
        return d;
      });
      await page
        .locator(".conversation")
        .dispatchEvent("dragenter", { dataTransfer: dt });
      await page.getByText("松开以添加附件", { exact: true }).waitFor();
      await page
        .locator(".welcome h1")
        .dispatchEvent("dragenter", { dataTransfer: dt });
      await page
        .locator(".welcome h1")
        .dispatchEvent("dragleave", { dataTransfer: dt });
      assert.equal(await page.locator(".chat-drop-hint").count(), 1);
      const sent = uploads,
        done = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/api/attachments" &&
            r.request().method() === "POST",
        );
      await page
        .locator(".conversation")
        .dispatchEvent("drop", { dataTransfer: dt });
      await done;
      await page
        .getByRole("button", { name: "移除 wide.txt", exact: true })
        .waitFor();
      assert.equal(uploads, sent + 1);
      assert.equal(await page.locator(".chat-drop-hint").count(), 0);
      await snapshot("chat-wide-drop");
      await page
        .getByRole("button", { name: "移除 wide.txt", exact: true })
        .click();
      await dt.dispose();
    },
  );
  await check(
    "text drags, sidebar and settings do not upload files; cancellation clears the hint",
    async () => {
      const text = await page.evaluateHandle(() => {
        const d = new DataTransfer();
        d.setData("text/plain", "move text");
        return d;
      });
      await page
        .locator(".conversation")
        .dispatchEvent("dragenter", { dataTransfer: text });
      assert.equal(await page.locator(".chat-drop-hint").count(), 0);
      await text.dispose();
      const dt = await page.evaluateHandle(() => {
        const d = new DataTransfer();
        d.items.add(new File(["skip"], "skip.txt", { type: "text/plain" }));
        return d;
      });
      const sent = uploads;
      await page
        .locator(".sidebar")
        .dispatchEvent("drop", { dataTransfer: dt });
      assert.equal(uploads, sent);
      await page
        .locator(".conversation")
        .dispatchEvent("dragenter", { dataTransfer: dt });
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      assert.equal(await page.locator(".chat-drop-hint").count(), 0);
      await page.getByRole("button", { name: "工具连接", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.waitFor();
      await settings.dispatchEvent("drop", { dataTransfer: dt });
      assert.equal(uploads, sent);
      await page.keyboard.press("Escape");
      await settings.waitFor({ state: "hidden" });
      await dt.dispose();
    },
  );
  await check(
    "settings keep identical bounds across tabs; gateway columns and editor controls align",
    async () => {
      await page.getByRole("button", { name: "工具连接", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.waitFor();
      await settings.evaluate(async (node) => {
        await Promise.all(
          node.getAnimations().map((a) => a.finished.catch(() => {})),
        );
      });
      const initial = await settings.boundingBox();
      for (const tab of [
        "通用",
        "网关",
        "工具连接",
        "技能",
        "文件存储",
        "安全与运行",
      ]) {
        await settings
          .getByRole("navigation", { name: "设置分类" })
          .getByRole("button", { name: tab, exact: true })
          .click();
        const box = await settings.boundingBox();
        for (const key of ["x", "y", "width", "height"])
          assert.ok(
            Math.abs(box[key] - initial[key]) < 1,
            tab + " changes " + key,
          );
        if (["网关", "工具连接", "技能"].includes(tab))
          await snapshot("settings-desktop-dark-" + tab);
      }
      await settings
        .getByRole("button", { name: "网关", exact: true })
        .click();
      await settings.locator(".gateway-card").first().waitFor();
      const boxes = await settings
        .locator(".gateway-card select")
        .evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect();
            return { x: r.x, width: r.width };
          }),
        );
      assert.ok(boxes.length >= 2);
      assert.ok(boxes.every((b) => Math.abs(b.width - boxes[0].width) < 1));
      await settings
        .locator(".gateway-card")
        .first()
        .getByRole("button", { name: /编辑/ })
        .click();
      const editor = page.getByRole("dialog", {
        name: "测试网关",
        exact: true,
      });
      await editor.waitFor();
      assert.equal(
        await editor.getByLabel("替换连接地址", { exact: true }).inputValue(),
        "",
      );
      await editor.getByText("当前连接地址", { exact: true }).waitFor();
      const actions = await editor
        .locator(".editor-actions")
        .first()
        .locator("button")
        .evaluateAll((nodes) =>
          nodes.map((n) => n.getBoundingClientRect().height),
        );
      assert.ok(
        actions.length >= 2 &&
          actions.every((h) => Math.abs(h - actions[0]) < 1),
      );
      await snapshot("gateway-editor-desktop-dark");
      await editor.getByRole("button", { name: "取消", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
      await settings.waitFor({ state: "hidden" });
    },
  );
  await check(
    "responsive settings, palettes and model popover stay inside all viewports",
    async () => {
      for (const width of [320, 390, 768, 1440])
        for (const theme of ["light", "dark"]) {
          await page.setViewportSize({ width, height: 800 });
          await page.emulateMedia({ colorScheme: theme });
          await page.waitForFunction(
            (theme) => document.documentElement.dataset.theme === theme,
            theme,
          );
          const expand = page.getByRole("button", {
            name: "展开侧栏",
            exact: true,
          });
          if (await expand.isVisible()) await expand.click();
          await page
            .getByRole("button", { name: "工具连接", exact: true })
            .click();
          const settings = page.getByRole("dialog", {
            name: "设置",
            exact: true,
          });
          await settings.waitFor();
          await settings.evaluate(async (node) => {
            await Promise.all(
              node.getAnimations().map((a) => a.finished.catch(() => {})),
            );
          });
          const initial = await settings.boundingBox();
          assert.ok(
            initial.x >= 11 &&
              initial.x + initial.width <= width - 11 &&
              initial.y >= 0 &&
              initial.y + initial.height <= 801,
          );
          for (const tab of ["技能", "网关", "工具连接"]) {
            await settings
              .getByRole("button", { name: tab, exact: true })
              .click();
            const box = await settings.boundingBox();
            assert.ok(
              Math.abs(box.width - initial.width) < 1 &&
                Math.abs(box.height - initial.height) < 1,
            );
          }
          assert.ok(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1,
            ),
          );
          if (width === 390 || width === 1440)
            await snapshot("settings-" + width + "-" + theme);
          await settings
            .getByRole("button", { name: "关闭", exact: true })
            .click();
          await settings.waitFor({ state: "hidden" });
          const collapse = page.getByRole("button", {
            name: "收起侧栏",
            exact: true,
          });
          if (width <= 760 && (await collapse.isVisible()))
            await collapse.click();
          await page
            .getByRole("button", { name: "选择模型与推理强度" })
            .click();
          await model().getByRole("searchbox").waitFor();
          await model()
            .getByRole("button", { name: "测试网关 模型分组", exact: true })
            .waitFor();
          await model()
            .getByText("正在读取模型目录", { exact: true })
            .waitFor({ state: "hidden" });
          const popup = await model().boundingBox();
          assert.ok(
            popup.x >= 0 &&
              popup.x + popup.width <= width + 1 &&
              popup.y >= 0 &&
              popup.y + popup.height <= 801,
          );
          if (width === 390 || width === 1440)
            await snapshot("model-" + width + "-" + theme);
          await page.keyboard.press("Escape");
          await model().waitFor({ state: "hidden" });
        }
    },
  );
  await check(
    "cancelled skill selection and late plugin discovery cannot populate a new draft",
    async () => {
      await page.setViewportSize({ width: 1440, height: 900 });
      const remove = page.getByRole("button", { name: /^移除技能/ });
      if (await remove.count()) await remove.first().click();
      await page.getByRole("button", { name: "选择技能", exact: true }).click();
      await picker("技能").getByRole("combobox").fill("code-review");
      releaseSkill = true;
      await picker("技能")
        .getByRole("option")
        .filter({ hasText: "code-review" })
        .click();
      const until = Date.now() + 3000;
      while (typeof releaseSkill !== "function" && Date.now() < until)
        await new Promise((done) => setTimeout(done, 10));
      assert.equal(typeof releaseSkill, "function");
      await page.keyboard.press("Escape");
      await picker("技能").waitFor({ state: "hidden" });
      const expand = page.getByRole("button", {
        name: "展开侧栏",
        exact: true,
      });
      if (await expand.isVisible()) await expand.click();
      await page.getByRole("button", { name: /^新聊天/ }).click();
      await input().fill("新的会话草稿");
      releaseSkill();
      releaseSkill = undefined;
      assert.equal(await page.getByLabel("下一条消息的技能").count(), 0);
      releasePlugins = undefined;
      pluginMode = "delay";
      await page.getByRole("button", { name: "选择插件", exact: true }).click();
      const waiting = Date.now() + 3000;
      while (typeof releasePlugins !== "function" && Date.now() < waiting)
        await new Promise((done) => setTimeout(done, 10));
      await page.getByRole("button", { name: /^新聊天/ }).click();
      await input().fill("继续保留草稿");
      pluginMode = "";
      releasePlugins();
      releasePlugins = undefined;
      await page.waitForTimeout(100);
      assert.equal(await picker("插件").count(), 0);
      assert.equal(await input().inputValue(), "继续保留草稿");
      assert.equal(await page.getByLabel("下一条消息的插件").count(), 0);
    },
  );
  await check(
    "running turns block model changes and uploads; failed setting keeps binding and draft",
    async () => {
      await input().fill("运行边界测试");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await page
        .getByRole("button", { name: "停止回答", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "选择模型与推理强度" })
          .isDisabled(),
        true,
      );
      const dt = await page.evaluateHandle(() => {
        const d = new DataTransfer();
        d.items.add(
          new File(["skip"], "while-running.txt", { type: "text/plain" }),
        );
        return d;
      });
      const count = uploads;
      await page
        .locator(".conversation")
        .dispatchEvent("dragenter", { dataTransfer: dt });
      await page
        .locator(".conversation")
        .dispatchEvent("drop", { dataTransfer: dt });
      assert.equal(uploads, count);
      await dt.dispose();
      await page
        .getByRole("button", { name: "停止回答", exact: true })
        .waitFor({ state: "hidden" });
      await input().fill("失败保留草稿");
      const label = await page
        .getByRole("button", { name: "选择模型与推理强度" })
        .innerText();
      await page.getByRole("button", { name: "选择模型与推理强度" }).click();
      await model()
        .getByRole("option", { name: "secondary-model", exact: true })
        .waitFor();
      failMutation = true;
      await model()
        .getByRole("option", { name: "secondary-model", exact: true })
        .click();
      await model().getByRole("alert").waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "选择模型与推理强度" })
          .innerText(),
        label,
      );
      assert.equal(await input().inputValue(), "失败保留草稿");
      await model()
        .getByRole("slider", { name: "推理强度", exact: true })
        .focus();
      await page.keyboard.press("End");
      await page.waitForFunction(
        () =>
          document.querySelector(".runtime-picker-trigger small")
            ?.textContent === "Ultra",
      );
      await model().getByRole("searchbox").focus();
      await page.keyboard.press("ArrowDown");
      assert.equal(
        await page.evaluate(() => document.activeElement?.getAttribute("role")),
        "option",
      );
      await page.keyboard.press("End");
      await page.keyboard.press("Home");
      await page.keyboard.press("Escape");
      await model().waitFor({ state: "hidden" });
      assert.equal(await input().inputValue(), "失败保留草稿");
    },
  );
  if (process.env.ISSUE_MEMORY_PROVIDERS) {
    const openProviderSettings = async () => {
      const expand = page.getByRole("button", {
        name: "展开侧栏",
        exact: true,
      });
      if (await expand.isVisible()) await expand.click();
      await page.getByRole("button", { name: "工具连接", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "设置", exact: true });
      await dialog
        .getByRole("button", { name: "网关", exact: true })
        .click();
      return dialog;
    };
    await check(
      "gateway edits persist in SQLite across browser reload and never write native Provider config or restart Codex",
      async () => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.reload();
        const dialog = await openProviderSettings();
        await dialog
          .getByRole("button", { name: "编辑 测试网关", exact: true })
          .click();
        const editor = page.getByRole("dialog", {
          name: "测试网关",
          exact: true,
        });
        await editor
          .getByRole("textbox", { name: "名称", exact: true })
          .fill("持久化网关");
        await editor
          .getByRole("button", { name: "保存并获取模型", exact: true })
          .click();
        await editor.waitFor({ state: "hidden" });
        await dialog
          .getByRole("button", { name: "编辑 持久化网关", exact: true })
          .waitFor();
        await page.reload();
        await openProviderSettings();
        await page
          .getByRole("button", { name: "编辑 持久化网关", exact: true })
          .waitFor();
        const state = await page.evaluate(() =>
          fetch("/api/test/issue").then((r) => r.json()),
        );
        assert.equal(state.providerStorage, "sqlite");
        assert.ok(state.persistedProviderNames.includes("持久化网关"));
        assert.equal(state.providerWrites, 0);
        assert.equal(state.restarts, 0);
        await page.screenshot({
          path: resolve(output, "sqlite-gateway-desktop.png"),
        });
      },
    );
    await check(
      "empty and externally supplied SQLite configuration are explicit on mobile and preserve existing history",
      async () => {
        const response = await page.evaluate(async () => {
          const current = await fetch("/api/runtime/config").then((r) =>
            r.json(),
          );
          const result = await fetch("/api/runtime/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: current.configuration.revision,
              providers: [],
            }),
          });
          return result.status;
        });
        assert.equal(response, 200);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload();
        // Open settings through the shared sidebar drawer.
        await openProviderSettings();
        await page.getByText("尚未添加网关", { exact: false }).waitFor();
        await page.screenshot({
          path: resolve(output, "sqlite-empty-mobile.png"),
        });
        const missing = page
          .getByRole("button", { name: /^编辑 会话网关 / })
          .first();
        await missing.click();
        const restoration = page.getByRole("dialog", { name: /^会话网关 / });
        await restoration
          .getByRole("textbox", { name: "名称", exact: true })
          .fill("网页恢复网关");
        await restoration
          .getByRole("textbox", { name: "连接地址", exact: true })
          .fill(origin + "/fixture/provider-a");
        await restoration
          .getByRole("button", { name: "保存并获取模型", exact: true })
          .click();
        await restoration.waitFor({ state: "hidden" });
        await page
          .getByRole("button", { name: "编辑 网页恢复网关", exact: true })
          .waitFor();
        const restored = await page.evaluate(async () => {
          const current = await fetch("/api/runtime/config").then((r) =>
            r.json(),
          );
          const result = await fetch("/api/runtime/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedRevision: current.configuration.revision,
              providers: [
                {
                  id: "fixture",
                  name: "恢复测试网关",
                  baseUrl: location.origin + "/fixture/provider-a",
                  defaultModel: "fixture-model",
                },
              ],
              defaults: { provider: "fixture", model: "fixture-model" },
            }),
          });
          return result.status;
        });
        assert.equal(restored, 200);
        await page
          .getByRole("button", { name: "刷新网关", exact: true })
          .click();
        await page
          .getByRole("button", { name: "编辑 恢复测试网关", exact: true })
          .waitFor();
        const state = await page.evaluate(() =>
          fetch("/api/test/issue").then((r) => r.json()),
        );
        assert.equal(state.providerWrites, 0);
        assert.equal(state.restarts, 0);
      },
    );
  }
  assert.deepEqual(errors, [], "browser errors");
  for (const file of [
    "ui-regression-failure.json",
    "ui-regression-failure.png",
    "geometry-debug.json",
  ])
    rmSync(resolve(output, file), { force: true });
  writeFileSync(
    resolve(output, "ui-regression-result.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
  console.log(JSON.stringify({ passed: checks.length, errors }));
} catch (error) {
  if (page) {
    const geometry = await page
      .locator(".gateway-connection-tools .editor-actions > button")
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const s = getComputedStyle(node),
            rules = [];
          function walk(list) {
            for (const rule of list) {
              if (rule.selectorText) {
                try {
                  if (node.matches(rule.selectorText)) rules.push(rule.cssText);
                } catch {}
              } else if (rule.cssRules) walk(rule.cssRules);
            }
          }
          for (const sheet of document.styleSheets) {
            try {
              walk(sheet.cssRules);
            } catch {}
          }
          return {
            text: node.textContent,
            height: node.getBoundingClientRect().height,
            padding: s.padding,
            margin: s.margin,
            lineHeight: s.lineHeight,
            alignSelf: s.alignSelf,
            rules,
          };
        }),
      );
    writeFileSync(
      resolve(output, "geometry-debug.json"),
      JSON.stringify(geometry, null, 2),
    );
    await snapshot("ui-regression-failure").catch(() => {});
    writeFileSync(
      resolve(output, "ui-regression-failure.json"),
      JSON.stringify({ stage, error: error.message, checks, errors }, null, 2),
    );
  }
  console.error(stage + ": " + error.stack);
  process.exitCode = 1;
} finally {
  if (typeof releasePlugins === "function") releasePlugins();
  if (typeof releaseSkill === "function") releaseSkill();
  await browser?.close();
  server.kill("SIGTERM");
}
