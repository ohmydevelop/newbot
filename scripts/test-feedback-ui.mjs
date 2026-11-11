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
const stage = process.env.FEEDBACK_STAGE || "search";
const output = resolve(
  process.env.UI_EVIDENCE_DIR || ".issue/2026-11-10/evidence-search-feedback",
  stage,
);
const candidate = resolve(
  process.env.UI_TEST_CANDIDATE || ".data/issue-feedback-web",
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
  const threads = [];
  for (const title of ["Alpha History", "Beta Chat"]) {
    const response = await context.request.post(origin + "/api/agent/run", {
      headers: { origin },
      data: {
        requestId: crypto.randomUUID(),
        text: title,
        provider: "fixture",
        model: "fixture-model",
      },
    });
    assert.equal(response.status(), 200, await response.text());
    const run = await response.json();
    for (let i = 0; i < 50; i++) {
      const thread = await (
        await context.request.get(origin + "/api/threads/" + run.threadId)
      ).json();
      if (!thread.turns.some((t) => t.status === "inProgress")) break;
      if (i === 49) throw Error("Fixture turn did not finish");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await action("thread/name/set", { threadId: run.threadId, name: title });
    threads.push(run.threadId);
  }
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(origin);
  await page
    .locator(".history-link")
    .getByText("Alpha History", { exact: true })
    .waitFor();
  const search = () =>
    page.getByRole("dialog", { name: "搜索聊天", exact: true });
  if (stage === "search") {
    await check(
      "cached search refresh keeps input, results and sidebar anchored",
      async () => {
        const start = deferred(),
          finish = deferred();
        await page.route(
          "**/api/threads",
          async (route) => {
            start.resolve();
            await finish.promise;
            await route.continue();
          },
          { times: 1 },
        );
        await page.getByRole("button", { name: /^搜索聊天/ }).click();
        await start.promise;
        await search().getByRole("status").waitFor();
        const before = {
          input: await search().getByLabel("搜索对话").boundingBox(),
          result: await search()
            .locator(".search-results > button")
            .first()
            .boundingBox(),
          sidebar: await page.locator(".history-link").first().boundingBox(),
        };
        assert.equal(
          await search().getByText("搜索已保存的对话名称").count(),
          0,
        );
        finish.resolve();
        await search().getByRole("status").waitFor({ state: "hidden" });
        const after = {
          input: await search().getByLabel("搜索对话").boundingBox(),
          result: await search()
            .locator(".search-results > button")
            .first()
            .boundingBox(),
          sidebar: await page.locator(".history-link").first().boundingBox(),
        };
        for (const key of Object.keys(before))
          stable(before[key], after[key], key);
        metrics.push({ before, after });
      },
    );
    await check(
      "normalized search, no result and retry preserve results and focus",
      async () => {
        await search().getByLabel("搜索对话").fill("  ＡＬＰＨＡ  ");
        assert.equal(
          await search().locator(".search-results > button").count(),
          1,
        );
        await search().getByLabel("搜索对话").fill("no-such-title");
        await search().getByText("没有找到匹配的对话").waitFor();
        await search().getByLabel("搜索对话").press("Escape");
        await page.route("**/api/threads", (route) => route.abort("failed"), {
          times: 1,
        });
        await page.getByRole("button", { name: /^搜索聊天/ }).click();
        await search().getByRole("alert").waitFor();
        await search().getByLabel("搜索对话").fill("");
        assert.equal(
          await search().locator(".search-results > button").count(),
          2,
        );
        await search()
          .getByRole("button", { name: "重试", exact: true })
          .click();
        await search().getByRole("alert").waitFor({ state: "hidden" });
      },
    );
    await check(
      "desktop and mobile themes retain search geometry and keyboard dismissal",
      async () => {
        for (const width of [1440, 390])
          for (const theme of ["dark", "light"]) {
            await page.setViewportSize({ width, height: 900 });
            await page.emulateMedia({ colorScheme: theme });
            const box = await search().boundingBox();
            assert.ok(box.x >= 0 && box.x + box.width <= width);
            assert.ok(box.y >= 0 && box.y + box.height <= 900);
            await search().screenshot({
              path: resolve(output, `search-${width}-${theme}.png`),
            });
          }
        await search().getByLabel("搜索对话").press("Escape");
        assert.equal(await search().count(), 0);
      },
    );
  }
  if (stage === "pickers") {
    await page
      .locator(".history-link")
      .getByText("Alpha History", { exact: true })
      .click();
    await page.locator(".process-toggle").waitFor();
    const model = () =>
      page.getByRole("dialog", { name: "选择模型与推理强度", exact: true });
    await check(
      "reasoning save keeps picker and slider fixed while actual value commits",
      async () => {
        await page
          .getByRole("button", { name: "选择模型与推理强度", exact: true })
          .click();
        const high = model().getByRole("button", {
          name: "推理强度：高",
          exact: true,
        });
        await high.waitFor();
        await page.waitForFunction(
          () => !document.querySelector('[aria-label="推理强度：高"]').disabled,
        );
        const before = {
          panel: await model().boundingBox(),
          input: await model().getByRole("searchbox").boundingBox(),
          slider: await model().getByRole("slider").boundingBox(),
        };
        const started = deferred(),
          finish = deferred();
        await page.route("**/api/agent/action", async (route) => {
          if (route.request().postDataJSON()?.action === "session/update") {
            started.resolve();
            await finish.promise;
          }
          await route.continue();
        });
        await high.click();
        await started.promise;
        stable(before.panel, await model().boundingBox(), "busy panel");
        stable(
          before.input,
          await model().getByRole("searchbox").boundingBox(),
          "busy search",
        );
        finish.resolve();
        await page.waitForFunction(
          () =>
            document
              .querySelector('[aria-label="推理强度：高"]')
              ?.getAttribute("aria-pressed") === "true",
        );
        stable(before.panel, await model().boundingBox(), "settled panel");
        stable(
          before.input,
          await model().getByRole("searchbox").boundingBox(),
          "settled search",
        );
        await page.unroute("**/api/agent/action");
        await model().getByRole("button", { name: "关闭模型选择器" }).click();
      },
    );
    await check(
      "approval chip, checked item and explanatory copy follow all three presets",
      async () => {
        for (const label of [
          "完全访问权限",
          "帮我批准",
          "请求批准",
          "完全访问权限",
        ]) {
          await page.getByRole("button", { name: /^会话审批：/ }).click();
          const choice = page.getByRole("menuitemradio", {
            name: label,
            exact: true,
          });
          await page.waitForFunction((label) => {
            const el = document.querySelector(
              `[role="menuitemradio"][aria-label="${label}"]`,
            );
            return el && !el.hasAttribute("data-disabled");
          }, label);
          await choice.click();
          await page
            .getByRole("button", { name: "会话审批：" + label, exact: true })
            .waitFor();
        }
        const chip = page.getByRole("button", {
          name: "会话审批：完全访问权限",
          exact: true,
        });
        assert.equal(await chip.locator("svg.lucide-shield-alert").count(), 1);
        await chip.click();
        assert.equal(
          await page
            .getByRole("menuitemradio", { name: "完全访问权限", exact: true })
            .getAttribute("aria-checked"),
          "true",
        );
        await page
          .getByText("访问服务器文件与网络，无需执行审批", {
            exact: true,
          })
          .waitFor();
        for (const width of [1440, 390])
          for (const theme of ["dark", "light"]) {
            await page.setViewportSize({ width, height: 900 });
            await page.emulateMedia({ colorScheme: theme });
            const menu = page.locator(".approval-menu");
            await page.waitForFunction((width) => {
              const box = document
                .querySelector(".approval-menu")
                ?.getBoundingClientRect();
              return box && box.x >= 0 && box.right <= width;
            }, width);
            const box = await menu.boundingBox();
            assert.ok(box.x >= 0 && box.x + box.width <= width);
            await menu.screenshot({
              path: resolve(output, `approval-${width}-${theme}.png`),
            });
          }
        // Three immediate choices, with no extra help layer in this private UI.
        assert.equal(await page.getByRole("menuitem").count(), 0);
        await page.keyboard.press("Escape");
        await page.locator(".approval-menu").waitFor({ state: "hidden" });
        await page.waitForFunction(
          () =>
            document.activeElement?.getAttribute("aria-label") ===
            "会话审批：完全访问权限",
        );
      },
    );
    await check(
      "failed approval update preserves active preset and disabled policy explains why",
      async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await page.route("**/api/agent/action", (route) =>
          route.request().postDataJSON()?.action === "session/update"
            ? route.fulfill({
                status: 409,
                contentType: "application/json",
                body: JSON.stringify({ error: "审批设置已变化，请重试" }),
              })
            : route.continue(),
        );
        await page.getByRole("button", { name: /^会话审批：/ }).click();
        const ask = page.getByRole("menuitemradio", {
          name: "请求批准",
          exact: true,
        });
        await page.waitForFunction(
          () =>
            !document
              .querySelector('[role="menuitemradio"][aria-label="请求批准"]')
              .hasAttribute("data-disabled"),
        );
        await ask.click();
        await page
          .getByText("审批设置已变化，请重试", { exact: true })
          .waitFor();
        await page
          .getByRole("button", { name: "会话审批：完全访问权限", exact: true })
          .waitFor();
        await page.unroute("**/api/agent/action");
        await page.route("**/api/agent/action", (route) =>
          route.request().postDataJSON()?.action === "runtime/presets"
            ? route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify([
                  { id: "ask", allowed: true },
                  { id: "review", allowed: true },
                  {
                    id: "full",
                    allowed: false,
                    reason: "管理员策略禁止完全访问",
                  },
                ]),
              })
            : route.continue(),
        );
        await page.getByRole("button", { name: /^会话审批：/ }).click();
        await page
          .getByText("管理员策略禁止完全访问", { exact: true })
          .waitFor();
        assert.equal(
          await page
            .getByRole("menuitemradio", { name: "完全访问权限", exact: true })
            .getAttribute("aria-disabled"),
          "true",
        );
        await page.keyboard.press("Escape");
        await page.unroute("**/api/agent/action");
        await page
          .getByRole("button", { name: "关闭错误提示", exact: true })
          .click();
      },
    );
    await check(
      "skill and plugin pickers use compact search rows and stable cached refresh",
      async () => {
        for (const name of ["技能", "专家或插件"]) {
          await page
            .getByRole("button", { name: "选择" + name, exact: true })
            .click();
          const picker = page.getByRole("dialog", {
            name: "选择" + name,
            exact: true,
          });
          await picker.locator(".picker-results > button").first().waitFor();
          const before = await picker.getByRole("combobox").boundingBox();
          assert.ok(before.height <= 44);
          await picker
            .getByRole("button", { name: "刷新选择目录", exact: true })
            .click();
          await page.waitForFunction(
            () =>
              !document.querySelector('[aria-label="刷新选择目录"]').disabled,
          );
          stable(
            before,
            await picker.getByRole("combobox").boundingBox(),
            name + " search",
          );
          await picker.screenshot({
            path: resolve(output, `picker-${name}.png`),
          });
          await picker
            .getByRole("button", { name: "关闭选择器", exact: true })
            .click();
        }
      },
    );
  }
  if (stage === "settings") {
    await page.getByRole("button", { name: "个人工作台 私有实例" }).click();
    const settings = page.getByRole("dialog", { name: "设置", exact: true });
    await settings
      .getByRole("button", { name: "网关", exact: true })
      .click();
    await settings.locator(".gateway-card").first().waitFor();
    await check(
      "compact gateways omit storage implementation copy and preserve responsive actions",
      async () => {
        assert.equal(
          await settings
            .getByText("网关参数已保存到 SQLite", { exact: false })
            .count(),
          0,
        );
        for (const width of [1440, 390])
          for (const theme of ["light", "dark"]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.emulateMedia({ colorScheme: theme });
            await page.waitForFunction(
              (width) => document.documentElement.clientWidth === width,
              width,
            );
            const cards = await settings
              .locator(".gateway-card")
              .evaluateAll((elements) =>
                elements.map((el) => {
                  const b = el.getBoundingClientRect();
                  return { x: b.x, y: b.y, right: b.right, height: b.height };
                }),
              );
            assert.ok(cards.every((c) => c.x >= 0 && c.right <= width));
            if (width === 1440) assert.equal(cards[0].y, cards[1].y);
            else assert.ok(cards[1].y > cards[0].y);
            await settings.screenshot({
              path: resolve(output, `gateways-${width}-${theme}.png`),
            });
          }
      },
    );
    await check(
      "gateway save discovers models; discovery failure retries without rewriting configuration",
      async () => {
        await page.setViewportSize({ width: 1440, height: 1000 });
        await settings
          .getByRole("button", { name: "编辑 测试网关", exact: true })
          .click();
        let editor = page.getByRole("dialog", {
          name: "测试网关",
          exact: true,
        });
        assert.equal(
          await editor.getByText("临时验证当前凭证", { exact: true }).count(),
          0,
        );
        assert.equal(
          await editor.getByText("测试模型", { exact: true }).count(),
          0,
        );
        await editor.getByLabel("名称", { exact: true }).fill("紧凑网关");
        let writes = 0,
          fail = true;
        page.on("request", (req) => {
          if (
            req.url().endsWith("/api/config") &&
            req.method() === "POST" &&
            req.postDataJSON()?.action === "gateway/save"
          )
            writes++;
        });
        await page.route("**/api/agent/action", (route) =>
          route.request().postDataJSON()?.action === "provider/models" && fail
            ? route.fulfill({
                status: 503,
                contentType: "application/json",
                body: JSON.stringify({ error: "暂不可用" }),
              })
            : route.continue(),
        );
        await editor.screenshot({
          path: resolve(output, "gateway-editor.png"),
        });
        await editor
          .getByRole("button", { name: "保存并获取模型", exact: true })
          .click();
        editor = page.getByRole("dialog", { name: "紧凑网关", exact: true });
        await editor
          .getByText(
            "网关已保存，模型列表未能获取。可手动填写模型，或重试获取。",
            {
              exact: false,
            },
          )
          .waitFor();
        assert.equal(writes, 1);
        fail = false;
        await editor
          .getByRole("button", { name: "重试获取模型", exact: true })
          .click();
        await editor.waitFor({ state: "hidden" });
        assert.equal(writes, 1);
        await page.unroute("**/api/agent/action");
        const result = await (
          await context.request.get(origin + "/api/test/issue")
        ).json();
        assert.ok(result.persistedProviderNames.includes("紧凑网关"));
        assert.equal(result.providerWrites, 0);
        assert.equal(result.restarts, 0);
      },
    );
    await check(
      "MCP tools are directly visible and connection metadata is not duplicated",
      async () => {
        await settings
          .getByRole("button", { name: "扩展", exact: true })
          .click();
        await settings.getByRole("tab", { name: "插件", exact: true }).click();
        await settings
          .getByRole("button", { name: "查看 测试插件", exact: true })
          .click();
        await page
          .getByRole("dialog", { name: "测试插件", exact: true })
          .getByRole("button", { name: "查看 test-server", exact: true })
          .click();
        const detail = page.getByRole("dialog", {
          name: "test-server",
          exact: true,
        });
        await detail.getByRole("region", { name: "工具目录" }).waitFor();
        assert.equal(
          await detail.getByText("连接详情", { exact: true }).count(),
          0,
        );
        assert.equal(
          await detail.getByText("test-server", { exact: true }).count(),
          1,
        );
        assert.equal(
          await detail.locator("details.connection-tools").count(),
          0,
        );
        assert.ok(
          await detail.locator(".connection-state").getAttribute("aria-label"),
        );
        await detail.screenshot({ path: resolve(output, "mcp-detail.png") });
        await detail.getByRole("button", { name: "关闭", exact: true }).click();
      },
    );
  }
  if (stage === "navigation") {
    const choose = (name) =>
      page.locator(".history-link").getByText(name, { exact: true }).click();
    const prompt = (name) =>
      page.locator(".user-message").getByText(name, { exact: true });
    const ready = () =>
      page.waitForFunction(
        () => !document.querySelector(".topbar .read-progress"),
      );
    await check(
      "warm conversations render before the response and remain read-only until refreshed",
      async () => {
        await choose("Alpha History");
        await prompt("Alpha History").waitFor();
        await ready();
        await page
          .getByRole("textbox", { name: "消息", exact: true })
          .fill("保留 Alpha 草稿");
        await choose("Beta Chat");
        await prompt("Beta Chat").waitFor();
        await ready();
        const began = deferred(),
          finish = deferred();
        await page.route(
          "**/api/threads/" + threads[0],
          async (route) => {
            began.resolve();
            await finish.promise;
            await route.continue();
          },
          { times: 1 },
        );
        const start = performance.now();
        await choose("Alpha History");
        await began.promise;
        await prompt("Alpha History").waitFor({ timeout: 500 });
        metrics.push({
          cachedPresentationMs: Math.round(performance.now() - start),
          responseHeld: true,
        });
        assert.equal(
          await page
            .getByRole("textbox", { name: "消息", exact: true })
            .inputValue(),
          "保留 Alpha 草稿",
        );
        assert.equal(
          await page
            .getByRole("button", { name: "发送消息", exact: true })
            .isDisabled(),
          true,
        );
        finish.resolve();
        await ready();
        assert.equal(
          await page
            .getByRole("button", { name: "发送消息", exact: true })
            .isDisabled(),
          false,
        );
      },
    );
    await check(
      "late history cannot replace a newer selection; failed refresh retains draft and requires retry",
      async () => {
        await choose("Beta Chat");
        await prompt("Beta Chat").waitFor();
        await ready();
        const began = deferred(),
          finish = deferred();
        await page.route(
          "**/api/threads/" + threads[0],
          async (route) => {
            began.resolve();
            await finish.promise;
            await route.continue();
          },
          { times: 1 },
        );
        await choose("Alpha History");
        await began.promise;
        await choose("Beta Chat");
        await prompt("Beta Chat").waitFor();
        await ready();
        const oldResponse = page.waitForResponse((r) =>
          r.url().endsWith("/api/threads/" + threads[0]),
        );
        finish.resolve();
        await oldResponse;
        await prompt("Beta Chat").waitFor();
        assert.equal(await prompt("Alpha History").count(), 0);
        await page.route(
          "**/api/threads/" + threads[0],
          (route) => route.abort("failed"),
          { times: 1 },
        );
        await choose("Alpha History");
        await prompt("Alpha History").waitFor();
        const retry = page
          .locator(".topbar")
          .getByRole("button", { name: /对话未能更新.*重试/ });
        await retry.waitFor();
        await page
          .getByRole("button", { name: "关闭错误提示", exact: true })
          .click();
        assert.equal(
          await page
            .getByRole("button", { name: "发送消息", exact: true })
            .isDisabled(),
          true,
        );
        await retry.click();
        await ready();
        assert.equal(
          await page
            .getByRole("button", { name: "发送消息", exact: true })
            .isDisabled(),
          false,
        );
      },
    );
    await check(
      "process and tool disclosures retain the clicked anchor and defer hidden heavy output",
      async () => {
        const process = page.locator(".process-toggle").first();
        await process.evaluate((el) => el.scrollIntoView({ block: "center" }));
        const before = await process.boundingBox();
        assert.equal(await page.locator(".tool-detail").count(), 0);
        await process.click();
        stable(before, await process.boundingBox(), "process expand");
        assert.equal(await page.locator(".tool-detail").count(), 0);
        const tool = page
          .locator(".tool-item")
          .filter({ hasText: "执行命令" })
          .locator("summary");
        await tool.evaluate((el) => el.scrollIntoView({ block: "center" }));
        const toolBefore = await tool.boundingBox();
        await tool.click();
        stable(toolBefore, await tool.boundingBox(), "tool expand");
        await page.locator(".tool-detail").waitFor();
        await process.evaluate((el) => el.scrollIntoView({ block: "center" }));
        const collapse = await process.boundingBox();
        await process.click();
        stable(collapse, await process.boundingBox(), "process collapse");
        assert.equal(await page.locator(".tool-detail").count(), 0);
        metrics.push({
          process: before,
          tool: toolBefore,
          collapsed: collapse,
        });
        await page.screenshot({
          path: resolve(output, "anchored-process.png"),
        });
      },
    );
  }
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
