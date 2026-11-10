import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  chmodSync,
} from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  output = resolve(".data/browser-runtime-ui"),
  port = Number(process.env.BROWSER_RUNTIME_TEST_PORT || 3139),
  origin = `http://127.0.0.1:${port}`;
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const f of ["result.json", "failure.json"])
  rmSync(resolve(output, f), { force: true });
const manifest = Object.values(
    JSON.parse(readFileSync("dist/web/.vite/manifest.json", "utf8")),
  ),
  asset = (src) =>
    origin + "/" + manifest.find((v) => v.src?.endsWith(src)).file;
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/interaction-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_TRANSPORT: "poll",
      INTERACTION_TEST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "",
  browser,
  page;
const exited = new Promise((r) => server.once("exit", r));
const ready = new Promise((res, rej) => {
  const timer = setTimeout(() => rej(Error("Fixture timeout: " + log)), 15000);
  const collect = (d) => {
    log += d;
    if (log.includes("Interaction UI fixture ready")) {
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
const checks = [],
  samples = {},
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
  async function create(transport = "poll") {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
      reducedMotion: "reduce",
    });
    await context.addInitScript(() => {
      const counters = (window.__runtimeCounters = {
        sources: 0,
        sourceStarts: 0,
        polls: 0,
        maxPolls: 0,
      });
      const Source = window.EventSource;
      window.EventSource = class extends Source {
        active = true;
        constructor(...args) {
          super(...args);
          counters.sources++;
          counters.sourceStarts++;
        }
        close() {
          if (this.active) {
            this.active = false;
            counters.sources--;
          }
          super.close();
        }
      };
      const fetch = window.fetch;
      window.fetch = async (...args) => {
        const input = args[0],
          url =
            typeof input === "string"
              ? input
              : input instanceof URL
                ? input.href
                : input.url;
        const poll =
          url.includes("/api/agent/events") && url.includes("transport=poll");
        if (poll) {
          counters.polls++;
          counters.maxPolls = Math.max(counters.maxPolls, counters.polls);
        }
        try {
          return await fetch(...args);
        } finally {
          if (poll) counters.polls--;
        }
      };
    });
    const p = await context.newPage();
    p.setDefaultTimeout(20000);
    p.on("pageerror", (e) => errors.push(e.message));
    if (transport === "sse")
      await p.route("**/api/runtime/capabilities", async (route) => {
        const r = await route.fetch(),
          data = await r.json();
        await route.fulfill({
          response: r,
          json: { ...data, webTransport: "sse" },
        });
      });
    assert.equal(
      (
        await context.request.post(origin + "/api/login", {
          headers: { origin },
          data: { password: "interaction-ui-fixture-login" },
        })
      ).status(),
      200,
    );
    await p.goto(origin + "/?profile=1");
    await p.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    return { context, p };
  }
  await check(
    "slow settings loading is visible, cancellable and never clears a composer draft",
    async () => {
      const { context, p } = await create();
      page = p;
      let release, reached, finished;
      const waiting = new Promise((r) => (reached = r)),
        done = new Promise((r) => (finished = r));
      await p.route(asset("components/Settings.tsx"), async (route) => {
        await new Promise((r) => {
          release = r;
          reached();
        });
        await route.continue();
        finished();
      });
      await p
        .getByRole("textbox", { name: "消息", exact: true })
        .fill("keep while loading");
      await p.getByRole("button", { name: /个人工作台/ }).click();
      await waiting;
      const notice = p.getByRole("region", {
        name: "设置加载状态",
        exact: true,
      });
      await notice.getByRole("status").waitFor();
      await notice
        .getByRole("button", { name: "关闭提示", exact: true })
        .click();
      release();
      await done;
      await p.waitForTimeout(250);
      assert.equal(
        await p.getByRole("dialog", { name: "设置", exact: true }).count(),
        0,
      );
      assert.equal(
        await p
          .getByRole("textbox", { name: "消息", exact: true })
          .inputValue(),
        "keep while loading",
      );
      await context.close();
    },
  );
  await check(
    "a missing settings chunk stays local, keeps editing usable and offers explicit reload",
    async () => {
      const { context, p } = await create();
      page = p;
      await p.route(asset("components/Settings.tsx"), (route) =>
        route.abort("failed"),
      );
      await p
        .getByRole("textbox", { name: "消息", exact: true })
        .fill("preserved after chunk failure");
      await p.getByRole("button", { name: /个人工作台/ }).click();
      const notice = p.getByRole("region", {
        name: "设置加载状态",
        exact: true,
      });
      await notice
        .getByRole("button", { name: "重新加载页面", exact: true })
        .waitFor();
      assert.equal(
        await p
          .getByRole("textbox", { name: "消息", exact: true })
          .inputValue(),
        "preserved after chunk failure",
      );
      await p.screenshot({ path: resolve(output, "resource-failure.png") });
      await p
        .getByRole("textbox", { name: "消息", exact: true })
        .fill("can continue typing");
      await notice
        .getByRole("button", { name: "关闭提示", exact: true })
        .click();
      await context.close();
    },
  );
  await check(
    "a failed chart chunk preserves other content and does not offer an ineffective local retry",
    async () => {
      const { context, p } = await create();
      page = p;
      await p.route(asset("components/Chart.tsx"), (route) =>
        route.abort("failed"),
      );
      await p
        .getByRole("button", { name: "富文本主题检查", exact: true })
        .click();
      await p
        .getByText("显示资源未能加载，其他消息仍可使用。", { exact: true })
        .waitFor();
      await p
        .getByRole("button", { name: "重新加载页面", exact: true })
        .waitFor();
      assert.equal(
        await p
          .getByRole("button", { name: "重新显示内容", exact: true })
          .count(),
        0,
      );
      await p
        .getByRole("textbox", { name: "消息", exact: true })
        .fill("still usable");
      await context.close();
    },
  );
  await check(
    "a failed event schema chunk asks for reload instead of spawning reconnect loops",
    async () => {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 1000 },
      });
      const p = await context.newPage();
      page = p;
      let caps = 0;
      p.on("request", (r) => {
        if (r.url().includes("/api/runtime/capabilities")) caps++;
      });
      await p.route(asset("@ag-ui/core/dist/schemas.mjs"), (route) =>
        route.abort("failed"),
      );
      await context.request.post(origin + "/api/login", {
        headers: { origin },
        data: { password: "interaction-ui-fixture-login" },
      });
      await p.goto(origin);
      await p
        .getByRole("button", { name: "重新加载页面", exact: true })
        .waitFor();
      const before = caps;
      await p.waitForTimeout(2300);
      assert.equal(caps, before);
      await context.close();
    },
  );
  for (const transport of ["poll", "sse"]) {
    await check(
      `${transport} repeated rich views, theme changes and dialogs retain one connection without growing subscriptions`,
      async () => {
        const { context, p } = await create(transport);
        page = p;
        const cdp = await context.newCDPSession(p);
        await cdp.send("Performance.enable");
        const choose = async (name) => {
          await p.getByRole("button", { name, exact: true }).click();
        };
        const cycle = async (index) => {
          await choose("富文本主题检查");
          await p.locator(".diagram svg").waitFor();
          await p.locator(".chart svg").waitFor();
          await p.getByRole("button", { name: /个人工作台/ }).click();
          const settings = p.getByRole("dialog", { name: "设置", exact: true });
          await settings
            .getByLabel("外观", { exact: true })
            .selectOption(index % 2 ? "dark" : "light");
          await p.keyboard.press("Escape");
          await settings.waitFor({ state: "hidden" });
          await p
            .getByRole("button", { name: "选择技能", exact: true })
            .click();
          const picker = p.getByRole("dialog", {
            name: "选择技能",
            exact: true,
          });
          await picker.waitFor();
          await p.keyboard.press("Escape");
          await picker.waitFor({ state: "hidden" });
          await choose("历史对话 1：检查窄屏与键盘操作");
          await p.waitForFunction(
            () => !document.querySelector(".diagram,.chart"),
          );
        };
        const sample = async () => {
          await p.waitForTimeout(200);
          await cdp.send("HeapProfiler.collectGarbage");
          await cdp.send("HeapProfiler.collectGarbage");
          const metrics = await cdp.send("Performance.getMetrics"),
            dom = await cdp.send("Memory.getDOMCounters");
          return {
            ...dom,
            heap: metrics.metrics.find((v) => v.name === "JSHeapUsedSize")
              .value,
            counters: await p.evaluate(() => window.__runtimeCounters),
          };
        };
        for (let i = 0; i < 4; i++) await cycle(i);
        const before = await sample();
        for (let i = 0; i < 24; i++) await cycle(i);
        const after = await sample();
        samples[transport] = { before, after, cycles: 28 };
        assert.ok(
          after.nodes <= before.nodes + 300,
          JSON.stringify(samples[transport]),
        );
        assert.ok(
          after.jsEventListeners <= before.jsEventListeners + 60,
          JSON.stringify(samples[transport]),
        );
        assert.ok(
          after.heap <= before.heap + 12 * 1024 * 1024,
          JSON.stringify(samples[transport]),
        );
        assert.equal(after.counters.sources, transport === "sse" ? 1 : 0);
        assert.ok(after.counters.maxPolls <= 1);
        if (transport === "sse") assert.equal(after.counters.sourceStarts, 1);
        // The browser probe itself must have only one output node after repeated updates.
        assert.equal(await p.locator("#newbot-performance").count(), 1);
        await p.getByRole("button", { name: /个人工作台/ }).click();
        const settings = p.getByRole("dialog", { name: "设置", exact: true });
        await settings
          .getByRole("button", { name: "安全与运行", exact: true })
          .click();
        await settings
          .getByRole("button", { name: "退出登录", exact: true })
          .click();
        await p.getByLabel("登录密码").waitFor();
        await p.waitForTimeout(100);
        const stopped = await p.evaluate(() => window.__runtimeCounters);
        assert.equal(stopped.sources, 0);
        assert.equal(stopped.polls, 0);
        await context.close();
      },
    );
  }
  assert.deepEqual(errors, []);
  const context = await browser.newContext();
  await context.request.post(origin + "/api/login", {
    headers: { origin },
    data: { password: "interaction-ui-fixture-login" },
  });
  const counts = await (
    await context.request.get(origin + "/api/test/interaction")
  ).json();
  assert.equal(counts.turns, 0);
  assert.equal(counts.launched, 0);
  assert.equal(counts.pendingPrivateInputs, 0);
  await context.close();
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      { checks, passed: checks.length, samples, counts, pageErrors: errors },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(`Browser runtime: ${checks.length} checks passed`);
} catch (error) {
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify(
      { checks, error: String(error), samples, errors, log },
      null,
      2,
    ),
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
  for (const f of readdirSync(output)) chmodSync(resolve(output, f), 0o600);
}
