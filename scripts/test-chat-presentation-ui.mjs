import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  output = resolve(".data/chat-presentation-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const f of ["result.json", "failure.json"])
  rmSync(resolve(output, f), { force: true });
const port = Number(process.env.CHAT_PRESENTATION_TEST_PORT || 3134),
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/chat-presentation-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_TRANSPORT: "poll",
      CHAT_PRESENTATION_TEST_PORT: String(port),
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
    if (log.includes("Chat presentation UI fixture ready")) {
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
    viewport: { width: 1280, height: 1100 },
    reducedMotion: "reduce",
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value) => {
          if (window.__denyCopy) throw new Error("denied");
          window.__copied = value;
        },
      },
    });
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  const control = async (action) =>
    (
      await context.request.post(origin + "/api/test/chat", {
        headers: { origin },
        data: { action },
      })
    ).json();
  const send = async (text) => {
    const input = page.getByPlaceholder("询问任何问题");
    await input.fill(text);
    await input.press("Enter");
  };
  const newChat = async () => {
    const expand = page.getByRole("button", { name: "展开侧栏", exact: true });
    if (await expand.isVisible()) await expand.click();
    await page.getByRole("button", { name: /^新聊天/ }).click();
    await page.getByPlaceholder("询问任何问题").waitFor();
  };
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("chat-ui-fixture-login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByPlaceholder("询问任何问题").waitFor();
  await check(
    "one turn presents Markdown, selected skills, files, MCP App and A2UI without raw dynamic tool entries",
    async () => {
      await page.getByRole("button", { name: "选择技能", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByRole("combobox", { name: "搜索技能", exact: true })
        .fill("代码审查");
      await dialog
        .getByRole("option")
        .filter({ hasText: "code-review" })
        .click();
      await page.waitForFunction(
        () =>
          document
            .querySelector('[role="option"][aria-selected="true"]')
            ?.getAttribute("aria-selected") === "true",
      );
      await dialog.getByRole("button", { name: "完成", exact: true }).click();
      await send("mixed");
      await page
        .getByRole("heading", { name: "混合回复", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "查看已指定技能 代码审查", exact: true })
        .waitFor();
      await page.getByRole("button", { name: /查看 notes.md/ }).waitFor();
      await page.getByRole("article", { name: "交互表单" }).waitFor();
      await page
        .frameLocator("iframe")
        .getByText("原始结果 mixed: CPU 25%", { exact: true })
        .waitFor();
      assert.equal(
        await page.locator("summary").filter({ hasText: "newbot_ui" }).count(),
        0,
      );
      assert.equal(await page.locator(".turn").count(), 1);
    },
  );
  await check(
    "declined native command is marked unexecuted instead of completed",
    async () => {
      const tool = page.locator(".tool-item").filter({ hasText: "执行命令" });
      assert.match(await tool.textContent(), /未执行/);
      assert.ok(
        !(await tool.locator("small").textContent()).includes("已完成"),
      );
    },
  );
  await check(
    "skill modal closes back to its original message action",
    async () => {
      const opener = page.getByRole("button", {
        name: "查看已指定技能 代码审查",
        exact: true,
      });
      await opener.click();
      const modal = page.getByRole("dialog", {
        name: "指定的技能",
        exact: true,
      });
      await modal
        .getByRole("heading", { name: "审查流程", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "hidden" });
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "查看已指定技能 代码审查",
      );
    },
  );
  await check(
    "file preview and close keep the source card and return keyboard focus",
    async () => {
      const opener = page.getByRole("button", { name: /查看 notes.md/ });
      await opener.click();
      const modal = page.getByRole("dialog");
      await modal
        .getByRole("heading", { name: "对话产物", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await modal.waitFor({ state: "hidden" });
      await page.waitForFunction(() =>
        document.activeElement
          ?.getAttribute("aria-label")
          ?.startsWith("查看 notes.md"),
      );
    },
  );
  await check(
    "unrelated message updates and form submission retain the existing App iframe",
    async () => {
      const before = await control("inspect");
      await control("update");
      await page.getByText("额外消息已到达。", { exact: true }).waitFor();
      const form = page.getByRole("article", { name: "交互表单" });
      await form.getByRole("button", { name: "创建任务", exact: true }).click();
      await page.getByText("混合表单已提交。", { exact: true }).waitFor();
      const after = await control("inspect");
      assert.equal(after.resources, before.resources);
      assert.equal(after.tools, 0);
      assert.equal(after.turns, 1);
      await page.screenshot({ path: resolve(output, "mixed-desktop.png") });
    },
  );
  await check(
    "clipboard rejection is local and success provides feedback without unhandled rejection",
    async () => {
      const message = page.getByRole("article", { name: "助手回复" }).filter({
        has: page.getByRole("heading", { name: "混合回复", exact: true }),
      });
      await page.evaluate(() => {
        window.__denyCopy = true;
      });
      await message
        .getByRole("button", { name: "复制回答", exact: true })
        .click();
      await message
        .getByText("复制失败，请手动选择文本。", { exact: true })
        .waitFor();
      assert.equal(await page.locator(".error-banner").count(), 0);
      await page.evaluate(() => {
        window.__denyCopy = false;
      });
      await message
        .getByRole("button", { name: "复制回答", exact: true })
        .click();
      await message.getByText("已复制", { exact: true }).waitFor();
      assert.match(await page.evaluate(() => window.__copied), /混合回复/);
    },
  );
  await check(
    "active conversation failure is shown once in its turn and stays the same after refresh",
    async () => {
      await newChat();
      await send("fail");
      await page.getByText("本次任务未完成。", { exact: true }).waitFor();
      assert.equal(await page.locator(".error-banner").count(), 0);
      assert.equal(
        await page.getByText("本次任务未完成。", { exact: true }).count(),
        1,
      );
      await page.reload();
      await page.getByText("本次任务未完成。", { exact: true }).waitFor();
      assert.equal(await page.locator(".error-banner").count(), 0);
    },
  );
  await check(
    "reading task status never dispatches another turn and failures stay local",
    async () => {
      const before = await control("inspect");
      await control("fail-reads");
      await page
        .getByRole("button", { name: "重新读取状态", exact: true })
        .click();
      await page
        .getByText("状态未能读取，请恢复连接后重试。", { exact: true })
        .waitFor();
      assert.equal(await page.locator(".error-banner").count(), 0);
      await control("restore-reads");
      await page
        .getByRole("button", { name: "重新读取状态", exact: true })
        .click();
      await page.getByText("状态已更新。", { exact: true }).waitFor();
      assert.equal((await control("inspect")).turns, before.turns);
    },
  );
  await check(
    "background failure offers its own thread and does not replace the current conversation",
    async () => {
      const before = await control("inspect");
      const current = await page.locator(".turn").getAttribute("data-turn-id");
      const response = await context.request.post(origin + "/api/agent/run", {
        headers: { origin },
        data: { requestId: crypto.randomUUID(), text: "background" },
      });
      assert.equal(response.status(), 200);
      const notice = page.getByRole("status", { name: "后台任务提示" });
      await notice.waitFor();
      assert.equal(
        await page.locator(".turn").getAttribute("data-turn-id"),
        current,
      );
      await notice
        .getByRole("button", { name: "查看对话", exact: true })
        .click();
      await notice.waitFor({ state: "hidden" });
      await page.getByText("本次任务未完成。", { exact: true }).waitFor();
      assert.equal((await control("inspect")).turns, before.turns + 1);
    },
  );
  await check(
    "mobile dark task feedback is readable, keyboard operable and does not overflow",
    async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.locator(".sidebar").waitFor({ state: "hidden" });
      const button = page.getByRole("button", {
        name: "重新读取状态",
        exact: true,
      });
      await button.focus();
      assert.ok((await button.boundingBox()).height >= 44);
      assert.ok(
        await button.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.x + r.width / 2,
            r.y + r.height / 2,
          );
          return hit === el || el.contains(hit);
        }),
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({ path: resolve(output, "failure-mobile.png") });
    },
  );
  await check(
    "malformed message is contained and local redisplay never re-executes the task",
    async () => {
      await page.setViewportSize({ width: 1280, height: 1100 });
      await newChat();
      await send("broken");
      await page
        .getByText("这条内容暂时无法显示，其他消息仍可使用。", { exact: true })
        .waitFor();
      const before = await control("inspect");
      await page
        .getByRole("button", { name: "重新显示内容", exact: true })
        .click();
      await page
        .getByText("这条内容暂时无法显示，其他消息仍可使用。", { exact: true })
        .waitFor();
      assert.equal((await control("inspect")).turns, before.turns);
      assert.equal(
        await page.getByPlaceholder("询问任何问题").isEnabled(),
        true,
      );
      assert.deepEqual(errors, []);
    },
  );
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      { checks, passed: checks.length, counts: await control("inspect") },
      null,
      2,
    ),
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
