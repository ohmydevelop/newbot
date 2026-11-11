import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  output = resolve(".data/app-lifecycle-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const f of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, f), { force: true });
const port = Number(process.env.APP_LIFECYCLE_TEST_PORT || 3116),
  origin = `http://127.0.0.1:${port}`,
  appOrigin = `http://localhost:${port}`,
  server = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "tests/app-lifecycle-preview-server.ts"],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        APP_LIFECYCLE_TEST_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
const exited = new Promise((r) => server.once("exit", r));
let log = "";
const ready = new Promise((r, j) => {
  const t = setTimeout(() => j(Error("Fixture timeout")), 15000),
    collect = (d) => {
      log += d;
      if (log.includes("App lifecycle UI fixture ready")) {
        clearTimeout(t);
        r();
      }
    };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", (c) => {
    clearTimeout(t);
    j(Error(`Fixture ${c}: ${log}`));
  });
});
let browser, page;
const checks = [],
  errors = [],
  external = [],
  openPosts = [];
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
  const create = async () => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    context.setDefaultTimeout(15000);
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (
        /^https?:/.test(r.url()) &&
        !r.url().startsWith(origin + "/") &&
        !r.url().startsWith(appOrigin + "/")
      )
        external.push(r.url());
      if (r.url() === origin + "/api/mcp-apps/open")
        openPosts.push(JSON.parse(r.postData()));
    });
    return p;
  };
  const login = async (p) => {
    await p.goto(origin);
    await p.getByLabel("登录密码").fill("app-lifecycle-ui-password");
    await p.getByRole("button", { name: "继续", exact: true }).click();
    await p.getByPlaceholder("询问任何问题").waitFor();
  };
  const root = (p = page, n = 0) => p.locator(".mcp-app").nth(n),
    view = (p = page, n = 0) => root(p, n).frameLocator("iframe"),
    close = async (p = page, n = 0) => {
      const closed = p.waitForResponse(
        (r) =>
          r.url().endsWith("/api/mcp-apps/close") &&
          r.request().method() === "POST",
      );
      void closed.catch(() => {});
      await root(p, n)
        .getByRole("button", { name: "关闭应用", exact: true })
        .click();
      assert.equal((await closed).status(), 200);
      await root(p, n)
        .getByText("应用已关闭", { exact: true })
        .waitFor({ state: "attached" });
    },
    open = async (p = page, n = 0) => {
      await root(p, n)
        .getByRole("button", { name: /^打开交互应用$|^重新打开应用$/ })
        .click();
      await view(p, n)
        .getByText(
          n === 0 ? "原始结果 first: CPU 25%" : "原始结果 second: CPU 75%",
          { exact: true },
        )
        .waitFor();
    };
  const control = async (action) =>
      assert.equal(
        (
          await page.request.post(origin + "/api/test/app-lifecycle", {
            headers: { origin },
            data: { action },
          })
        ).status(),
        200,
      ),
    state = async () =>
      (await page.request.get(origin + "/api/test/app-state")).json();
  const waitState = async (fn) => {
    for (let i = 0; i < 80; i++) {
      const value = await state();
      if (fn(value)) return value;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error("Fixture state did not settle");
  };
  const history = async (p) => {
    if (await p.getByRole("button", { name: "展开侧栏", exact: true }).count())
      await p.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await p.locator(".history-link").first().click();
    await view(p)
      .getByText("原始结果 first: CPU 25%", { exact: true })
      .waitFor();
    await view(p, 1)
      .getByText("原始结果 second: CPU 75%", { exact: true })
      .waitFor();
  };
  page = await create();
  await login(page);
  await page.getByPlaceholder("询问任何问题").fill("测试应用生命周期");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await check(
    "native metadata fallback opens an App and associates each original tool result with the correct View",
    async () => {
      await view()
        .getByText("原始结果 first: CPU 25%", { exact: true })
        .waitFor();
      await view(page, 1)
        .getByText("原始结果 second: CPU 75%", { exact: true })
        .waitFor();
      assert.ok(openPosts.every((p) => p.turnId && p.requestId));
      assert.equal((await state()).records, 2);
      assert.equal(
        await root().locator(".app-source, .app-capabilities").count(),
        0,
      );
    },
  );
  await check(
    "closing immediately removes the iframe, invalidates its old document and leaves other Views active",
    async () => {
      const url = await root().locator("iframe").getAttribute("src"),
        token = new URL(url).pathname.split("/").at(-1);
      await close();
      await waitState((s) => s.records === 1);
      assert.equal(await root().locator("iframe").count(), 0);
      assert.equal(
        await root()
          .getByRole("button", { name: "重新打开应用", exact: true })
          .evaluate((el) => document.activeElement === el),
        true,
      );
      assert.equal((await page.request.get(url)).status(), 404);
      assert.equal(
        (
          await page.request.post(origin + "/api/mcp-apps/call-request", {
            headers: { origin },
            data: { token, tool: "metrics", arguments: {} },
          })
        ).status(),
        410,
      );
      await view(page, 1)
        .getByText("原始结果 second: CPU 75%", { exact: true })
        .waitFor();
    },
  );
  await check(
    "reopening creates a new lease and rereads the original result without another model or tool invocation",
    async () => {
      const before = await state();
      await open();
      const after = await waitState((s) => s.records === 2);
      assert.equal(
        await root()
          .locator("iframe")
          .evaluate((el) => document.activeElement === el),
        true,
      );
      assert.equal(after.modelCalls, before.modelCalls);
      assert.equal(after.toolCalls, before.toolCalls);
      assert.ok(after.resourceCalls > before.resourceCalls);
    },
  );
  await check(
    "approved App calls preserve source arguments and remain independent of the original result",
    async () => {
      await view()
        .getByRole("button", { name: "刷新数据", exact: true })
        .click();
      const dialog = page.getByRole("dialog", { name: "允许这次操作？" });
      await dialog.locator("pre").getByText(/first/).waitFor();
      await dialog
        .getByRole("button", { name: "仅允许这一次", exact: true })
        .click();
      await view()
        .getByText(/工具交互成功/)
        .waitFor();
      assert.equal((await state()).toolCalls, 1);
      await close();
      await open();
      await view()
        .getByText("原始结果 first: CPU 25%", { exact: true })
        .waitFor();
      assert.equal(
        await view()
          .getByText(/工具交互成功/)
          .count(),
        0,
      );
    },
  );
  await check(
    "denying an App operation keeps the View connected and does not call a tool",
    async () => {
      const before = (await state()).toolCalls;
      await view()
        .getByRole("button", { name: "刷新数据", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "拒绝", exact: true })
        .click();
      await view().getByText("工具交互未完成", { exact: true }).waitFor();
      assert.equal((await state()).toolCalls, before);
      await root()
        .getByText("应用已就绪", { exact: true })
        .waitFor({ state: "attached" });
    },
  );
  await check(
    "closing from the approval dialog cancels authorization and releases the View",
    async () => {
      const before = (await state()).toolCalls;
      await view()
        .getByRole("button", { name: "刷新数据", exact: true })
        .click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭应用并取消授权", exact: true })
        .click();
      await root()
        .getByText("应用已关闭", { exact: true })
        .waitFor({ state: "attached" });
      await waitState((s) => s.records === 1);
      assert.equal((await state()).toolCalls, before);
      await open();
    },
  );
  await check(
    "expiry removes the stale iframe and reopening refreshes permissions and its original result",
    async () => {
      const old = await root().locator("iframe").getAttribute("src");
      await control("expire");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await root().getByText("应用已失效", { exact: true }).waitFor();
      assert.equal(await root().locator("iframe").count(), 0);
      assert.equal((await page.request.get(old)).status(), 404);
      await open();
      assert.equal((await state()).modelCalls, 1);
    },
  );
  await check(
    "resource read failures show a fixed recoverable error and do not leak upstream diagnostics",
    async () => {
      await close();
      await control("fail");
      await root()
        .getByRole("button", { name: "重新打开应用", exact: true })
        .click();
      await root()
        .getByRole("alert")
        .filter({ hasText: "应用资源读取失败" })
        .waitFor();
      assert.ok(!(await page.content()).includes("SYNTHETIC_RESOURCE_SECRET"));
      assert.equal(await root().locator("iframe").count(), 0);
      await control("ok");
      await open();
    },
  );
  await check(
    "invalid resource MIME is rejected and can be retried without invoking the original tool",
    async () => {
      await close();
      await control("invalid");
      await root()
        .getByRole("button", { name: "重新打开应用", exact: true })
        .click();
      await root().getByRole("alert").waitFor();
      const before = (await state()).toolCalls;
      await control("ok");
      await open();
      assert.equal((await state()).toolCalls, before);
    },
  );
  await check(
    "close during a delayed resource load discards the late response and never resurrects the View",
    async () => {
      await close();
      await control("hold");
      const before = (await state()).resourceCalls;
      await root()
        .getByRole("button", { name: "重新打开应用", exact: true })
        .click();
      await waitState((s) => s.resourceCalls > before);
      await close();
      await control("release");
      await waitState((s) => s.records === 1);
      assert.equal(await root().locator("iframe").count(), 0);
      await root()
        .getByText("应用已关闭", { exact: true })
        .waitFor({ state: "attached" });
      await open();
    },
  );
  await check(
    "separate browser sessions own independent Views and cannot use or close each other’s lease",
    async () => {
      const other = await create();
      await login(other);
      await history(other);
      const token = new URL(
        await root().locator("iframe").getAttribute("src"),
      ).pathname
        .split("/")
        .at(-1);
      assert.equal(
        (
          await other.request.post(origin + "/api/mcp-apps/status", {
            headers: { origin },
            data: { token },
          })
        ).status(),
        403,
      );
      assert.equal(
        (
          await other.request.post(origin + "/api/mcp-apps/close", {
            headers: { origin },
            data: { token },
          })
        ).status(),
        403,
      );
      await close(other);
      await close(other, 1);
      await other.close();
      await waitState((s) => s.records === 2);
      await view()
        .getByText("原始结果 first: CPU 25%", { exact: true })
        .waitFor();
    },
  );
  await check(
    "history reload restores original outputs and source ids with fresh Views",
    async () => {
      const before = (await state()).modelCalls;
      await page.reload();
      await page.getByPlaceholder("询问任何问题").waitFor();
      await history(page);
      assert.equal((await state()).modelCalls, before);
      assert.ok(
        openPosts
          .slice(-2)
          .every((p) => p.turnId && ["first", "second"].includes(p.itemId)),
      );
    },
  );
  await check(
    "a cached page restore expires its old connection rather than reporting a live App",
    async () => {
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent("pagehide", { persisted: true }),
        ),
      );
      await waitState((s) => s.records === 0);
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        ),
      );
      await root().getByText("应用已失效", { exact: true }).waitFor();
      await open();
      await open(page, 1);
    },
  );
  await check(
    "configuration or runtime invalidation is detected without reusing old permission tokens",
    async () => {
      await control("revoke");
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await root().getByText("应用已失效", { exact: true }).waitFor();
      await root(page, 1).getByText("应用已失效", { exact: true }).waitFor();
      await open();
      await open(page, 1);
    },
  );
  await check(
    "mobile and dark landscape retain source identity, close/reopen controls and sandbox isolation",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const sidebar = page
        .getByRole("button", { name: "收起侧栏", exact: true })
        .last();
      if (await sidebar.isVisible()) await sidebar.click();
      await root().scrollIntoViewIfNeeded();
      assert.ok(
        (
          await root()
            .getByRole("button", { name: "关闭应用", exact: true })
            .boundingBox()
        ).height >= 44,
      );
      assert.equal(
        await root().locator("iframe").getAttribute("sandbox"),
        "allow-scripts",
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await root().screenshot({ path: resolve(output, "mobile-app.png") });
      await close();
      assert.ok(
        (
          await root()
            .getByRole("button", { name: "重新打开应用", exact: true })
            .boundingBox()
        ).height >= 44,
      );
      await page.evaluate(
        () => (document.documentElement.dataset.theme = "dark"),
      );
      await page.setViewportSize({ width: 844, height: 390 });
      await root().screenshot({
        path: resolve(output, "landscape-closed.png"),
      });
      await open();
    },
  );
  await check(
    "initialization timeout offers explicit reopening and cleans its server lease",
    async () => {
      const p = await create();
      await login(p);
      await history(p);
      await close(p);
      await p.clock.install();
      await control("no-init");
      await root(p)
        .getByRole("button", { name: "重新打开应用", exact: true })
        .click();
      await root(p).locator("iframe").waitFor();
      await p.clock.runFor(15100);
      await root(p)
        .getByRole("alert")
        .filter({ hasText: "未完成初始化" })
        .waitFor();
      assert.equal(await root(p).locator("iframe").count(), 0);
      await control("ok");
      await open(p);
      await close(p);
      await close(p, 1);
      await p.close();
    },
  );
  await check(
    "resource timeout cancels the pending open and a late result cannot recreate its frame",
    async () => {
      const p = await create();
      await login(p);
      await history(p);
      await close(p);
      await p.clock.install();
      await control("hold");
      const before = (await state()).resourceCalls;
      await root(p)
        .getByRole("button", { name: "重新打开应用", exact: true })
        .click();
      await waitState((s) => s.resourceCalls > before);
      await p.clock.runFor(15100);
      await root(p)
        .getByRole("alert")
        .filter({ hasText: "资源加载超时" })
        .waitFor();
      await control("release");
      assert.equal(await root(p).locator("iframe").count(), 0);
      await open(p);
      await close(p);
      await close(p, 1);
      await p.close();
    },
  );
  await check(
    "approval timeout resolves its dialog without executing a tool or blocking the next attempt",
    async () => {
      const p = await create();
      await login(p);
      await history(p);
      await p.clock.install();
      const before = (await state()).toolCalls;
      await view(p)
        .getByRole("button", { name: "刷新数据", exact: true })
        .click();
      await p.getByRole("dialog", { name: "允许这次操作？" }).waitFor();
      await p.clock.runFor(125000);
      await p.getByRole("dialog").waitFor({ state: "hidden" });
      assert.equal((await state()).toolCalls, before);
      await root(p)
        .getByText(/授权.*过期|授权.*超时/)
        .waitFor();
      await close(p);
      await close(p, 1);
      await p.close();
    },
  );
  await check(
    "page execution and network access stay isolated and lifecycle controls never create extra model turns",
    async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      assert.equal((await state()).modelCalls, 1);
    },
  );
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      { checks, pageErrors: errors, externalRequests: external },
      null,
      2,
    ),
  );
  console.log(`App lifecycle UI: ${checks.length} checks passed`);
} catch (e) {
  if (page)
    await page
      .screenshot({ path: resolve(output, "failure.png") })
      .catch(() => {});
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify({ message: String(e), checks, errors, log }, null, 2),
  );
  throw e;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await exited;
}
