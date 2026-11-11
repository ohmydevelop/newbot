import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(
  process.env.UI_EVIDENCE_DIR || ".issue/2026-11-09/evidence-02",
);
mkdirSync(output, { recursive: true });
for (const file of ["ui-result.json", "ui-failure.json", "failure.png"])
  rmSync(resolve(output, file), { force: true });
const port = Number(process.env.ISSUE_TEST_PORT || 3140),
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
const checks = [],
  errors = [];
const ready = new Promise((res, rej) => {
  const timer = setTimeout(() => rej(Error(log)), 15000);
  const collect = (d) => {
    log += d;
    if (log.includes("Issue UI fixture ready")) {
      clearTimeout(timer);
      res();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", () => {
    clearTimeout(timer);
    rej(Error(log));
  });
});
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
    colorScheme: "dark",
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.setDefaultTimeout(10000);
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("issue-fixture-login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  const input = page.getByRole("textbox", { name: "消息", exact: true });
  await input.waitFor();
  await check("one new-chat entry and unified model control", async () => {
    assert.equal(
      await page.getByRole("button", { name: /^新聊天/ }).count(),
      1,
    );
    await page.getByRole("button", { name: "选择模型与推理强度" }).waitFor();
    await page.screenshot({
      path: resolve(output, "home-desktop.png"),
      animations: "disabled",
    });
  });
  const png = readFileSync(".issue/2026-11-09/image-3.png");
  await check(
    "multiple image thumbnails precede text and open an accessible preview",
    async () => {
      await page.locator("input[type=file]").setInputFiles([
        { name: "first.png", mimeType: "image/png", buffer: png },
        { name: "second.png", mimeType: "image/png", buffer: png },
      ]);
      await page.waitForFunction(
        () => !document.querySelector(".attachment-state:not(.failed)"),
      );
      await page.locator(".image-attachment").last().waitFor();
      assert.equal(await page.locator(".image-attachment img").count(), 2);
      await page.waitForFunction(() =>
        Array.from(document.querySelectorAll(".image-attachment img")).every(
          (i) => i.naturalWidth > 0,
        ),
      );
      await page
        .getByRole("button", { name: "预览 first.png", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "first.png", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "移除 second.png", exact: true })
        .click();
      assert.equal(await page.locator(".image-attachment").count(), 1);
    },
  );
  await check(
    "drag and clipboard paste add image previews to the active draft",
    async () => {
      for (const kind of ["drop", "paste"]) {
        await page.evaluate(
          ({ kind, b64 }) => {
            const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)),
              dt = new DataTransfer();
            dt.items.add(
              new File([bytes], kind + ".png", { type: "image/png" }),
            );
            if (kind === "drop") {
              const form = document.querySelector(".composer");
              form.dispatchEvent(
                new DragEvent("dragover", {
                  bubbles: true,
                  cancelable: true,
                  dataTransfer: dt,
                }),
              );
              form.dispatchEvent(
                new DragEvent("drop", {
                  bubbles: true,
                  cancelable: true,
                  dataTransfer: dt,
                }),
              );
            } else
              document.querySelector("#message-input").dispatchEvent(
                new ClipboardEvent("paste", {
                  bubbles: true,
                  cancelable: true,
                  clipboardData: dt,
                }),
              );
          },
          { kind, b64: png.toString("base64") },
        );
        await page
          .getByRole("button", { name: "预览 " + kind + ".png", exact: true })
          .waitFor();
        await page.waitForFunction(
          () => !document.querySelector(".attachment-state:not(.failed)"),
        );
        await page
          .getByRole("button", { name: "移除 " + kind + ".png", exact: true })
          .click();
      }
    },
  );
  await check("Markdown attachments open a safe file preview", async () => {
    await page.locator("input[type=file]").setInputFiles({
      name: "note.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# 附件预览\n\n| 名称 | 状态 |\n| --- | --- |\n| 测试 | 正常 |\n\n<script>window.ATTACHMENT_XSS=true</script>",
      ),
    });
    await page.waitForFunction(
      () => !document.querySelector(".attachment-state:not(.failed)"),
    );
    await page
      .getByRole("button", { name: "预览 note.md", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "note.md", exact: true })
      .getByRole("heading", { name: "附件预览", exact: true })
      .waitFor();
    assert.equal(await page.evaluate(() => window.ATTACHMENT_XSS), undefined);
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "移除 note.md", exact: true })
      .click();
  });
  await check(
    "failed uploads remain retryable and prevent Enter from dispatching",
    async () => {
      await page.route("**/api/attachments?name=retry.png", (route) =>
        route.fulfill({
          status: 503,
          contentType: "application/json",
          body: '{"error":"temporary failure"}',
        }),
      );
      await page.locator("input[type=file]").setInputFiles({
        name: "retry.png",
        mimeType: "image/png",
        buffer: png,
      });
      await page.getByRole("button", { name: "重试", exact: true }).waitFor();
      await input.fill("保留失败附件");
      await input.press("Enter");
      assert.equal(
        (await (await context.request.get(origin + "/api/test/issue")).json())
          .calls.length,
        0,
      );
      await page.unroute("**/api/attachments?name=retry.png");
      await page.getByRole("button", { name: "重试", exact: true }).click();
      await page
        .getByRole("button", { name: "重试", exact: true })
        .waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "移除 retry.png", exact: true })
        .click();
    },
  );
  await check(
    "$ skill selection uses keyboard and @ adds a real plugin reference",
    async () => {
      await input.fill("$code");
      await page.getByRole("listbox", { name: "可选技能" }).waitFor();
      await input.press("ArrowDown");
      await input.press("Enter");
      await page.getByLabel("下一条消息的技能").waitFor();
      await input.fill("@test");
      await page.getByRole("listbox", { name: "可选插件" }).waitFor();
      await page.getByRole("option", { name: /测试插件/ }).waitFor();
      await input.press("Enter");
      await page.getByLabel("下一条消息的插件").waitFor();
    },
  );
  await input.fill("图片、技能和插件测试");
  await page.screenshot({
    animations: "disabled",
    path: resolve(output, "composer-desktop.png"),
  });
  await check(
    "process defaults collapsed, time advances and final reply stays visible",
    async () => {
      await input.press("Enter");
      const toggle = page.locator(".process-toggle");
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute("aria-expanded"), "false");
      await page.waitForTimeout(1050);
      assert.match(await toggle.innerText(), /秒/);
      await page.getByText("测试回复完成。", { exact: true }).waitFor();
      assert.equal(
        await page.getByText("正在检查测试数据。", { exact: true }).isVisible(),
        false,
      );
      await toggle.click();
      await page.getByText("正在检查测试数据。", { exact: true }).waitFor();
      await toggle.click();
      const state = await (
        await context.request.get(origin + "/api/test/issue")
      ).json();
      assert.ok(state.calls[0].input.some((i) => i.type === "skill"));
      assert.ok(
        state.calls[0].input.some(
          (i) =>
            i.type === "mention" && i.path === "plugin://test-plugin@local",
        ),
      );
    },
  );
  await check("history images preview after refresh", async () => {
    await page.reload();
    await page
      .getByRole("button", { name: "预览 first.png", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "first.png", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
  });
  await check(
    "workspace file selection is available only through the composer plus menu",
    async () => {
      assert.equal(
        await page
          .getByRole("button", { name: "添加工作区文件", exact: true })
          .count(),
        0,
      );
      await page.getByRole("button", { name: "添加附件", exact: true }).click();
      await page
        .getByRole("menuitem", { name: "添加工作区文件", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "添加工作区文件", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await page
        .getByRole("dialog", { name: "添加工作区文件", exact: true })
        .waitFor({ state: "hidden" });
    },
  );
  await check(
    "same-thread provider change and full-access selection persist",
    async () => {
      const before = await (
        await context.request.get(origin + "/api/threads")
      ).json();
      await page.getByRole("button", { name: "选择模型与推理强度" }).click();
      await page.getByLabel("搜索网关或模型").fill("第二网关");
      await page
        .getByRole("option")
        .filter({ hasText: "secondary-model" })
        .click();
      await page
        .getByRole("button", { name: "选择模型与推理强度" })
        .filter({ hasText: "secondary-model" })
        .waitFor();
      const after = await (
        await context.request.get(origin + "/api/threads")
      ).json();
      assert.equal(after.length, before.length);
      assert.equal(after[0].id, before[0].id);
      assert.equal(after[0].provider, "secondary");
      await page.getByRole("button", { name: "会话审批：请求批准" }).click();
      await page
        .getByRole("menuitemradio", { name: "完全访问权限", exact: true })
        .click();
      await page
        .getByRole("button", { name: "会话审批：完全访问权限" })
        .waitFor();
      await page.reload();
      await page
        .getByRole("button", { name: "会话审批：完全访问权限" })
        .waitFor();
    },
  );
  const account = () => page.getByRole("button", { name: /个人工作台/ });
  await check(
    "skills use compact equal-height rows with row-click details and protected-source uninstall",
    async () => {
      await account().click();
      await page.getByRole("button", { name: "技能", exact: true }).click();
      await page.getByLabel("搜索已安装技能").waitFor();
      const heights = await page
        .locator(".skill-list-row")
        .evaluateAll((rows) =>
          rows.map((r) => r.getBoundingClientRect().height),
        );
      assert.ok(heights.every((h) => Math.abs(h - heights[0]) < 1));
      await page.getByLabel("搜索已安装技能").fill("code-review");
      assert.equal(await page.locator(".skill-list-row").count(), 1);
      assert.ok(heights.every((h) => h <= 96));
      await page
        .getByRole("button", { name: "查看 code-review 说明", exact: true })
        .click();
      await page
        .getByRole("button", { name: "返回技能列表", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: "卸载 code-review", exact: true })
          .isDisabled(),
        true,
      );
      await page.getByLabel("搜索已安装技能").fill("");
      await page.screenshot({
        animations: "disabled",
        path: resolve(output, "skills-desktop.png"),
      });
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "one tools page groups plugin-owned connections and keeps independent MCP actions available before testing",
    async () => {
      await account().click();
      await page.getByRole("button", { name: "工具连接", exact: true }).click();
      const tools = page.getByRole("region", { name: "工具与插件管理" });
      await tools
        .getByRole("button", { name: "查看 测试插件", exact: true })
        .waitFor();
      assert.equal(
        await tools
          .getByRole("button", { name: "查看 test-server", exact: true })
          .count(),
        0,
      );
      await tools
        .getByRole("button", { name: "offline 更多操作", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
      await page
        .getByRole("dialog", { name: "编辑 offline", exact: true })
        .waitFor();
      await page.keyboard.press("Escape");
      await tools
        .getByRole("button", { name: "查看 测试插件", exact: true })
        .click();
      await page.getByText("插件详细说明", { exact: true }).waitFor();
      await page
        .getByRole("button", { name: "查看 test-server", exact: true })
        .click();
      await page
        .getByRole("region", { name: "工具目录", exact: true })
        .waitFor();
      await page.getByText("metrics", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.screenshot({
        animations: "disabled",
        path: resolve(output, "tools-desktop.png"),
      });
      await page.keyboard.press("Escape");
    },
  );
  await check("gateway settings use a single list with defaults", async () => {
    await account().click();
    await page.getByRole("button", { name: "网关", exact: true }).click();
    await page.getByLabel("第二网关 默认模型").waitFor();
    assert.equal(await page.locator(".gateway-card").count(), 2);
    await page.getByLabel("第二网关 默认模型").selectOption("secondary-model");
    await page.getByLabel("第二网关 默认模型").waitFor();
    await page.screenshot({
      animations: "disabled",
      path: resolve(output, "gateways-desktop.png"),
    });
    await page.keyboard.press("Escape");
  });
  await check(
    "gateway and connector editors open focused dialogs and cancel without changes",
    async () => {
      await account().click();
      await page.getByRole("button", { name: "网关", exact: true }).click();
      await page
        .getByRole("button", { name: "添加网关", exact: true })
        .click();
      await page
        .getByRole("dialog", { name: "添加网关", exact: true })
        .getByLabel("名称", { exact: true })
        .fill("临时网关");
      await page.keyboard.press("Escape");
      await page
        .getByRole("dialog", { name: "添加网关", exact: true })
        .waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "工具连接", exact: true }).click();
      await page
        .getByRole("button", { name: "offline 更多操作", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "编辑", exact: true }).click();
      await page
        .getByRole("dialog", { name: "编辑 offline", exact: true })
        .waitFor();
      await page.waitForFunction(
        (el) => el.contains(document.activeElement),
        await page
          .getByRole("dialog", { name: "编辑 offline", exact: true })
          .elementHandle(),
      );
      await page.keyboard.press("Escape");
      await page
        .getByRole("dialog", { name: "编辑 offline", exact: true })
        .waitFor({ state: "hidden" });
      await page
        .getByRole("dialog", { name: "设置", exact: true })
        .waitFor({ state: "visible" });
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "plugins install, toggle and uninstall through the unified page without model calls",
    async () => {
      await account().click();
      await page.getByRole("button", { name: "工具连接", exact: true }).click();
      await page
        .getByRole("button", { name: "查看 测试插件", exact: true })
        .click();
      const detail = page.getByRole("dialog", {
        name: "测试插件",
        exact: true,
      });
      await detail.getByRole("button", { name: "停用", exact: true }).click();
      await detail.getByRole("button", { name: "启用", exact: true }).waitFor();
      await detail.getByRole("button", { name: "启用", exact: true }).click();
      await detail.getByRole("button", { name: "停用", exact: true }).waitFor();
      await detail.getByRole("button", { name: "卸载", exact: true }).click();
      const confirm = page.getByRole("dialog", {
        name: "卸载 测试插件",
        exact: true,
      });
      await confirm.getByRole("button", { name: "卸载", exact: true }).click();
      await confirm.waitFor({ state: "hidden" });
      await detail.getByRole("button", { name: "安装", exact: true }).click();
      await detail.getByRole("button", { name: "卸载", exact: true }).waitFor();
      assert.equal(
        (await (await context.request.get(origin + "/api/test/issue")).json())
          .calls.length,
        1,
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "a custom gateway default applies to new chats without replacing the current conversation model",
    async () => {
      await page.getByRole("button", { name: "选择模型与推理强度" }).click();
      await page.getByLabel("搜索网关或模型").fill("第二网关");
      await page.getByRole("option").filter({ hasText: "测试模型" }).click();
      const picker = page.getByRole("button", { name: "选择模型与推理强度" });
      await picker.filter({ hasText: "测试模型" }).waitFor();
      await account().click();
      await page.getByRole("button", { name: "网关", exact: true }).click();
      const gateway = page
        .locator(".gateway-card")
        .filter({ hasText: "第二网关" });
      await page
        .getByLabel("第二网关 默认模型")
        .selectOption("secondary-model");
      await gateway
        .getByRole("button", { name: "设为默认", exact: true })
        .click();
      await gateway.getByLabel("当前默认网关", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await picker.filter({ hasText: "测试模型" }).waitFor();
      await page.getByRole("button", { name: /^新聊天/ }).click();
      await picker.filter({ hasText: "secondary-model" }).waitFor();
      await page.getByRole("button", { name: "会话审批：请求批准" }).waitFor();
      await input.fill("custom default model acceptance");
      await input.press("Enter");
      await page.getByText("测试回复完成。", { exact: true }).waitFor();
      const state = await (
        await context.request.get(origin + "/api/test/issue")
      ).json();
      assert.equal(state.calls.length, 2);
      assert.equal(state.calls.at(-1).model, "secondary-model");
      assert.equal(state.calls.at(-1).approvalPolicy, "on-request");
    },
  );
  await check(
    "gateway editing hides internal IDs, has balanced spacing and stores keys through a private binary channel",
    async () => {
      const secret = "SYNTHETIC_BROWSER_KEY_02";
      const ordinary = [];
      const watcher = (r) => {
        if (r.url().includes("/api/") && !r.url().includes("/input"))
          ordinary.push(r.postData() || "");
      };
      page.on("request", watcher);
      await account().click();
      await page.getByRole("button", { name: "网关", exact: true }).click();
      assert.equal(
        await page.locator(".gateway-head, .gateway-details").count(),
        0,
      );
      await page
        .getByRole("button", { name: "刷新网关", exact: true })
        .waitFor();
      await page
        .getByRole("button", { name: "添加网关", exact: true })
        .click();
      const form = page.getByRole("dialog", {
        name: "添加网关",
        exact: true,
      });
      assert.equal(
        await form.getByLabel("网关标识", { exact: true }).count(),
        0,
      );
      assert.equal(
        await form.getByLabel("凭证环境变量引用", { exact: true }).count(),
        0,
      );
      assert.equal(
        await form
          .getByRole("button", { name: "取消编辑", exact: true })
          .count(),
        0,
      );
      await form.getByLabel("名称", { exact: true }).fill("我的密钥网关");
      await form
        .getByLabel("连接地址", { exact: true })
        .fill("https://fixture-gateway.invalid/v1");
      await form.getByLabel("API Key", { exact: true }).fill(secret);
      const bounds = await form.locator("form").evaluate((el) => {
        const r = el.getBoundingClientRect(),
          i = el.querySelector("input").getBoundingClientRect();
        return { left: i.left - r.left, right: r.right - i.right };
      });
      assert.ok(bounds.left >= 16 && bounds.right >= 16);
      await page.screenshot({
        animations: "disabled",
        path: resolve(output, "gateway-editor-desktop.png"),
      });
      await form
        .getByRole("button", { name: "保存并获取模型", exact: true })
        .click();
      await form
        .getByText("网关已保存，模型列表未能获取。检查连接后可重试。", {
          exact: false,
        })
        .waitFor();
      await form
        .getByRole("button", { name: "关闭", exact: true })
        .last()
        .click();
      await form.waitFor({ state: "hidden" });
      await page
        .getByRole("button", { name: "编辑 我的密钥网关", exact: true })
        .waitFor();
      page.off("request", watcher);
      assert.ok(ordinary.every((body) => !body.includes(secret)));
      assert.ok(
        !(await page.evaluate(() =>
          JSON.stringify(localStorage).includes("SYNTHETIC_BROWSER_KEY_02"),
        )),
      );
      await page
        .getByRole("button", { name: "编辑 我的密钥网关", exact: true })
        .click();
      const edit = page.getByRole("dialog", {
        name: "我的密钥网关",
        exact: true,
      });
      assert.equal(
        await edit.getByLabel("API Key", { exact: true }).inputValue(),
        "",
      );
      await edit
        .getByRole("button", { name: "清除已保存密钥", exact: true })
        .click();
      await edit
        .getByRole("group", { name: "确认清除密钥" })
        .getByRole("button", { name: "清除", exact: true })
        .click();
      await edit
        .getByRole("group", { name: "确认清除密钥" })
        .waitFor({ state: "hidden" });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "a lost key-save response is reconciled by reading the ticket without resending a secret or creating duplicates",
    async () => {
      await account().click();
      await page.getByRole("button", { name: "网关", exact: true }).click();
      const count = await page.locator(".gateway-card").count();
      await page
        .getByRole("button", { name: "添加网关", exact: true })
        .click();
      const form = page.getByRole("dialog", {
        name: "添加网关",
        exact: true,
      });
      await form.getByLabel("名称", { exact: true }).fill("回执恢复网关");
      await form
        .getByLabel("连接地址", { exact: true })
        .fill("https://fixture-receipt.invalid/v1");
      await form
        .getByLabel("API Key", { exact: true })
        .fill("SYNTHETIC_LOST_RECEIPT_KEY");
      let posts = 0;
      await page.route("**/api/credentials/*/input", async (route) => {
        posts++;
        await route.fetch();
        await route.abort("failed");
      });
      await form
        .getByRole("button", { name: "保存并获取模型", exact: true })
        .click();
      await form.getByRole("alert").waitFor();
      assert.equal(
        await form.getByLabel("API Key", { exact: true }).inputValue(),
        "",
      );
      await page.unroute("**/api/credentials/*/input");
      await form.getByRole("button", { name: "读取状态", exact: true }).click();
      await form
        .getByText("网关已保存，模型列表未能获取。检查连接后可重试。", {
          exact: false,
        })
        .waitFor();
      await form
        .getByRole("button", { name: "关闭", exact: true })
        .last()
        .click();
      await form.waitFor({ state: "hidden" });
      assert.equal(posts, 1);
      assert.equal(await page.locator(".gateway-card").count(), count + 1);
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "standalone personal skills uninstall with confirmation and remain absent after refresh",
    async () => {
      await account().click();
      await page.getByRole("button", { name: "技能", exact: true }).click();
      await page.getByLabel("搜索已安装技能").fill("personal-note");
      await page
        .getByRole("button", { name: "卸载 personal-note", exact: true })
        .click();
      const dialog = page.getByRole("dialog", {
        name: "卸载 personal-note",
        exact: true,
      });
      await dialog.getByRole("button", { name: "卸载", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(
        await page
          .getByRole("button", { name: "查看 personal-note 说明", exact: true })
          .count(),
        0,
      );
      await page.getByRole("button", { name: "刷新技能", exact: true }).click();
      await page.getByText("没有匹配的技能", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "an implicit account gateway opens a read-only detail instead of a create form",
    async () => {
      const before = await (
        await context.request.get(origin + "/api/config")
      ).json();
      const switched = await context.request.post(
        origin + "/api/agent/action",
        {
          headers: { origin },
          data: {
            action: "provider/switch",
            provider: "openai",
            expectedRevision: before.configuration.revision,
          },
        },
      );
      assert.equal(switched.status(), 200);
      await account().click();
      await page.getByRole("button", { name: "网关", exact: true }).click();
      await page
        .getByRole("button", { name: "刷新网关", exact: true })
        .click();
      await page
        .getByRole("button", { name: "编辑 OpenAI", exact: true })
        .click();
      const detail = page.getByRole("dialog", { name: "OpenAI", exact: true });
      await detail.waitFor();
      assert.equal(
        await detail.getByLabel("名称", { exact: true }).isDisabled(),
        true,
      );
      assert.equal(
        await detail
          .getByRole("button", { name: "保存并获取模型", exact: true })
          .count(),
        0,
      );
      assert.equal(
        await detail.getByLabel("API Key", { exact: true }).count(),
        0,
      );
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      const after = await (
        await context.request.get(origin + "/api/config")
      ).json();
      const restore = await context.request.post(origin + "/api/agent/action", {
        headers: { origin },
        data: {
          action: "provider/switch",
          provider: before.configuration.defaults.provider,
          expectedRevision: after.configuration.revision,
        },
      });
      assert.equal(restore.status(), 200);
    },
  );
  await check(
    "gateway, tools and skill settings fit mobile in both themes and the editor remains scrollable in landscape",
    async () => {
      for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width: 375, height: 812 });
        await page.reload();
        await input.waitFor();
        await page
          .getByRole("button", { name: "展开侧栏", exact: true })
          .waitFor();
        if (!(await account().isVisible()))
          await page
            .getByRole("button", { name: "展开侧栏", exact: true })
            .click();
        await account().click();
        await page.getByLabel("外观", { exact: true }).selectOption(theme);
        for (const [label, image] of [
          ["网关", "gateways"],
          ["技能", "skills"],
          ["工具连接", "tools"],
        ]) {
          await page.getByRole("button", { name: label, exact: true }).click();
          if (image === "skills")
            await page.locator(".skill-list-row").first().waitFor();
          if (image === "gateways")
            await page.locator(".gateway-card").first().waitFor();
          if (image === "tools")
            await page
              .getByRole("button", { name: "查看 测试插件", exact: true })
              .waitFor();
          await page.screenshot({
            path: resolve(output, `${image}-mobile-${theme}.png`),
            animations: "disabled",
          });
          assert.ok(
            await page
              .locator(".settings-content")
              .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          );
        }
        await page
          .getByRole("button", { name: "网关", exact: true })
          .click();
        await page
          .getByRole("button", { name: "添加网关", exact: true })
          .click();
        const editor = page.getByRole("dialog", {
          name: "添加网关",
          exact: true,
        });
        await editor.getByLabel("名称", { exact: true }).fill("手机网关草稿");
        await page.screenshot({
          path: resolve(output, `editor-mobile-${theme}.png`),
          animations: "disabled",
        });
        await page.setViewportSize({ width: 812, height: 375 });
        const save = editor.getByRole("button", {
          name: "保存并获取模型",
          exact: true,
        });
        await save.scrollIntoViewIfNeeded();
        const rect = await save.boundingBox();
        assert.ok(rect.y >= 0 && rect.y + rect.height <= 375);
        await page.keyboard.press("Escape");
        await page.keyboard.press("Escape");
      }
    },
  );
  await check(
    "mobile and both themes fit without horizontal scrolling",
    async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.reload();
      await input.waitFor();
      for (const theme of ["light", "dark"]) {
        if (!(await account().isVisible()))
          await page
            .getByRole("button", { name: "展开侧栏", exact: true })
            .click();
        await account().click();
        await page.getByLabel("外观", { exact: true }).selectOption(theme);
        await page.keyboard.press("Escape");
        await page
          .getByRole("dialog", { name: "设置", exact: true })
          .waitFor({ state: "hidden" });
        if (
          await page
            .getByRole("button", { name: "收起侧栏", exact: true })
            .isVisible()
        )
          await page
            .getByRole("button", { name: "收起侧栏", exact: true })
            .click();
        await page
          .getByRole("dialog", { name: "对话导航", exact: true })
          .waitFor({ state: "hidden" });

        await page.screenshot({
          animations: "disabled",
          path: resolve(output, `chat-mobile-${theme}.png`),
        });
        const controls = await page
          .locator(".composer-tools button")
          .evaluateAll((nodes) =>
            nodes.map((n) => {
              const b = n.getBoundingClientRect();
              return {
                x: b.x,
                right: b.right,
                width: b.width,
                height: b.height,
              };
            }),
          );
        assert.ok(controls.every((b) => b.width >= 40 && b.height >= 40));
        for (let i = 1; i < controls.length; i++)
          assert.ok(
            controls[i].x >= controls[i - 1].right - 1,
            "composer controls must not overlap",
          );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
      }
    },
  );
  assert.deepEqual(errors, []);
  writeFileSync(
    resolve(output, "ui-result.json"),
    JSON.stringify({ checks, errors }, null, 2),
  );
} catch (e) {
  if (page)
    await page
      .screenshot({ path: resolve(output, "failure.png") })
      .catch(() => {});
  writeFileSync(
    resolve(output, "ui-failure.json"),
    JSON.stringify({ checks, error: String(e), errors, log }, null, 2),
  );
  throw e;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await new Promise((r) =>
    server.exitCode !== null ? r() : server.once("exit", r),
  );
}
