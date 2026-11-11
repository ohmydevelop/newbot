import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  port = Number(process.env.INPUT_TEST_PORT || 3121),
  origin = `http://127.0.0.1:${port}`,
  output = resolve(".data/elicitation-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const name of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, name), { force: true });
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "tests/elicitation-preview-server.ts"],
  {
    env: { ...process.env, INPUT_TEST_PORT: String(port), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const exited = new Promise((resolve) => server.once("exit", resolve));
let log = "",
  browser,
  page;
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error("Input fixture timeout")), 15000),
    collect = (value) => {
      log += value;
      if (log.includes("Elicitation UI fixture ready")) {
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
  responses = [];
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
  async function create() {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1100 },
      reducedMotion: "reduce",
    });
    context.setDefaultTimeout(15000);
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (/^https?:/.test(r.url()) && !r.url().startsWith(origin + "/"))
        external.push(r.url());
      if (r.method() === "POST" && r.url().endsWith("/api/agent/action")) {
        const data = JSON.parse(r.postData());
        if (data.action === "elicitation/respond") responses.push(data);
      }
    });
    return p;
  }
  async function login(p) {
    await p.goto(origin);
    await p.getByLabel("登录密码").fill("input-ui-password");
    await p.getByRole("button", { name: "继续", exact: true }).click();
    await p.getByPlaceholder("询问任何问题").waitFor();
  }
  const root = (p = page) =>
      p.getByRole("region", { name: "需要补充信息", exact: true }).last(),
    state = async () =>
      (await page.request.get(origin + "/api/test/input-state")).json(),
    control = async (action) => {
      assert.equal(
        (
          await page.request.post(origin + "/api/test/input", {
            headers: { origin },
            data: { action },
          })
        ).status(),
        200,
      );
    },
    newForm = async (action) => {
      await control(action || "new");
      await root()
        .getByRole("button", { name: "提交信息", exact: true })
        .waitFor();
    },
    fill = async (p = page) => {
      await root(p)
        .getByLabel("任务名称", { exact: false })
        .fill("模拟监控测试");
      await root(p)
        .getByLabel("测试服务器", { exact: false })
        .selectOption("1");
    },
    settled = async (p = page) => {
      await p
        .getByRole("region", { name: "需要补充信息", exact: true })
        .waitFor({ state: "hidden" });
    };
  page = await create();
  await login(page);
  await page.getByPlaceholder("询问任何问题").fill("测试普通输入");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await check(
    "the ordinary-input boundary, source and typed defaults are displayed without submitting automatically",
    async () => {
      await root()
        .getByText(/内容会提交给此 MCP 服务，并可能被模型看到/)
        .waitFor();
      await root().getByText("来自 input-test", { exact: true }).waitFor();
      assert.equal(
        await root().getByLabel("告警阈值", { exact: false }).inputValue(),
        "80",
      );
      assert.equal(
        await root().getByLabel("发送测试通知", { exact: false }).inputValue(),
        "false",
      );
      assert.equal((await state()).replies.length, 0);
      assert.doesNotMatch(
        await page.locator("body").innerText(),
        /SYNTHETIC_PRIVATE/,
      );
    },
  );
  await check(
    "invalid required and range values stay local, focus a linked summary and retain inline errors",
    async () => {
      await root().getByLabel("告警阈值", { exact: false }).fill("101");
      await root()
        .getByRole("button", { name: "提交信息", exact: true })
        .click();
      const summary = root().locator(".input-error-summary");
      await summary.waitFor();
      assert.equal(
        await summary.evaluate((el) => document.activeElement === el),
        true,
      );
      await summary.getByRole("link").first().click();
      assert.equal(
        await root()
          .getByLabel("任务名称", { exact: false })
          .evaluate((el) => document.activeElement === el),
        true,
      );
      assert.equal(
        await root()
          .getByLabel("告警阈值", { exact: false })
          .getAttribute("aria-invalid"),
        "true",
      );
      assert.equal(responses.length, 0);
      await fill();
      await root().getByLabel("告警阈值", { exact: false }).fill("75");
      await root().getByLabel("采样间隔", { exact: false }).fill("0.5");
      await root().getByLabel("内存", { exact: true }).check();
      await page.setViewportSize({ width: 1280, height: 1600 });
      await root().evaluate((el) => el.scrollIntoView({ block: "start" }));
      await root().screenshot({ path: resolve(output, "desktop-form.png") });
      await page.setViewportSize({ width: 1280, height: 1100 });
    },
  );
  await check(
    "accepted fields reach the original request once with numbers, false and enum arrays intact",
    async () => {
      await root()
        .getByRole("button", { name: "提交信息", exact: true })
        .click();
      await settled();
      const reply = (await state()).replies.at(-1).result;
      assert.equal(reply.action, "accept");
      assert.deepEqual(reply.content, {
        task_name: "模拟监控测试",
        server: "node-b",
        threshold: 75,
        interval: 0.5,
        notify: false,
        metrics: ["CPU", "内存"],
      });
      assert.equal(reply._meta, null);
      assert.equal((await state()).replies.length, 1);
    },
  );
  await check(
    "cancellation discards the draft and sends only cancel with null content",
    async () => {
      await newForm();
      await fill();
      await root()
        .getByRole("button", { name: "取消填写", exact: true })
        .click();
      await settled();
      assert.deepEqual((await state()).replies.at(-1).result, {
        action: "cancel",
        content: null,
        _meta: null,
      });
      assert.equal(responses.at(-1).content, undefined);
    },
  );
  await check(
    "declining stays distinct from cancellation and never includes field content",
    async () => {
      await newForm();
      await root()
        .getByRole("button", { name: "拒绝提供", exact: true })
        .click();
      await settled();
      assert.deepEqual((await state()).replies.at(-1).result, {
        action: "decline",
        content: null,
        _meta: null,
      });
    },
  );
  await check(
    "unsupported schemas, URL requests and explicit private fields expose no input, link or secret default",
    async () => {
      for (const action of ["sensitive", "unsupported", "url"]) {
        await control(action);
        await root()
          .getByRole("button", { name: "取消填写", exact: true })
          .waitFor();
        assert.equal(
          await root()
            .getByRole("button", { name: "提交信息", exact: true })
            .count(),
          0,
        );
        assert.equal(await root().locator("input,select,a").count(), 0);
        assert.doesNotMatch(
          await root().innerText(),
          /SYNTHETIC_PRIVATE|forbidden.invalid/,
        );
        await root()
          .getByRole("button", { name: "取消填写", exact: true })
          .click();
        await settled();
      }
    },
  );
  await check(
    "refresh restores the same pending request and original deadline while leaving unsent values out of browser storage",
    async () => {
      await newForm();
      await root()
        .getByLabel("任务名称", { exact: false })
        .fill("UNSENT_LOCAL_DRAFT");
      const before = (await state()).pending[0].params.elicitation;
      assert.doesNotMatch(
        await page.evaluate(() =>
          JSON.stringify({ ...localStorage, ...sessionStorage }),
        ),
        /UNSENT_LOCAL_DRAFT/,
      );
      await page.reload();
      await root()
        .getByRole("button", { name: "提交信息", exact: true })
        .waitFor();
      assert.equal(
        await root().getByLabel("任务名称", { exact: false }).inputValue(),
        "",
      );
      const after = (await state()).pending[0].params.elicitation;
      assert.equal(after.token, before.token);
      assert.equal(after.expiresAt, before.expiresAt);
    },
  );
  await check(
    "a lost response before dispatch keeps a recoverable form and draft without duplicate submission",
    async () => {
      await fill();
      const before = (await state()).replies.length;
      const intercept = async (route) => {
        const data = route.request().postDataJSON();
        if (data.action === "elicitation/respond") return route.abort();
        return route.continue();
      };
      await page.route("**/api/agent/action", intercept);
      await root()
        .getByRole("button", { name: "提交信息", exact: true })
        .click();
      await root()
        .getByText(/当前请求仍在等待/)
        .waitFor();
      assert.equal(
        await root().getByLabel("任务名称", { exact: false }).inputValue(),
        "模拟监控测试",
      );
      assert.equal((await state()).replies.length, before);
      await page.unroute("**/api/agent/action", intercept);
      await root()
        .getByRole("button", { name: "提交信息", exact: true })
        .click();
      await settled();
      assert.equal((await state()).replies.length, before + 1);
    },
  );
  await check(
    "a lost response after commit reconciles the ended request instead of replaying its input",
    async () => {
      await newForm();
      await fill();
      const before = (await state()).replies.length;
      const intercept = async (route) => {
        const data = route.request().postDataJSON();
        if (data.action === "elicitation/respond") {
          await route.fetch();
          return route.abort();
        }
        return route.continue();
      };
      await page.route("**/api/agent/action", intercept);
      await root()
        .getByRole("button", { name: "提交信息", exact: true })
        .click();
      await settled();
      await page.unroute("**/api/agent/action", intercept);
      assert.equal((await state()).replies.length, before + 1);
    },
  );
  await check(
    "a second browser can finish the request once and the first view discards its stale form",
    async () => {
      await newForm();
      const second = await create();
      await login(second);
      await second.locator(".history-link").first().click();
      await root(second)
        .getByRole("button", { name: "提交信息", exact: true })
        .waitFor();
      const before = (await state()).replies.length;
      await root(second)
        .getByRole("button", { name: "拒绝提供", exact: true })
        .click();
      await settled(second);
      await settled();
      assert.equal((await state()).replies.length, before + 1);
      await second.context().close();
    },
  );
  await check(
    "reusing a native id creates a new request token and cannot retain or submit the old draft",
    async () => {
      await newForm();
      await root()
        .getByLabel("任务名称", { exact: false })
        .fill("OLD_REQUEST_DRAFT");
      const before = (await state()).pending[0];
      await control("reuse");
      await root()
        .getByText("请求已更新，请重新填写。", { exact: true })
        .waitFor();
      assert.equal(
        await root().getByLabel("任务名称", { exact: false }).inputValue(),
        "",
      );
      const response = await page.request.post(origin + "/api/agent/action", {
        headers: { origin },
        data: {
          action: "elicitation/respond",
          id: before.id,
          token: before.params.elicitation.token,
          decision: "cancel",
        },
      });
      assert.equal(response.status(), 410);
      await root()
        .getByRole("button", { name: "取消填写", exact: true })
        .click();
      await settled();
    },
  );
  await check(
    "server-side timeout completes cancellation without needing a visible browser",
    async () => {
      await newForm();
      const before = (await state()).replies.length;
      await page.goto("about:blank");
      // Same authenticated API context, with no product document or browser timer running.
      await control("expire");
      assert.equal((await state()).replies.length, before + 1);
      assert.equal((await state()).replies.at(-1).result.action, "cancel");
      await page.goto(origin);
      await page.getByPlaceholder("询问任何问题").waitFor();
      assert.equal(
        await page
          .getByRole("region", { name: "需要补充信息", exact: true })
          .count(),
        0,
      );
    },
  );
  await check(
    "the visible timeout clears its request and explains the outcome",
    async () => {
      await control("timeout");
      await page
        .getByText("MCP 输入请求已超时并取消。", { exact: true })
        .waitFor();
      await settled();
    },
  );
  await check(
    "mobile dark-mode fields, errors and actions remain within the viewport with 44px touch targets",
    async () => {
      await newForm();
      const closeError = page.getByRole("button", {
        name: "关闭错误提示",
        exact: true,
      });
      if (await closeError.count()) await closeError.click();
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator(".sidebar").waitFor({ state: "hidden" });
      await root()
        .getByRole("button", { name: "提交信息", exact: true })
        .click();
      await root().locator(".input-error-summary").waitFor();
      assert.equal(
        await root().evaluate((el) => el.scrollWidth <= el.clientWidth),
        true,
      );
      for (const element of await root()
        .locator("select, .input-field > input, .approval-actions button")
        .all())
        assert.ok((await element.boundingBox()).height >= 44);
      await page.screenshot({
        path: resolve(output, "mobile-dark-form.png"),
      });
      await root().locator(".approval-actions").scrollIntoViewIfNeeded();
      const actions = await root().locator(".approval-actions").boundingBox();
      assert.ok(actions.y >= 0 && actions.y + actions.height <= 844);
      await page.screenshot({
        path: resolve(output, "mobile-dark-actions.png"),
      });
      await root()
        .getByRole("button", { name: "取消填写", exact: true })
        .click();
      await settled();
    },
  );
  await check(
    "native resolution and process loss clear stale requests, and a recovered runtime starts a clean form",
    async () => {
      await newForm();
      await control("resolve");
      await settled();
      await newForm();
      await control("offline");
      await settled();
      await control("ready");
      await newForm();
      await root()
        .getByRole("button", { name: "取消填写", exact: true })
        .click();
      await settled();
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
    { mode: 0o600 },
  );
  console.log(`Elicitation UI: ${checks.length} checks passed`);
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
