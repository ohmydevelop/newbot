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
const stage = "gateway-notices";
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
  await page.getByRole("button", { name: "个人工作台 私有实例" }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await settings.getByRole("button", { name: "网关", exact: true }).click();
  await settings
    .locator(".gateway-card select option[value='fixture-model']")
    .first()
    .waitFor({ state: "attached" });
  await check(
    "gateway cards have aligned text, separate actions, model counts and responsive themes",
    async () => {
      assert.equal(
        await settings.getByText("设为默认", { exact: true }).count(),
        0,
      );
      for (const width of [1440, 390])
        for (const theme of ["light", "dark"]) {
          await page.setViewportSize({ width, height: 1000 });
          await page.emulateMedia({ colorScheme: theme });
          const cards = await settings
            .locator(".gateway-card")
            .evaluateAll((els) =>
              els.map((el) => {
                const rect = el.getBoundingClientRect(),
                  title = el.querySelector("strong").getBoundingClientRect(),
                  select = el.querySelector("select"),
                  style = getComputedStyle(select),
                  box = select.getBoundingClientRect();
                return {
                  x: rect.x,
                  right: rect.right,
                  y: rect.y,
                  titleX: title.x,
                  selectTextX:
                    box.x +
                    parseFloat(style.paddingLeft) +
                    parseFloat(style.borderLeftWidth),
                };
              }),
            );
          assert.ok(cards.every((c) => c.x >= 0 && c.right <= width));
          assert.ok(
            cards.every((c) => Math.abs(c.titleX - c.selectTextX) <= 2),
            JSON.stringify(cards),
          );
          if (width === 1440) assert.equal(cards[0].y, cards[1].y);
          else assert.ok(cards[1].y > cards[0].y);
          await settings.screenshot({
            path: resolve(output, `cards-${width}-${theme}.png`),
          });
        }
      await page.setViewportSize({ width: 1440, height: 1000 });
    },
  );
  await check(
    "manual model saves despite failed discovery and keeps editor actions independent",
    async () => {
      const before = await action("gateway/catalog");
      const current = before.find((g) => g.current).id;
      await settings
        .getByRole("button", {
          name: "编辑 第二网关 · 用于验证长名称在窄列中保持对齐",
          exact: true,
        })
        .click();
      const editor = page.getByRole("dialog", {
        name: "第二网关 · 用于验证长名称在窄列中保持对齐",
        exact: true,
      });
      await editor
        .getByLabel("自定义模型", { exact: true })
        .fill("private-model-v1\nprivate-model-v2");
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await editor.waitFor({ state: "hidden" });
      assert.equal(
        (await action("gateway/catalog")).find((g) => g.current).id,
        current,
      );
      const select = settings.getByLabel(
        "第二网关 · 用于验证长名称在窄列中保持对齐 默认模型",
        { exact: true },
      );
      await select.selectOption("private-model-v1");
      await page.waitForFunction(
        () =>
          !document.querySelector(
            '[aria-label="第二网关 · 用于验证长名称在窄列中保持对齐 默认模型"]',
          ).disabled,
      );
      assert.equal(
        (await action("gateway/catalog")).find((g) => g.current).id,
        current,
      );
      const choose = settings.getByRole("button", {
        name: "第二网关 · 用于验证长名称在窄列中保持对齐，选择为默认网关",
        exact: true,
      });
      await choose.focus();
      await page.keyboard.press("Space");
      await settings
        .getByRole("button", {
          name: "第二网关 · 用于验证长名称在窄列中保持对齐，当前默认网关",
          exact: true,
        })
        .waitFor();
      assert.equal(
        (await action("gateway/catalog")).find((g) => g.current).defaultModel,
        "private-model-v1",
      );
      await settings
        .getByRole("button", {
          name: "删除 第二网关 · 用于验证长名称在窄列中保持对齐",
          exact: true,
        })
        .click();
      await page
        .getByRole("group", { name: "确认删除网关", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "保留", exact: true }).click();
      await editor.getByRole("button", { name: "取消", exact: true }).click();
      await settings.getByRole("button", { name: "关闭", exact: true }).click();
    },
  );
  await check(
    "ordinary error overlay leaves composer and message viewport fixed and dismissal does not unlock failed action",
    async () => {
      if (!(await page.locator(".history-link").count()))
        await page
          .getByRole("button", { name: "展开侧栏", exact: true })
          .click();
      await page
        .locator(".history-link")
        .getByText("Alpha History", { exact: true })
        .click();
      await page.locator(".process-toggle").waitFor();
      const before = {
        composer: await page.locator(".composer-area").boundingBox(),
        messages: await page.locator(".conversation").boundingBox(),
      };
      await page.route("**/api/agent/action", (route) =>
        route.request().postDataJSON()?.action === "session/update"
          ? route.fulfill({
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({ error: "测试：配置已变化，请重试" }),
            })
          : route.continue(),
      );
      await page.getByRole("button", { name: /^会话审批：/ }).click();
      await page
        .getByRole("menuitemradio", { name: "完全访问权限", exact: true })
        .click();
      await page.locator(".chat-notifications .error-banner").waitFor();
      stable(
        before.composer,
        await page.locator(".composer-area").boundingBox(),
        "composer",
      );
      stable(
        before.messages,
        await page.locator(".conversation").boundingBox(),
        "messages",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "会话审批：请求批准", exact: true })
          .count(),
        1,
      );
      await page.screenshot({ path: resolve(output, "floating-error.png") });
      await page
        .getByRole("button", { name: "关闭错误提示", exact: true })
        .click();
      stable(
        before.composer,
        await page.locator(".composer-area").boundingBox(),
        "dismissed",
      );
      await page.unroute("**/api/agent/action");
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
