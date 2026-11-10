import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/configuration-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const file of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, file), { force: true });
const port = Number(process.env.CONFIG_TEST_PORT || 3112),
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "tests/config-preview-server.ts"],
  {
    env: { ...process.env, NODE_ENV: "test", CONFIG_TEST_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const exited = new Promise((resolve) => server.once("exit", resolve));
let log = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Configuration fixture did not start")),
    15000,
  );
  const collect = (data) => {
    log += data.toString();
    if (log.includes("Configuration UI fixture ready:")) {
      clearTimeout(timer);
      resolve();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", (code) => {
    clearTimeout(timer);
    reject(new Error(`Fixture exited ${code}: ${log}`));
  });
});
let browser, page, other;
const checks = [],
  errors = [],
  external = [],
  posts = [];
const check = async (name, fn) => {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
};
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
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (/^https?:/.test(r.url()) && !r.url().startsWith(origin + "/"))
        external.push(r.url());
      if (r.method() === "POST" && r.url() === origin + "/api/config")
        posts.push(JSON.parse(r.postData()));
    });
    return { context, page };
  };
  const a = await create(),
    b = await create();
  page = a.page;
  other = b.page;
  const open = async (p) => {
    await p.getByPlaceholder("询问任何问题").waitFor();
    if (await p.getByRole("button", { name: "展开侧栏", exact: true }).count())
      await p.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await p.getByRole("button", { name: "个人工作台 私有实例" }).click();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "模型与 Provider", exact: true })
      .click();
    await p
      .getByRole("dialog")
      .getByLabel("默认模型", { exact: true })
      .locator('option[value="second-model"]')
      .waitFor({ state: "attached" });
  };
  const login = async (p) => {
    await p.goto(origin);
    await p.getByLabel("登录密码").fill("config-ui-test-password");
    await p.getByRole("button", { name: "继续", exact: true }).click();
    await open(p);
  };
  const dialog = (p = page) => p.getByRole("dialog");
  const effort = (p = page) =>
    dialog(p).getByLabel("默认推理强度", { exact: true });
  const save = async (p = page, expected = 200) => {
    const event = p.waitForResponse(
      (r) => r.url().endsWith("/api/config") && r.request().method() === "POST",
    );
    await dialog(p)
      .getByRole("button", { name: "保存到 Codex", exact: true })
      .click();
    const response = await event;
    assert.equal(response.status(), expected, await response.text());
    return response;
  };
  const reload = async (p = page) => {
    const event = p.waitForResponse(
      (r) => r.url().endsWith("/api/config") && r.request().method() === "GET",
    );
    await dialog(p)
      .getByRole("button", { name: /^(读取最新并重置修改|重新读取配置)$/ })
      .click();
    await event;
    await p.waitForFunction(
      () =>
        !document.querySelector(".configuration-actions button:last-child")
          ?.disabled,
    );
  };
  const control = async (action) => {
    assert.equal(
      (
        await a.context.request.post(`${origin}/api/test/config`, {
          headers: { origin },
          data: { action },
        })
      ).status(),
      200,
    );
  };
  const state = async () =>
    await (
      await a.context.request.get(`${origin}/api/test/config-state`)
    ).json();
  await login(page);
  await login(other);
  await check(
    "configuration reads show safe provenance and do not expose raw secrets or endpoints",
    async () => {
      assert.equal(await effort().inputValue(), "medium");
      assert.equal(
        await dialog()
          .getByRole("button", { name: "保存到 Codex", exact: true })
          .isDisabled(),
        true,
      );
      assert.ok(!(await page.content()).includes("SYNTHETIC_CONFIG_SECRET"));
      await dialog()
        .getByText("端点：https://api.example.com", { exact: true })
        .waitFor();
      await page.screenshot({
        path: `${output}/defaults-desktop.png`,
        animations: "disabled",
      });
    },
  );
  await check(
    "successful saves send a revision and read back the actual state",
    async () => {
      await dialog()
        .getByLabel("默认模型", { exact: true })
        .selectOption("second-model");
      await effort().selectOption("high");
      await save();
      await dialog()
        .getByRole("status")
        .filter({ hasText: "读取确认生效" })
        .waitFor();
      assert.equal((await state()).model, "second-model");
      assert.equal((await state()).effort, "high");
      assert.match(posts.at(-1).expectedRevision, /^cfg1\.[a-f0-9]{64}$/);
      assert.deepEqual(Object.keys(posts.at(-1)).sort(), [
        "action",
        "effort",
        "expectedRevision",
        "model",
      ]);
    },
  );
  await check(
    "a stale second browser cannot overwrite changes and retains its draft",
    async () => {
      await effort(other).selectOption("low");
      await save(other, 409);
      await dialog(other)
        .getByRole("alert")
        .filter({ hasText: "配置已被其他操作修改" })
        .waitFor();
      assert.equal(await effort(other).inputValue(), "low");
      assert.equal((await state()).effort, "high");
      assert.equal((await state()).writes, 1);
      await reload(other);
      assert.equal(await effort(other).inputValue(), "high");
      await effort(other).selectOption("low");
      await save(other);
      assert.equal((await state()).effort, "low");
    },
  );
  await check(
    "external changes invalidate old proposals without automatic rebasing",
    async () => {
      await effort().selectOption("medium");
      await control("external");
      await save(page, 409);
      assert.equal(await effort().inputValue(), "medium");
      await reload();
      assert.equal(await effort().inputValue(), "medium");
    },
  );
  await check(
    "native write failures preserve draft values and recover through explicit reading",
    async () => {
      await effort().selectOption("high");
      await control("fail-write");
      await save(page, 502);
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "配置保存失败" })
        .waitFor();
      assert.equal(await effort().inputValue(), "high");
      assert.equal((await state()).effort, "medium");
      await control("recover-write");
      await reload();
      assert.equal(await effort().inputValue(), "medium");
    },
  );
  await check(
    "overridden writes show effective values and source instead of claiming success",
    async () => {
      await control("overridden");
      await reload();
      await effort().selectOption("high");
      const response = await save();
      assert.equal((await response.json()).state, "overridden");
      await dialog()
        .getByRole("status")
        .filter({ hasText: "受其他配置覆盖" })
        .waitFor();
      assert.equal(await effort().inputValue(), "medium");
      assert.equal((await state()).effort, "high");
      await page.screenshot({
        path: `${output}/defaults-overridden.png`,
        animations: "disabled",
      });
      await control("clear-override");
      await reload();
    },
  );
  await check(
    "unconfirmed native responses do not trigger automatic repeated writes",
    async () => {
      await effort().selectOption("low");
      await control("lost-response");
      const before = (await state()).writes;
      await save(page, 409);
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "保存期间发生变化" })
        .waitFor();
      assert.equal((await state()).writes, before + 1);
      assert.equal((await state()).effort, "low");
      await reload();
      assert.equal(await effort().inputValue(), "low");
    },
  );
  await check(
    "busy tasks block configuration writes and preserve drafts",
    async () => {
      await effort().selectOption("high");
      await control("busy");
      const before = (await state()).writes;
      await save(page, 400);
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "等待任务" })
        .waitFor();
      assert.equal((await state()).writes, before);
      await control("idle");
      await reload();
    },
  );
  await check(
    "read failures disable saving and can recover without leaking diagnostics",
    async () => {
      await control("fail-read");
      await reload();
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "配置读取失败" })
        .waitFor();
      assert.equal(
        await dialog()
          .getByRole("button", { name: "保存到 Codex", exact: true })
          .isDisabled(),
        true,
      );
      assert.ok(!(await page.content()).includes("SYNTHETIC_CONFIG_SECRET"));
      await control("recover-read");
      await reload();
    },
  );
  await check(
    "saving defaults preserves the current conversation selection and applies to a new chat",
    async () => {
      await page.keyboard.press("Escape");
      await page.getByPlaceholder("询问任何问题").fill("保持当前对话的模型");
      const request = page.waitForResponse((r) =>
        r.url().endsWith("/api/agent/run"),
      );
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      assert.equal((await request).status(), 200);
      await control("complete");
      await page
        .getByRole("button", { name: "发送消息", exact: true })
        .waitFor();
      const before = await page.locator(".model-trigger span").textContent();
      await open(page);
      await dialog()
        .getByLabel("默认模型", { exact: true })
        .selectOption("second-model");
      await effort().selectOption("high");
      await save();
      assert.equal(
        await page.locator(".model-trigger span").textContent(),
        before,
      );
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Minimal Agent，新对话", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          document.querySelector(".model-trigger span")?.textContent ===
          "测试模型二",
      );
      const fresh = await create();
      await login(fresh.page);
      assert.equal(
        await fresh.page.locator(".model-trigger span").textContent(),
        "测试模型二",
      );
      assert.match(
        await fresh.page.locator(".effort-trigger").textContent(),
        /深度思考/,
      );
      await fresh.context.close();
      await open(page);
    },
  );
  await check(
    "mobile and landscape keep settings, save and reload controls reachable",
    async () => {
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.reload();
      await open(page);
      await effort().selectOption("high");
      const saveButton = dialog().getByRole("button", {
        name: "保存到 Codex",
        exact: true,
      });
      await saveButton.scrollIntoViewIfNeeded();
      assert.ok((await saveButton.boundingBox()).height >= 44);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await page.screenshot({
        path: `${output}/defaults-mobile-dark.png`,
        animations: "disabled",
      });
      await page.keyboard.press("Escape");
      await page.setViewportSize({ width: 812, height: 375 });
      await page.reload();
      await open(page);
      await effort().selectOption("high");
      await dialog()
        .getByRole("button", { name: "保存到 Codex", exact: true })
        .scrollIntoViewIfNeeded();
      const rect = await dialog()
        .getByRole("button", { name: "保存到 Codex", exact: true })
        .boundingBox();
      assert.ok(rect.y >= 0 && rect.y + rect.height <= 375);
      await page.screenshot({
        path: `${output}/defaults-landscape.png`,
        animations: "disabled",
      });
    },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  writeFileSync(
    `${output}/result.json`,
    JSON.stringify(
      { checks, pageErrors: errors, externalRequests: external },
      null,
      2,
    ),
  );
  console.log(
    `Configuration UI regression: ${checks.length} checks passed. Evidence: ${output}`,
  );
} catch (error) {
  await page
    ?.screenshot({ path: `${output}/failure.png`, animations: "disabled" })
    .catch(() => {});
  writeFileSync(
    `${output}/failure.json`,
    JSON.stringify(
      { error: String(error), checks, pageErrors: errors, fixtureLog: log },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
  await exited;
}
