// Isolated A2UI scenario runner: three surfaces, four viewport/theme captures each.
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.ts";
import { A2uiFixtureCodex, formMessages } from "../tests/a2ui-fixture.ts";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright",
);

const dir = process.env.A2UI_EVIDENCE_DIR || ".issue/2026-11-12/evidence-a2ui";
mkdirSync(dir, { recursive: true });
const port = 3126;
const origin = `http://127.0.0.1:${port}`;
const directory = mkdtempSync(join(tmpdir(), "newbot-a2ui-scenes-"));

const dashboard = () => [
  {
    version: "v0.9",
    createSurface: { surfaceId: "dash", catalogId: "newbot:ui/v2" },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "dash",
      components: [
        { id: "root", component: "Column", children: ["h", "cap", "g", "c", "l"] },
        { id: "h", component: "Text", variant: "h3", text: "服务健康度" },
        {
          id: "cap",
          component: "Text",
          variant: "caption",
          text: "过去 24 小时 · 生产集群",
        },
        { id: "g", component: "Grid", columns: 3, children: ["m1", "m2", "m3"] },
        { id: "m1", component: "Metric", label: "可用性", value: "99.98%", detail: "目标 99.9%" },
        { id: "m2", component: "Metric", label: "P95 延迟", value: "182 ms", detail: "较昨日 -12%" },
        { id: "m3", component: "Metric", label: "错误率", value: "0.42%", detail: "阈值 1%" },
        {
          id: "c",
          component: "Chart",
          kind: "line",
          title: "请求量",
          labels: ["00", "04", "08", "12", "16", "20"],
          series: [{ name: "请求", values: [120, 180, 240, 320, 280, 160] }],
        },
        { id: "l", component: "List", variant: "bordered", children: ["i1", "i2", "i3"] },
        { id: "i1", component: "Text", text: "api-gateway 已重启，耗时 4 秒" },
        { id: "i2", component: "Text", text: "worker-3 内存回落到 61%" },
        { id: "i3", component: "Text", text: "redis 连接池无等待" },
      ],
    },
  },
];

const workbench = () => [
  {
    version: "v0.9",
    createSurface: { surfaceId: "work", catalogId: "newbot:ui/v2" },
  },
  {
    version: "v0.9",
    updateComponents: {
      surfaceId: "work",
      components: [
        { id: "root", component: "Column", children: ["h", "cap", "g", "src"] },
        { id: "h", component: "Text", variant: "h3", text: "变更评审摘要" },
        { id: "cap", component: "Text", variant: "caption", text: "来自 3 个仓库的 12 条变更" },
        { id: "g", component: "Grid", columns: 2, spans: [1, 1], children: ["left", "c2"] },
        { id: "left", component: "Column", children: ["t1", "l"] },
        { id: "t1", component: "Text", text: "本周合并集中在鉴权与缓存层，两个回滚点已排查。" },
        { id: "l", component: "List", variant: "bordered", children: ["li1", "li2"] },
        { id: "li1", component: "Text", text: "auth: 会话校验改为单次查询" },
        { id: "li2", component: "Text", text: "cache: 失效策略从 TTL 改为主动失效" },
        {
          id: "c2",
          component: "Chart",
          kind: "bar",
          title: "改动量",
          labels: ["auth", "cache", "ui"],
          series: [{ name: "行数", values: [120, 90, 60] }],
        },
        {
          id: "src",
          component: "SourceLink",
          label: "查看完整报告",
          url: "https://example.com/report",
        },
      ],
    },
  },
];

const codex = new A2uiFixtureCodex();
const call = codex.call.bind(codex);
const queue = [
  { messages: dashboard, wait: false },
  { messages: formMessages, wait: true },
  { messages: workbench, wait: false },
];
let lastThread = "";
let lastTurn = "";
codex.call = (async (method, params) => {
  const result = await call(method, params);
  if (method === "turn/start") {
    lastThread = params.threadId;
    lastTurn = result.turn.id;
    const next = queue.shift() || { messages: workbench, wait: false };
    setTimeout(
      () =>
        codex.tool(params.threadId, result.turn.id, {
          messages: next.messages(),
          waitForAction: next.wait,
        }),
      40,
    );
  }
  return result;
});

