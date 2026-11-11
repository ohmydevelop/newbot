import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  prepareOfficialApp,
  officialApp,
  officialDirectory,
} from "./prepare-official-app.mjs";
await prepareOfficialApp();
const verified = JSON.parse(
    readFileSync(resolve(officialDirectory, "verified.json"), "utf8"),
  ),
  { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright"),
  port = Number(process.env.OFFICIAL_APP_TEST_PORT || 3122),
  origin = `http://127.0.0.1:${port}`,
  appOrigin = `http://localhost:${port}`,
  output = resolve(".data/official-app-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const name of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, name), { force: true });
const server = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "tests/official-app-preview-server.ts"],
    {
      env: {
        ...process.env,
        OFFICIAL_APP_TEST_PORT: String(port),
        NODE_ENV: "test",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ),
  exited = new Promise((resolve) => server.once("exit", resolve));
let log = "",
  browser,
  page;
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
      () => reject(Error("Official fixture timeout")),
      25000,
    ),
    collect = (v) => {
      log += v;
      if (log.includes("Official MCP regression fixture ready")) {
        clearTimeout(timer);
        resolve();
      }
    };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", (code) => {
    clearTimeout(timer);
    reject(Error(`Official fixture ${code}: ${log}`));
  });
});
const checks = [],
  errors = [],
  external = [],
  downloads = [],
  popups = [],
  grants = [],
  cancelled = new Set();
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log("PASS " + name);
}
async function until(fn) {
  for (let i = 0; i < 150; i++) {
    const value = await fn();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("Official state did not settle");
}
try {
  await ready;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  async function create() {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1100 },
      reducedMotion: "reduce",
    });
    context.setDefaultTimeout(20000);
    await context.addInitScript(() => {
      window.__officialCalls = [];
      window.addEventListener("message", (e) => {
        if (e.data?.method === "tools/call" && e.data.id !== undefined) {
          const index = [
            ...document.querySelectorAll(".mcp-app iframe"),
          ].findIndex((frame) => frame.contentWindow === e.source);
          if (index >= 0) window.__officialCalls.push({ id: e.data.id, index });
        }
      });
    });
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("popup", (p) => popups.push(p.url()));
    p.on("download", (d) => downloads.push(d.suggestedFilename()));
    p.on("request", (r) => {
      if (
        /^https?:/.test(r.url()) &&
        !r.url().startsWith(origin + "/") &&
        !r.url().startsWith(appOrigin + "/")
      )
        external.push(r.url());
    });
    p.on("response", (r) => {
      if (r.status() !== 200) return;
      if (r.url().endsWith("/api/mcp-apps/call-request"))
        void r
          .json()
          .then((value) =>
            grants.push({ ...value, token: r.request().postDataJSON().token }),
          )
          .catch(() => {});
      if (r.url().endsWith("/api/mcp-apps/call-cancel"))
        cancelled.add(r.request().postDataJSON().grant);
    });
    return p;
  }
  let decisionView = 0,
    decisionTime = "";
  const root = (n = 0, p = page) => p.locator(".mcp-app").nth(n),
    view = (n = 0, p = page) => root(n, p).frameLocator("iframe"),
    state = async () =>
      (await page.request.get(origin + "/api/test/official-state")).json(),
    control = async (action) => {
      const r = await page.request.post(origin + "/api/test/official", {
        headers: { origin },
        data: { action },
      });
      assert.equal(r.status(), 200);
    },
    time = async (n = 0, p = page) =>
      view(n, p).locator("#server-time").textContent(),
    readyView = async (n = 0, p = page) => {
      await root(n, p)
        .getByText("应用已就绪", { exact: true })
        .waitFor({ state: "attached" });
      await until(async () => /^\d{4}-/.test(await time(n, p)));
    },
    token = async (n = 0, p = page) =>
      new URL(await root(n, p).locator("iframe").getAttribute("src")).pathname
        .split("/")
        .at(-1),
    dialog = () => page.getByRole("dialog", { name: "允许这次操作？" }),
    getTime = async (n = 0) => {
      const current = await token(n),
        previous = grants.filter((g) => g.token === current).at(-1);
      if (previous) await until(() => cancelled.has(previous.grant));
      decisionView = n;
      decisionTime = await time(n);
      await view(n)
        .locator("#get-time-btn")
        .evaluate((el) => el.click());
      await dialog().waitFor();
    },
    approve = async (waitForResult = true) => {
      const n = decisionView,
        previous = decisionTime;
      await dialog()
        .getByRole("button", { name: "仅允许这一次", exact: true })
        .click();
      if (waitForResult)
        await until(async () => {
          const value = await time(n);
          return /^\d{4}-/.test(value) && value !== previous;
        });
    },
    close = async (n = 0, p = page) => {
      const current = await token(n, p),
        response = p.waitForResponse(
          (r) =>
            r.url().endsWith("/api/mcp-apps/close") &&
            r.request().postDataJSON().token === current,
        );
      void response.catch(() => {});
      await root(n, p)
        .getByRole("button", { name: "关闭应用", exact: true })
        .click();
      assert.equal((await response).status(), 200);
      await root(n, p)
        .getByText("应用已关闭", { exact: true })
        .waitFor({ state: "attached" });
    },
    open = async (n = 0, p = page) => {
      await root(n, p)
        .getByRole("button", { name: /^打开交互应用$|^重新打开应用$/ })
        .click();
      await readyView(n, p);
    },
    cancelRpc = async (n = 0) => {
      const id = await page.evaluate(
        (index) =>
          window.__officialCalls.filter((r) => r.index === index).at(-1)?.id,
        n,
      );
      assert.notEqual(id, undefined);
      await view(n)
        .locator("body")
        .evaluate(
          (_, id) =>
            window.parent.postMessage(
              {
                jsonrpc: "2.0",
                method: "notifications/cancelled",
                params: { requestId: id, reason: "regression cancellation" },
              },
              "*",
            ),
          id,
        );
    },
    grantFor = async (n = 0) => {
      const id = await token(n);
      return until(() => grants.filter((g) => g.token === id).at(-1));
    },
    rejectedReplay = async (grant) =>
      assert.equal(
        (
          await page.request.post(origin + "/api/mcp-apps/call-approve", {
            headers: { origin },
            data: { grant, allow: true },
          })
        ).status(),
        410,
      );
  async function login(p) {
    await p.goto(origin);
    await p.getByLabel("登录密码").fill("official-app-ui-password");
    await p.getByRole("button", { name: "继续", exact: true }).click();
    await p.getByPlaceholder("询问任何问题").waitFor();
  }
  page = await create();
  await login(page);
  await page.getByPlaceholder("询问任何问题").fill("官方应用回归");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  let initial;
  await check(
    "two unmodified official Views initialize against real native Codex/MCP and retain distinct original results",
    async () => {
      await readyView();
      await readyView(1);
      initial = [await time(), await time(1)];
      assert.notEqual(initial[0], initial[1]);
      const value = await state();
      assert.equal(value.seededCalls, 2);
      assert.equal(value.toolCalls, 0);
      assert.equal(value.modelCalls, 0);
    },
  );
  await check(
    "denial executes no native tool and a fresh explicit approval can retry successfully",
    async () => {
      const before = (await state()).toolCalls;
      await getTime();
      const grant = await grantFor();
      await dialog().getByRole("button", { name: "拒绝", exact: true }).click();
      await until(async () => (await time()) === "[ERROR]");
      assert.equal((await state()).toolCalls, before);
      await rejectedReplay(grant.grant);
      await getTime();
      await approve();
      await until(async () => /^\d{4}-/.test(await time()));
      assert.equal((await state()).toolCalls, before + 1);
    },
  );
  await check(
    "repeated reopening gives fresh leases and original results without replaying native tools or a model turn",
    async () => {
      const before = await state();
      let old = await token();
      for (let i = 0; i < 3; i++) {
        const url = await root().locator("iframe").getAttribute("src");
        await close();
        assert.equal((await page.request.get(url)).status(), 404);
        await open();
        assert.notEqual(await token(), old);
        assert.equal(await time(), initial[0]);
        old = await token();
      }
      const after = await state();
      assert.equal(after.toolCalls, before.toolCalls);
      assert.equal(after.seededCalls, before.seededCalls);
      assert.equal(after.replayedTurns, 1);
    },
  );
  await check(
    "concurrent requests from the same View cannot replace its first decision or run an extra tool",
    async () => {
      const before = (await state()).toolCalls;
      await getTime();
      const grant = await grantFor();
      await view()
        .locator("#get-time-btn")
        .evaluate((el) => el.click());
      await until(async () => (await time()) === "[ERROR]");
      assert.equal(await dialog().count(), 1);
      assert.equal((await grantFor()).grant, grant.grant);
      await dialog().getByRole("button", { name: "拒绝", exact: true }).click();
      await dialog().waitFor({ state: "hidden" });
      await until(() => cancelled.has(grant.grant));
      assert.equal((await state()).toolCalls, before);
    },
  );
  await check(
    "different Views share one visible consent decision and can retry independently after it resolves",
    async () => {
      const before = (await state()).toolCalls;
      await getTime();
      await view(1)
        .locator("#get-time-btn")
        .evaluate((el) => el.click());
      await root(1)
        .getByText("另一个应用正在等待授权，请先处理当前授权后再试。", {
          exact: true,
        })
        .waitFor();
      assert.equal(await dialog().count(), 1);
      await approve();
      await until(async () => /^\d{4}-/.test(await time()));
      await getTime(1);
      await approve();
      await until(async () => /^\d{4}-/.test(await time(1)));
      assert.equal((await state()).toolCalls, before + 2);
      assert.equal(await root(1).locator(".app-notice").count(), 0);
    },
  );
  await check(
    "already-approved executions may overlap while their confirmations remain separate",
    async () => {
      const before = (await state()).toolCalls;
      const oldTimes = [await time(), await time(1)];
      await control("hold-tools");
      await getTime();
      await approve(false);
      await until(async () => (await state()).waitingTools === 1);
      await getTime(1);
      assert.equal(await dialog().count(), 1);
      await approve(false);
      await until(async () => (await state()).waitingTools === 2);
      await control("release-tools");
      await until(async () => (await state()).toolCalls === before + 2);
      await until(
        async () =>
          (await time()) !== oldTimes[0] &&
          (await time(1)) !== oldTimes[1] &&
          /^\d{4}-/.test(await time()) &&
          /^\d{4}-/.test(await time(1)),
      );
    },
  );
  await check(
    "protocol cancellation removes an unapproved decision and revokes its grant without a native call",
    async () => {
      const before = (await state()).toolCalls;
      await getTime();
      const grant = await grantFor();
      await cancelRpc();
      await dialog().waitFor({ state: "hidden" });
      await until(() => cancelled.has(grant.grant));
      await rejectedReplay(grant.grant);
      assert.equal((await state()).toolCalls, before);
      await close();
      await open();
    },
  );
  await check(
    "cancellation during permission discovery cannot create a delayed modal or leave a hidden grant",
    async () => {
      await control("hold-catalog");
      const count = grants.length,
        callsBefore = await page.evaluate(() => window.__officialCalls.length);
      await view()
        .locator("#get-time-btn")
        .evaluate((el) => el.click());
      await until(
        async () =>
          (await page.evaluate(() => window.__officialCalls.length)) >
          callsBefore,
      );
      await cancelRpc();
      await control("release-catalog");
      const grant = await until(() => grants.length > count && grants.at(-1));
      await until(() => cancelled.has(grant.grant));
      assert.equal(await dialog().count(), 0);
      await rejectedReplay(grant.grant);
      await control("idle-check");
      await close();
      await open();
    },
  );
  await check(
    "protocol cancellation after approval reports uncertain completion while the approved native call may finish",
    async () => {
      const before = (await state()).toolCalls;
      await control("hold-tools");
      await getTime();
      await approve(false);
      await until(async () => (await state()).waitingTools === 1);
      await cancelRpc();
      await root()
        .getByText("应用已取消等待；已批准的工具调用可能继续执行。", {
          exact: true,
        })
        .waitFor();
      await control("release-tools");
      await until(async () => (await state()).toolCalls === before + 1);
      await close();
      await open();
    },
  );
  await check(
    "the original message and external-link controls are denied and application logs are not collected",
    async () => {
      await view().locator("#message-text").fill("SYNTHETIC_OFFICIAL_MESSAGE");
      await view().locator("#send-message-btn").click();
      await root()
        .getByText("应用暂不能发送消息，请在聊天输入框中发送。", {
          exact: true,
        })
        .waitFor();
      await view()
        .locator("#link-url")
        .fill("https://forbidden.invalid/SYNTHETIC_OFFICIAL_LINK");
      await view().locator("#open-link-btn").click();
      await root()
        .getByText("应用暂不能打开外部链接。", {
          exact: true,
        })
        .waitFor();
      await view().locator("#log-text").fill("SYNTHETIC_OFFICIAL_LOG");
      await view().locator("#send-log-btn").click();
      assert.equal((await state()).replayedTurns, 1);
      assert.deepEqual(downloads, []);
      assert.deepEqual(popups, []);
    },
  );
  await check(
    "forged cross-server tools remain unauthorized even when another configured server exposes them",
    async () => {
      const before = (await state()).inputCalls;
      const r = await page.request.post(origin + "/api/mcp-apps/call-request", {
        headers: { origin },
        data: {
          token: await token(),
          tool: "collect_preferences",
          server: "input_test",
          arguments: {},
        },
      });
      assert.equal(r.status(), 403);
      assert.equal((await state()).inputCalls, before);
      assert.equal((await state()).inputs.length, 0);
    },
  );
  await check(
    "a real MCP input and an official App keep their decisions, drafts and native outcomes separate",
    async () => {
      await control("input");
      const form = page.getByRole("region", {
        name: "需要补充信息",
        exact: true,
      });
      await form
        .getByLabel("任务名称", { exact: false })
        .fill("官方 App 共存测试");
      await form.getByLabel("测试服务器", { exact: false }).selectOption("1");
      await getTime();
      await approve();
      await until(async () => /^\d{4}-/.test(await time()));
      assert.equal(
        await form.getByLabel("任务名称", { exact: false }).inputValue(),
        "官方 App 共存测试",
      );
      await form.getByRole("button", { name: "提交信息", exact: true }).click();
      await form.waitFor({ state: "hidden" });
      const value = await until(async () => (await state()).inputResult);
      assert.equal(value.action, "accept");
      assert.equal(value.content.notify, false);
      assert.equal(value.content.task_name, "官方 App 共存测试");
      await control("input");
      await form
        .getByRole("button", { name: "取消填写", exact: true })
        .waitFor();
      await close();
      assert.equal(await form.count(), 1);
      await form.getByRole("button", { name: "取消填写", exact: true }).click();
      await until(async () => (await state()).inputResult?.action === "cancel");
      await open();
    },
  );
  await check(
    "resource failures offer recovery and reopening restores the original result without another tool execution",
    async () => {
      const before = (await state()).toolCalls;
      await close();
      await control("resource-fail");
      await root()
        .getByRole("button", { name: "重新打开应用", exact: true })
        .click();
      await root()
        .getByText(/应用资源读取失败/)
        .waitFor();
      assert.doesNotMatch(
        await root().innerText(),
        /SYNTHETIC_OFFICIAL_RESOURCE_FAILURE/,
      );
      await control("ok");
      await open();
      assert.equal(await time(), initial[0]);
      assert.equal((await state()).toolCalls, before);
    },
  );
  await check(
    "a browser refresh reconstructs both original Views without new native tool or model calls",
    async () => {
      const before = await state();
      await page.reload();
      await readyView();
      await readyView(1);
      assert.equal(await time(), initial[0]);
      assert.equal(await time(1), initial[1]);
      const after = await state();
      assert.equal(after.toolCalls, before.toolCalls);
      assert.equal(after.seededCalls, 2);
    },
  );
  await check(
    "real Codex/MCP restart invalidates former leases and allows explicit recovery from replayed history",
    async () => {
      const url = await root().locator("iframe").getAttribute("src");
      await control("restart");
      await until(async () => (await root().locator("iframe").count()) === 0);
      assert.equal((await page.request.get(url)).status(), 404);
      await open();
      await open(1);
      assert.equal(await time(), initial[0]);
    },
  );
  await check(
    "separate authenticated browsers own separate leases for the same official result",
    async () => {
      const second = await create();
      await login(second);
      await second.locator(".history-link").first().click();
      await readyView(0, second);
      const firstToken = await token(),
        foreign = await second.request.post(origin + "/api/mcp-apps/close", {
          headers: { origin },
          data: { token: firstToken },
        });
      assert.equal(foreign.status(), 403);
      await close(0, second);
      await close(1, second);
      await second.context().close();
      await readyView();
    },
  );
  await check(
    "official UI stays isolated and readable in desktop light and mobile dark layouts",
    async () => {
      await root().evaluate((el) => el.scrollIntoView({ block: "center" }));
      await page.waitForTimeout(500);
      await root().screenshot({
        path: resolve(output, "official-desktop.png"),
      });
      await page.evaluate(
        () => (document.documentElement.dataset.theme = "dark"),
      );
      await page.setViewportSize({ width: 375, height: 844 });
      await page.locator(".sidebar").waitFor({ state: "hidden" });
      await root().evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.waitForTimeout(400);
      assert.equal(
        await root().locator("iframe").getAttribute("sandbox"),
        "allow-scripts",
      );
      assert.equal(
        await view()
          .locator("body")
          .evaluate(
            (el) => el.scrollWidth <= document.documentElement.clientWidth,
          ),
        true,
      );
      await page.screenshot({
        path: resolve(output, "official-mobile-dark.png"),
      });
    },
  );
  await check(
    "pinned official files stay unchanged and the full matrix performs zero model turns or external requests",
    async () => {
      for (const [file, digest] of Object.entries(verified.files))
        assert.equal(
          createHash("sha256")
            .update(readFileSync(resolve(officialDirectory, file)))
            .digest("hex"),
          digest,
        );
      assert.doesNotMatch(
        log,
        /SYNTHETIC_OFFICIAL_MESSAGE|SYNTHETIC_OFFICIAL_LINK|SYNTHETIC_OFFICIAL_LOG/,
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      assert.deepEqual(downloads, []);
      assert.deepEqual(popups, []);
      const after = await state();
      assert.equal(after.modelCalls, 0);
      assert.equal(after.replayedTurns, 1);
      await close();
      await close(1);
    },
  );
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        officialApp,
        nativeCodex: true,
        historyReplay: true,
        checks,
        state: await state(),
        pageErrors: errors,
        externalRequests: external,
        unchangedFiles: true,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Official MCP Apps UI: ${checks.length} checks passed`);
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
