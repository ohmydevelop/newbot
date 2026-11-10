import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createA2uiLab } from "./a2ui-lab.mjs";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/a2ui-catalog-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const file of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, file), { force: true });
const app = await createA2uiLab(0, { catalog: true }),
  origin = app.listeningOrigin;
const checks = [],
  errors = [],
  external = [],
  mutations = [];
let browser, page;
async function check(name, action) {
  await action();
  checks.push(name);
  console.log(`PASS ${name}`);
}
const update = (components) => ({
  version: "v0.9",
  updateComponents: { surfaceId: "monitor-demo", components },
});
const data = (path, value) => ({
  version: "v0.9",
  updateDataModel: { surfaceId: "monitor-demo", path, value },
});
try {
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
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith(origin + "/")
    )
      external.push(request.url());
    if (request.method() !== "GET") mutations.push(request.method());
  });
  const panel = page.getByRole("region", {
    name: "助手生成的表单",
    exact: true,
  });
  const input = () => panel.getByLabel("任务名称", { exact: true });
  const submit = () =>
    panel.getByRole("button", { name: "创建任务", exact: true });
  const apply = (message) =>
    page.evaluate(
      (raw) => window.a2uiFixture.apply(raw),
      JSON.stringify(message),
    );
  const control = (value) =>
    page.evaluate((value) => window.a2uiFixture.control(value), value);
  const actions = async () =>
    JSON.parse(await page.getByTestId("actions").textContent());
  const screenshot = (name) =>
    page.screenshot({
      path: resolve(output, `${name}.png`),
      animations: "disabled",
    });
  const reset = async () => {
    await control("normal");
    await page.getByRole("button", { name: "重新载入", exact: true }).click();
    await panel
      .getByRole("heading", { name: "创建监控任务", exact: true })
      .waitFor();
  };
  await page.goto(origin);
  await check(
    "six allowlisted components render native React fields and controls",
    async () => {
      await input().waitFor();
      assert.equal(await input().inputValue(), "资源监控");
      const field = await input().boundingBox();
      const select = await panel
        .getByLabel("服务器", { exact: true })
        .boundingBox();
      assert.ok(field.width > 200 && Math.abs(field.width - select.width) < 8);
      const checkbox = await panel
        .getByLabel("CPU", { exact: true })
        .boundingBox();
      const label = await panel.getByText("CPU", { exact: true }).boundingBox();
      assert.ok(
        Math.abs(
          checkbox.y + checkbox.height / 2 - label.y - label.height / 2,
        ) < 5,
      );
      assert.equal(
        await panel.getByLabel("服务器", { exact: true }).inputValue(),
        "host-a",
      );
      assert.equal(
        await input().evaluate((element) => element.getRootNode() === document),
        true,
      );
      assert.equal(
        await panel.locator("iframe,script,img,input[type=password]").count(),
        0,
      );
      await screenshot("form-desktop");
    },
  );
  await check(
    "two-way fields and single/multiple selection produce the current local action context",
    async () => {
      await input().fill("机器 B 监控");
      await panel.getByLabel("服务器", { exact: true }).selectOption("host-b");
      await panel.getByLabel("内存", { exact: true }).check();
      await panel
        .getByLabel("备注", { exact: true })
        .fill("每天检查\n只记录普通信息");
      await submit().click();
      await page.getByTestId("actions").waitFor();
      const [action] = await actions();
      assert.equal(action.name, "monitor.submit");
      assert.equal(action.surfaceId, "monitor-demo");
      assert.equal(action.sourceComponentId, "submit");
      assert.deepEqual(action.context, {
        name: "机器 B 监控",
        server: ["host-b"],
        metrics: ["cpu", "memory"],
        notes: "每天检查\n只记录普通信息",
      });
    },
  );
  await check(
    "data and component updates preserve input values and focused fields",
    async () => {
      await page.getByRole("button", { name: "更新说明", exact: true }).click();
      await panel
        .getByText("监控设置已更新，已填写的内容会保留。", { exact: true })
        .waitFor();
      assert.equal(await input().inputValue(), "机器 B 监控");
      await input().focus();
      assert.equal(
        await apply(
          update([
            {
              id: "title",
              component: "Text",
              text: "表单已更新",
              variant: "h3",
            },
          ]),
        ),
        "ok",
      );
      await panel
        .getByRole("heading", { name: "表单已更新", exact: true })
        .waitFor();
      assert.equal(
        await input().evaluate((element) => element === document.activeElement),
        true,
      );
    },
  );
  await check(
    "host read-only state disables all editable controls and actions",
    async () => {
      await page.getByLabel("只读展示", { exact: true }).check();
      assert.equal(await input().isDisabled(), true);
      assert.equal(
        await panel.getByLabel("CPU", { exact: true }).isDisabled(),
        true,
      );
      assert.equal(await submit().isDisabled(), true);
      await page.getByLabel("只读展示", { exact: true }).uncheck();
    },
  );
  await check(
    "trusted ordinary-input notice describes fields and cannot be overwritten by model properties",
    async () => {
      const description = await input().getAttribute("aria-describedby");
      assert.ok(description);
      assert.match(
        await page.locator(`[id="${description}"]`).textContent(),
        /请勿填写密码或密钥/,
      );
      assert.notEqual(
        await apply(
          update([
            {
              id: "name",
              component: "TextField",
              label: "凭证",
              value: { path: "/name" },
              variant: "obscured",
            },
          ]),
        ),
        "ok",
      );
      assert.equal(await panel.locator("input[type=password]").count(), 0);
      assert.equal(await input().inputValue(), "机器 B 监控");
    },
  );
  await check(
    "unknown components, executable properties, regex and functions fail without clearing inputs",
    async () => {
      for (const component of [
        { id: "title", component: "Image", url: "https://example.invalid" },
        {
          id: "title",
          component: "Text",
          text: "inert",
          onClick: "window.pwned=true",
        },
        {
          id: "title",
          component: "Text",
          text: { call: "eval", args: { value: "window.pwned=true" } },
        },
        {
          id: "name",
          component: "TextField",
          label: "输入",
          value: { path: "/name" },
          validationRegexp: "(a+)+$",
        },
        {
          id: "submit",
          component: "Button",
          child: "submit-label",
          action: { event: { name: "shell.run", context: {} } },
        },
      ]) {
        assert.notEqual(
          await apply([data("/name", "must-not-commit"), update([component])]),
          "ok",
        );
        assert.equal(await input().inputValue(), "机器 B 监控");
      }
      assert.equal(await page.evaluate(() => window.pwned), undefined);
    },
  );
  await check(
    "large collections and repeated-child expansion are rejected before rendering",
    async () => {
      assert.equal(
        await apply(
          update([
            {
              id: "title",
              component: "Text",
              text: Array(65).fill({ invalid: true }),
            },
          ]),
        ),
        "RESOURCE_LIMIT",
      );
      assert.equal(
        await apply(
          update([
            { id: "root", component: "Column", children: ["title", "title"] },
          ]),
        ),
        "INVALID_TREE",
      );
      assert.equal(await input().inputValue(), "机器 B 监控");
    },
  );
  await check(
    "bad paths, cross-surface writes and catalog changes cannot affect the active form",
    async () => {
      for (const message of [
        data("/__proto__/polluted", true),
        data("/array/1000000", "bad"),
        {
          version: "v0.9",
          updateDataModel: { surfaceId: "other", path: "/name", value: "bad" },
        },
        {
          version: "v0.9",
          createSurface: {
            surfaceId: "monitor-demo",
            catalogId: "https://example.invalid/catalog",
          },
        },
      ])
        assert.notEqual(await apply(message), "ok");
      assert.equal(await input().inputValue(), "机器 B 监控");
      assert.equal(await page.evaluate(() => ({}).polluted), undefined);
    },
  );
  await check(
    "bound type and selection errors retain the previous valid data",
    async () => {
      assert.notEqual(await apply(data("/server", ["not-an-option"])), "ok");
      assert.notEqual(await apply(data("/name", { wrong: true })), "ok");
      assert.equal(
        await panel.getByLabel("服务器", { exact: true }).inputValue(),
        "host-b",
      );
      assert.equal(await input().inputValue(), "机器 B 监控");
    },
  );
  await check(
    "HTML in text remains literal and never creates active DOM",
    async () => {
      const attack =
        '<img src="https://example.invalid/x" onerror="window.pwned=true"><script>window.pwned=true</script>';
      assert.equal(await apply(data("/status", attack)), "ok");
      await panel.getByText(attack, { exact: true }).waitFor();
      assert.equal(await panel.locator("img,script").count(), 0);
      assert.equal(await page.evaluate(() => window.pwned), undefined);
    },
  );
  await check(
    "one pending local action disables edits and prevents duplicate submission",
    async () => {
      await reset();
      await control("defer");
      await submit().click();
      await page.waitForFunction(
        () =>
          document.querySelector(".a2ui-panel")?.getAttribute("aria-busy") ===
          "true",
      );
      assert.equal(await input().isDisabled(), true);
      assert.equal(await submit().isDisabled(), true);
      await submit().evaluate((element) => element.click());
      await control("resolve");
      await page.getByTestId("actions").waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector(".a2ui-panel")?.getAttribute("aria-busy") ===
          "false",
      );
      assert.equal((await actions()).length, 1);
    },
  );
  await check(
    "consumer rejection is shown safely and releases action controls for retry",
    async () => {
      await control("reject");
      await submit().click();
      await panel
        .getByRole("alert")
        .filter({ hasText: "操作未能提交，请重试。" })
        .waitFor();
      assert.equal(await submit().isDisabled(), false);
      await control("normal");
      await submit().click();
      await page.waitForFunction(
        () =>
          JSON.parse(
            document.querySelector('[data-testid="actions"]').textContent,
          ).length === 2,
      );
      assert.equal(await panel.getByRole("alert").count(), 0);
    },
  );
  await check(
    "cancel remains a structured local action without direct tool permissions",
    async () => {
      await panel.getByRole("button", { name: "取消", exact: true }).click();
      await page.waitForFunction(
        () =>
          JSON.parse(
            document.querySelector('[data-testid="actions"]').textContent,
          ).length === 3,
      );
      assert.equal((await actions())[2].name, "monitor.cancel");
      assert.deepEqual((await actions())[2].context, {});
    },
  );
  await check(
    "delete removes controls and rejects late data updates",
    async () => {
      await page.getByRole("button", { name: "关闭表单", exact: true }).click();
      await panel.getByText("当前表单已关闭。", { exact: true }).waitFor();
      assert.equal(await panel.getByRole("button").count(), 0);
      assert.equal(await apply(data("/name", "late")), "SURFACE_MISSING");
    },
  );
  await check(
    "repeated rebuilds dispose old bindings and emit one current action",
    async () => {
      for (let i = 0; i < 8; i++) await reset();
      await submit().click();
      await page.getByTestId("actions").waitFor();
      assert.equal((await actions()).length, 1);
      assert.equal(await panel.getByRole("textbox").count(), 2);
      assert.equal(await input().inputValue(), "资源监控");
    },
  );
  await check(
    "rebuilding while an action waits does not append an old result to the new form",
    async () => {
      await control("defer");
      await submit().click();
      await page.waitForFunction(
        () =>
          document.querySelector(".a2ui-panel")?.getAttribute("aria-busy") ===
          "true",
      );
      await reset();
      assert.equal(await submit().isDisabled(), false);
      await submit().click();
      await page.getByTestId("actions").waitFor();
      assert.equal((await actions()).length, 1);
    },
  );
  await check(
    "keyboard navigation follows the field order with visible focus",
    async () => {
      await input().focus();
      await page.keyboard.press("Tab");
      assert.equal(
        await panel
          .getByLabel("服务器", { exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
    },
  );
  await check(
    "mobile form wraps with usable touch targets and no horizontal overflow",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await input().fill("手机端监控任务");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      for (const element of [
        input(),
        panel.getByLabel("服务器", { exact: true }),
        submit(),
      ])
        assert.ok((await element.boundingBox()).height >= 44);
      await screenshot("form-mobile");
    },
  );
  await check(
    "dark form uses product tokens and preserves selections and input",
    async () => {
      await page.emulateMedia({ colorScheme: "dark" });
      assert.equal(await input().inputValue(), "手机端监控任务");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await screenshot("form-mobile-dark");
    },
  );
  await check(
    "fixture performs no network actions, model calls or browser errors",
    async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      assert.deepEqual(mutations, []);
      assert.equal(
        (
          await context.request.post(origin + "/api/agent/run", { data: {} })
        ).status(),
        404,
      );
    },
  );
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        checks,
        pageErrors: errors,
        externalRequests: external,
        browserMutations: mutations,
      },
      null,
      2,
    ),
  );
  console.log(`${checks.length} A2UI catalog browser checks passed`);
} catch (error) {
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify(
      { checks, error: String(error), pageErrors: errors },
      null,
      2,
    ),
  );
  if (page)
    await page
      .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await browser?.close();
  await app.close();
}
