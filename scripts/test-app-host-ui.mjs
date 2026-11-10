import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  output = resolve(".data/app-host-ui"),
  port = Number(process.env.APP_HOST_TEST_PORT || 3118),
  origin = `http://127.0.0.1:${port}`,
  appOrigin = `http://localhost:${port}`;
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const name of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, name), { force: true });
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "tests/app-lifecycle-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      APP_HOST_TEST: "1",
      APP_LIFECYCLE_TEST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const exited = new Promise((resolve) => server.once("exit", resolve));
let log = "",
  browser,
  page;
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error("Host fixture timeout")), 15000),
    collect = (data) => {
      log += data;
      if (log.includes("App lifecycle UI fixture ready")) {
        clearTimeout(timer);
        resolve();
      }
    };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", (code) => {
    clearTimeout(timer);
    reject(Error(`Fixture ${code}: ${log}`));
  });
});
const checks = [],
  errors = [],
  external = [],
  downloads = [],
  popups = [],
  writes = [];
async function check(name, run) {
  await run();
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
    viewport: { width: 1280, height: 1000 },
    reducedMotion: "reduce",
  });
  context.setDefaultTimeout(15000);
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("popup", (p) => popups.push(p.url()));
  page.on("download", (d) => downloads.push(d.suggestedFilename()));
  page.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      !r.url().startsWith(origin + "/") &&
      !r.url().startsWith(appOrigin + "/")
    )
      external.push(r.url());
    if (r.method() === "POST")
      writes.push({ path: new URL(r.url()).pathname, body: r.postData() });
  });
  const root = () => page.locator(".mcp-app").first(),
    view = () => root().frameLocator('iframe[title="MCP 应用"]'),
    state = async () =>
      (await page.request.get(origin + "/api/test/app-state")).json(),
    control = async (action) =>
      assert.equal(
        (
          await page.request.post(origin + "/api/test/app-lifecycle", {
            headers: { origin },
            data: { action },
          })
        ).status(),
        200,
      ),
    result = async (id) => {
      const el = view()
        .locator("#operation")
        .filter({ hasText: `"id":"${id}"` });
      await el.waitFor();
      return JSON.parse(await el.textContent());
    },
    operate = async (id) => {
      await view().locator(`#${id}`).click();
      return result(id);
    },
    connected = async () =>
      root().getByText("已连接 · 隔离运行", { exact: true }).waitFor(),
    close = async () => {
      const response = page.waitForResponse((r) =>
        r.url().endsWith("/api/mcp-apps/close"),
      );
      void response.catch(() => {});
      await root()
        .getByRole("button", { name: "关闭应用", exact: true })
        .click();
      assert.equal((await response).status(), 200);
      await root().getByText("应用已关闭", { exact: true }).waitFor();
    },
    open = async () => {
      await root()
        .getByRole("button", { name: "打开交互应用", exact: true })
        .click();
      await view()
        .getByText("原始结果 first: CPU 25%", { exact: true })
        .waitFor();
      await connected();
    };
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("app-lifecycle-ui-password");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByPlaceholder("询问任何问题").fill("测试 Host 能力边界");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await view().getByText("原始结果 first: CPU 25%", { exact: true }).waitFor();
  await connected();
  await check(
    "standard SDK initialization and runtime diagnostics agree on tool scope, sandbox and unadvertised capabilities",
    async () => {
      const caps = JSON.parse(
          await view().locator("#capabilities").textContent(),
        ),
        runtime = await (
          await page.request.get(origin + "/api/runtime/capabilities")
        ).json(),
        host = JSON.parse(await view().locator("#host-context").textContent());
      assert.deepEqual(Object.keys(caps).sort(), ["sandbox", "serverTools"]);
      assert.deepEqual(
        caps,
        runtime.capabilities.mcpAppHost.protocolCapabilities,
      );
      assert.deepEqual(caps.sandbox.permissions, {});
      assert.deepEqual(caps.sandbox.csp.connectDomains, []);
      assert.equal(runtime.capabilities.mcpAppHost.logging, false);
      assert.equal(
        runtime.capabilities.mcpAppHost.toolAuthorization,
        "allow-once",
      );
      assert.deepEqual(host.availableDisplayModes, ["inline"]);
    },
  );
  await check(
    "the compact capability disclosure is keyboard operable and shows per-view tool scope without claiming permission",
    async () => {
      const summary = root().locator("summary");
      assert.equal(await root().locator("details").getAttribute("open"), null);
      await summary.focus();
      await page.keyboard.press("Enter");
      await root()
        .getByText(/仅限当前 MCP 服务中与此应用关联的工具：metrics/)
        .waitFor();
      await root()
        .getByText("每次工具操作都需要你的单次批准，执行前会再次检查权限。", {
          exact: true,
        })
        .waitFor();
      await root()
        .locator(".app-capabilities")
        .screenshot({ path: resolve(output, "desktop-capabilities.png") });
      await page.keyboard.press("Enter");
      assert.equal(await root().locator("details").getAttribute("open"), null);
    },
  );
  const before = await state();
  for (const id of ["message", "link", "download"])
    await check(
      `${id} returns an explicit denied result and a safe Host notice`,
      async () => {
        const value = await operate(id);
        assert.equal(value.result.isError, true);
        assert.equal(value.result.reason, "unsupported");
        assert.doesNotMatch(JSON.stringify(value), /SYNTHETIC|forbidden/);
        assert.match(
          await root().locator(".app-notice").textContent(),
          /当前 Host 未开放/,
        );
        await connected();
      },
    );
  await check(
    "context, resource enumeration, resource reads, prompt/tool discovery, sampling and unknown methods return JSON-RPC errors without disconnecting",
    async () => {
      for (const id of [
        "context",
        "resource",
        "resources",
        "templates",
        "prompts",
        "tools",
        "sampling",
        "unknown",
      ]) {
        const value = await operate(id);
        assert.equal(value.error.code, -32601);
        assert.equal(value.error.data.reason, "unsupported");
        assert.doesNotMatch(JSON.stringify(value), /SYNTHETIC|secret:/);
        await connected();
      }
    },
  );
  await check(
    "fullscreen and picture-in-picture requests report inline as the actual mode",
    async () => {
      for (const id of ["fullscreen", "pip", "inline"])
        assert.deepEqual((await operate(id)).result, { mode: "inline" });
      assert.match(
        await root().locator(".app-notice").textContent(),
        /仅支持聊天内嵌/,
      );
      assert.equal(
        await root().locator("iframe").getAttribute("sandbox"),
        "allow-scripts",
      );
    },
  );
  await check(
    "logging is not collected and unsupported actions cause no extra model, resource, tool, download or navigation activity",
    async () => {
      const text = await root().locator(".app-notice").textContent();
      await operate("logging");
      assert.equal(await root().locator(".app-notice").textContent(), text);
      const after = await state();
      assert.equal(after.modelCalls, before.modelCalls);
      assert.equal(after.toolCalls, before.toolCalls);
      assert.equal(after.resourceCalls, before.resourceCalls);
      assert.deepEqual(downloads, []);
      assert.deepEqual(popups, []);
      assert.equal(
        writes.filter((r) =>
          /call-request|call-approve|\/agent\/run$/.test(r.path),
        ).length,
        1,
      );
      assert.doesNotMatch(JSON.stringify(writes), /SYNTHETIC_APP_PAYLOAD/);
    },
  );
  await check(
    "a tool linked to another UI resource is refused without an approval dialog or tool execution",
    async () => {
      assert.equal((await operate("danger")).error, "tool-rejected");
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal((await state()).toolCalls, 0);
      await connected();
    },
  );
  await check(
    "an unsupported App request cannot dismiss, replace or approve a pending tool decision",
    async () => {
      await view().locator("#metrics").click();
      const dialog = page.getByRole("dialog", { name: "允许应用调用工具？" });
      await dialog.waitFor();
      const args = await dialog.locator("pre").textContent();
      await view()
        .locator("#link")
        .evaluate((el) => el.click());
      assert.equal((await result("link")).result.isError, true);
      assert.equal(await dialog.locator("pre").textContent(), args);
      assert.equal((await state()).toolCalls, 0);
      await dialog.getByRole("button", { name: "拒绝", exact: true }).click();
      assert.equal((await result("metrics")).error, "tool-rejected");
      assert.equal((await state()).toolCalls, 0);
    },
  );
  await check(
    "a permitted tool still requires a fresh one-use approval and runs once",
    async () => {
      await view().locator("#metrics").click();
      const dialog = page.getByRole("dialog", { name: "允许应用调用工具？" });
      await dialog
        .getByRole("button", { name: "仅允许这一次", exact: true })
        .click();
      assert.equal((await result("metrics")).result.structuredContent.cpu, 42);
      assert.equal((await state()).toolCalls, 1);
    },
  );
  await check(
    "reopening with no App-visible tools removes serverTools from the handshake and does not grant tool access",
    async () => {
      await close();
      await control("no-app-tools");
      await open();
      const caps = JSON.parse(
        await view().locator("#capabilities").textContent(),
      );
      assert.equal(caps.serverTools, undefined);
      await root().locator("summary").click();
      await root()
        .getByText("本次打开时没有可申请的工具。", { exact: true })
        .waitFor();
      assert.equal((await operate("metrics")).error, "tool-rejected");
      assert.equal(await page.getByRole("dialog").count(), 0);
      assert.equal((await state()).toolCalls, 1);
    },
  );
  await check(
    "mobile dark-mode capability disclosure stays readable, within the viewport and has a 44px keyboard target",
    async () => {
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator(".sidebar").waitFor({ state: "hidden" });
      await root().locator("summary").focus();
      const box = await root().locator("summary").boundingBox();
      assert.ok(box.height >= 44);
      const bounds = await root().locator(".app-capabilities").boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391);
      assert.equal(
        await root()
          .locator(".app-capabilities")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      await root()
        .locator(".app-capabilities")
        .screenshot({ path: resolve(output, "mobile-dark-capabilities.png") });
      await page.keyboard.press("Enter");
      assert.equal(await root().locator("details").getAttribute("open"), null);
    },
  );
  await check(
    "Host restrictions preserve lifecycle close/reopen and isolate browser execution and network access",
    async () => {
      await close();
      await control("ok");
      await open();
      assert.ok(
        JSON.parse(await view().locator("#capabilities").textContent())
          .serverTools,
      );
      await close();
      assert.equal(await root().locator("iframe").count(), 0);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      assert.deepEqual(downloads, []);
      assert.deepEqual(popups, []);
      assert.equal((await state()).modelCalls, 1);
    },
  );
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        checks,
        pageErrors: errors,
        externalRequests: external,
        downloads,
        popups,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`App Host UI: ${checks.length} checks passed`);
} catch (error) {
  if (page)
    await page
      .screenshot({ path: resolve(output, "failure.png") })
      .catch(() => {});
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify({ message: String(error), checks, errors, log }, null, 2),
    { mode: 0o600 },
  );
  throw error;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await exited;
}