const ctx = await createServer({
  providerRuntime: null,
  directory,
  cwd: join(directory, "workspace"),
  password: "a2ui-scene-password",
  codex,
  origins: [origin],
});
await ctx.app.listen({ host: "127.0.0.1", port });

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM }
    : {},
);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(origin);
await page.getByLabel("登录密码").fill("a2ui-scene-password");
await page.getByRole("button", { name: "继续", exact: true }).click();
const input = page.getByRole("textbox", { name: "消息", exact: true });
await input.waitFor();

const prompts = ["看看服务健康度", "帮我创建一个监控任务", "总结本周变更"];
const names = ["dashboard", "form", "workbench"];
const checks = {};
try {
for (let i = 0; i < prompts.length; i++) {
  console.log("SCENE", i, prompts[i]);
  const reopen = page.getByRole("button", { name: "展开侧栏" });
  if (await reopen.count()) await reopen.first().click();
  await page.getByRole("button", { name: "新聊天" }).click();
  await input.fill(prompts[i]);
  await input.press("Enter");
  try {
    await page.waitForSelector(".a2ui-panel", { timeout: 15000 });
  } catch (e) {
    console.log("FAILED SCENE", i, JSON.stringify(codex.toolResponses.map((r) => r.response)).slice(0, 500), JSON.stringify(errors).slice(0, 400));
    await page.screenshot({ path: `${dir}/failed-${names[i]}.png` });
    throw e;
  }
  await page.waitForTimeout(1400);
  if (i === 0) {
    checks.panel = await page.evaluate(() => {
      const panel = document.querySelector(".a2ui-panel");
      const cs = getComputedStyle(panel);
      const field = panel.querySelector(".a2ui-field input, .a2ui-field select");
      const grid = panel.querySelector(".a2ui-grid");
      const primary = [...panel.querySelectorAll(".a2ui-button")].find((b) =>
        b.className.includes("primary"),
      );
      return {
        background: cs.backgroundColor,
        font: cs.fontSize,
        line: cs.lineHeight,
        tracking: cs.letterSpacing,
        radius: cs.borderRadius,
        gridColumns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").length : 0,
        metricRadius: getComputedStyle(panel.querySelector(".a2ui-metric")).borderRadius,
        fieldBackground: field ? getComputedStyle(field).backgroundColor : null,
        primaryBackground: primary ? getComputedStyle(primary).backgroundColor : null,
      };
    });
  }
  if (i === 1) {
    checks.form = await page.evaluate(() => {
      const panel = document.querySelector(".a2ui-panel");
      const field = panel.querySelector(".a2ui-field input, .a2ui-field select");
      const primary = [...panel.querySelectorAll(".a2ui-button")].find((b) =>
        b.className.includes("primary"),
      );
      return {
        actions: [...panel.querySelectorAll(".a2ui-button")].map((b) =>
          b.textContent?.trim(),
        ),
        fieldBackground: field ? getComputedStyle(field).backgroundColor : null,
        fieldRadius: field ? getComputedStyle(field).borderRadius : null,
        primaryBackground: primary ? getComputedStyle(primary).backgroundColor : null,
      };
    });
  }
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${dir}/${names[i]}-desktop-light.png`, fullPage: true });
  await page.evaluate(() => (document.documentElement.dataset.theme = "dark"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${dir}/${names[i]}-desktop-dark.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}/${names[i]}-mobile-dark.png` });
  checks[`${names[i]}MobileOverflow`] = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  await page.evaluate(() => (document.documentElement.dataset.theme = "light"));
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${dir}/${names[i]}-mobile-light.png` });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(300);
  codex.finish(lastThread);
  await page.waitForTimeout(500);
}

} catch (e) {
  console.log("SCENE ERROR", String(e).slice(0, 300), "RESPONSES", codex.toolResponses.length);
  throw e;
}
checks.consoleErrors = errors;
await browser.close();
await ctx.app.close();
rmSync(directory, { recursive: true, force: true });
console.log(JSON.stringify(checks, null, 2));
