// Browser regression for feedback layout. Codex/providers are isolated local fixtures.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, extname } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const stage = "experts";
const output = resolve(
  process.env.UI_EVIDENCE_DIR || ".issue/2026-11-10/evidence-issue-03/ui",
  stage,
);
const candidate = resolve(
  process.env.UI_TEST_CANDIDATE || ".data/issue-03-web",
);
mkdirSync(output, { recursive: true });
for (const name of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, name), { force: true });
const origin = "http://127.0.0.1:3151";
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/issue-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_TRANSPORT: "poll",
      ISSUE_TEST_PORT: "3151",
      ISSUE_RICH_UI: "1",
      ISSUE_MEMORY_PROVIDERS: "1",
      ISSUE_WORKSPACE_UI: "1",
      ...(stage === "navigation" ? { ISSUE_FEEDBACK_HISTORY: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "",
  browser,
  page,
  current = "startup";
const checks = [],
  errors = [],
  metrics = [];
const exited = new Promise((resolve) => server.once("exit", resolve));
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error(log)), 15000);
  const collect = (data) => {
    log += data;
    if (log.includes("Issue UI fixture ready")) {
      clearTimeout(timer);
      resolve();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", () => {
    clearTimeout(timer);
    reject(Error(log));
  });
});
const check = async (name, run) => {
  current = name;
  await run();
  checks.push(name);
  console.log("PASS " + name);
};
const stable = (before, after, label) => {
  for (const key of ["x", "y", "width", "height"])
    assert.ok(
      Math.abs(before[key] - after[key]) <= 1,
      `${label}.${key}: ${before[key]} -> ${after[key]}`,
    );
};
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
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
    viewport: { width: 1440, height: 1000 },
    colorScheme: "dark",
    reducedMotion: "reduce",
  });
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === origin &&
      route.request().method() === "GET" &&
      !url.pathname.startsWith("/api/")
    ) {
      const file = resolve(
        candidate,
        url.pathname === "/"
          ? "index.html"
          : "." + decodeURIComponent(url.pathname),
      );
      if (file.startsWith(candidate + "/") && existsSync(file))
        return route.fulfill({
          body: readFileSync(file),
          contentType:
            {
              ".html": "text/html",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
              ".wasm": "application/wasm",
            }[extname(file)] || "application/octet-stream",
        });
    }
    return route.continue();
  });
  const action = async (name, params = {}) => {
    const r = await context.request.post(origin + "/api/agent/action", {
      headers: { origin },
      data: { action: name, ...params },
    });
    assert.equal(r.status(), 200, await r.text());
    return r.json();
  };
  await context.request.post(origin + "/api/login", {
    headers: { origin },
    data: { password: "issue-fixture-login" },
  });
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page.getByRole("textbox", { name: "消息" }).waitFor();
  let expert, threadId;
  await check(
    "unified extensions, keyboard tabs and expert create/edit with actual members",
    async () => {
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name: "扩展", exact: true })
        .click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings.getByRole("tab", { name: "专家", exact: true }).waitFor();
      assert.equal(await settings.getByRole("tab").count(), 4);
      await settings.getByRole("tab", { name: "专家", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      assert.equal(
        await settings
          .getByRole("tab", { name: "插件", exact: true })
          .getAttribute("aria-selected"),
        "true",
      );
      await settings
        .getByRole("button", { name: "查看 测试插件", exact: true })
        .waitFor();
      await settings.getByRole("tab", { name: "专家", exact: true }).click();
      await settings
        .getByRole("button", { name: "添加专家", exact: true })
        .click();
      const editor = page.getByRole("dialog", {
        name: "创建专家",
        exact: true,
      });
      await editor.getByLabel("名称", { exact: true }).fill("审查专家");
      await editor
        .getByLabel("简介", { exact: true })
        .fill("检查改动并读取工具数据");
      await editor
        .getByRole("checkbox", { name: "代码审查", exact: true })
        .check();
      await editor
        .getByRole("checkbox", { name: "测试插件", exact: true })
        .check();
      await editor
        .getByRole("checkbox", { name: "test-server", exact: true })
        .check();
      await editor.screenshot({
        path: resolve(output, "expert-editor-dark.png"),
      });
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      expert = (await action("expert/list")).entries[0];
      assert.equal(expert.skillIds.length, 1);
      assert.equal(expert.pluginIds.length, 1);
      assert.equal(expert.connectorIds.length, 1);
      await settings
        .getByRole("button", { name: "查看专家 审查专家", exact: true })
        .waitFor();
      await settings.screenshot({
        path: resolve(output, "extensions-desktop-dark.png"),
      });
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
    },
  );
  await check(
    "@ keyboard selection persists across turns and refresh; global disable blocks dispatch and preserves draft",
    async () => {
      const input = page.getByRole("textbox", { name: "消息" });
      await input.fill("@审查");
      await input.press("ArrowDown");
      await page.getByRole("option", { name: /审查专家/ }).waitFor();
      await input.press("Enter");
      await page.getByLabel("当前会话的专家", { exact: true }).waitFor();
      assert.equal(await input.inputValue(), "");
      await input.fill("EXPERT_UI_FIRST_TURN");
      const submitted = page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/agent/run") && r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      const response = await submitted;
      assert.equal(response.status(), 200, await response.text());
      threadId = (await response.json()).threadId;
      await page
        .getByRole("button", { name: "停止回答", exact: true })
        .waitFor({ state: "hidden" });
      await page.getByLabel("此消息使用的专家", { exact: true }).waitFor();
      assert.match(
        await page.getByLabel("当前会话的专家", { exact: true }).innerText(),
        /审查专家/,
      );
      await page.reload();
      await input.waitFor();
      await page.getByLabel("当前会话的专家", { exact: true }).waitFor();
      const config = await (
        await context.request.get(origin + "/api/config")
      ).json();
      await action("plugin/enabled", {
        id: "test-plugin@local",
        enabled: false,
        expectedRevision: config.configuration.revision,
      });
      await input.fill("KEEP_DRAFT_WHEN_DISABLED");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await page
        .locator(".error-banner")
        .filter({ hasText: "不可用" })
        .waitFor();
      assert.equal(await input.inputValue(), "KEEP_DRAFT_WHEN_DISABLED");
      const history = await (
        await context.request.get(origin + "/api/threads/" + threadId)
      ).json();
      assert.equal(history.turns.length, 1);
      await page
        .getByRole("button", { name: "移除会话专家", exact: true })
        .click();
      await page
        .getByLabel("当前会话的专家", { exact: true })
        .waitFor({ state: "hidden" });
      const removed = await (
        await context.request.get(origin + "/api/threads/" + threadId)
      ).json();
      assert.equal(removed.extensions.expertId, null);
      await page.screenshot({
        path: resolve(output, "expert-disabled-draft.png"),
      });
    },
  );
  await check(
    "expert unavailable details, removal and responsive extensions in light and dark themes",
    async () => {
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name: "扩展", exact: true })
        .click();
      const settings = page.getByRole("dialog", { name: "设置", exact: true });
      await settings
        .getByRole("button", { name: "查看专家 审查专家", exact: true })
        .click();
      const detail = page.getByRole("dialog", {
        name: "审查专家",
        exact: true,
      });
      await detail.getByText("插件“测试插件”不可用", { exact: true }).waitFor();
      await detail.getByRole("button", { name: "关闭", exact: true }).click();
      for (const theme of ["light", "dark"]) {
        await page.evaluate((theme) => {
          localStorage.setItem("theme", theme);
          document.documentElement.dataset.theme = theme;
        }, theme);
        await page.emulateMedia({ colorScheme: theme });
        await page.setViewportSize({ width: 390, height: 844 });
        const bounds = await settings.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
        assert.ok(
          await settings.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
        );
        await settings.screenshot({
          path: resolve(output, `extensions-mobile-${theme}.png`),
        });
      }
      await settings
        .getByRole("button", { name: "审查专家 更多操作", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "删除", exact: true }).click();
      const confirm = page.getByRole("dialog", {
        name: "删除“审查专家”？",
        exact: true,
      });
      await confirm.getByRole("button", { name: "删除", exact: true }).click();
      await confirm.waitFor({ state: "hidden" });
      await settings
        .getByRole("button", { name: "创建专家", exact: true })
        .waitFor();
    },
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify({ fixture: true, stage, checks, metrics, errors }, null, 2) +
      "\n",
  );
} catch (error) {
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify(
      { current, error: String(error), stack: error.stack, checks, errors },
      null,
      2,
    ),
  );
  if (page)
    await page
      .screenshot({ path: resolve(output, "failure.png") })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await exited;
}
