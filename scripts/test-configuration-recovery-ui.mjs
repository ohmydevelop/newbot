import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  output = resolve(".data/configuration-recovery-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const f of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, f), { force: true });
const port = Number(process.env.RECOVERY_TEST_PORT || 3115),
  origin = `http://127.0.0.1:${port}`,
  server = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "tests/recovery-preview-server.ts"],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        RECOVERY_TEST_PORT: String(port),
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
      if (log.includes("Recovery UI fixture ready")) {
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
let browser, page, other;
const checks = [],
  errors = [],
  external = [],
  payloads = [];
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
    const c = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: "reduce",
    });
    c.setDefaultTimeout(15000);
    const p = await c.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (/^https?:/.test(r.url()) && !r.url().startsWith(origin + "/"))
        external.push(r.url());
      if (r.method() === "POST" && r.url().includes("/api/"))
        payloads.push(JSON.parse(r.postData() || "{}"));
    });
    return p;
  };
  page = await create();
  other = await create();
  const open = async (p, tab = "模型与 Provider") => {
    await p.getByPlaceholder("询问任何问题").waitFor();
    if (await p.getByRole("button", { name: "展开侧栏", exact: true }).count())
      await p.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await p.getByRole("button", { name: "个人工作台 私有实例" }).click();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: tab, exact: true })
      .click();
  };
  const login = async (p) => {
    await p.goto(origin);
    await p.getByLabel("登录密码").fill("recovery-ui-test-password");
    await p.getByRole("button", { name: "继续", exact: true }).click();
    await open(p);
    await p
      .getByLabel("默认推理强度", { exact: true })
      .locator('option[value="high"]')
      .waitFor({ state: "attached" });
  };
  const defaults = (p = page) =>
      p.getByRole("region", { name: "默认模型配置" }),
    providers = (p = page) => p.getByRole("region", { name: "Provider 管理" }),
    mcps = (p = page) => p.getByRole("region", { name: "MCP 管理" }),
    feedback = (r) => r.getByRole("region", { name: "配置恢复" }),
    button = (r, name) => r.getByRole("button", { name, exact: true }),
    effort = (p = page) =>
      defaults(p).getByLabel("默认推理强度", { exact: true });
  const post = async (r, name, status = 200) => {
    const pending = page.waitForResponse(
      (res) =>
        res.url().startsWith(origin + "/api/") &&
        res.request().method() === "POST" &&
        !res.url().includes("/api/test/"),
    );
    await button(r, name).click();
    const response = await pending;
    assert.equal(response.status(), status, await response.text());
    return response;
  };
  const save = async (status = 200) => post(defaults(), "保存到 Codex", status),
    control = async (action) =>
      assert.equal(
        (
          await page.request.post(origin + "/api/test/recovery", {
            headers: { origin },
            data: { action },
          })
        ).status(),
        200,
      ),
    state = async () =>
      (await page.request.get(origin + "/api/test/recovery-state")).json();
  const reset = async () => {
    const r = defaults();
    await r
      .getByRole("button", { name: /^读取最新并重置修改$|^重新读取配置$/ })
      .click();
    await button(r, "保存到 Codex").waitFor();
    await r
      .getByText("配置暂不可读", { exact: false })
      .waitFor({ state: "hidden" });
  };
  const read = async (r) => {
    await post(feedback(r), "读取当前生效配置");
    await feedback(r).getByText("当前生效配置", { exact: true }).waitFor();
  };
  const adopt = async (r) => {
    await feedback(r)
      .getByRole("button", { name: /^采用当前配置/ })
      .click();
    await feedback(r).waitFor({ state: "hidden" });
  };
  await login(page);
  await login(other);
  await check(
    "a conflicting defaults draft is frozen until the user reads and explicitly adopts current state",
    async () => {
      await effort().selectOption("high");
      await other
        .getByLabel("默认推理强度", { exact: true })
        .selectOption("low");
      const event = other.waitForResponse(
        (r) =>
          r.url().endsWith("/api/config") && r.request().method() === "POST",
      );
      await button(defaults(other), "保存到 Codex").click();
      assert.equal((await event).status(), 200);
      await save(409);
      assert.equal(await effort().inputValue(), "high");
      assert.equal(await button(defaults(), "保存到 Codex").isDisabled(), true);
      const before = (await state()).writes;
      await read(defaults());
      assert.equal(await effort().inputValue(), "high");
      assert.equal(await button(defaults(), "保存到 Codex").isDisabled(), true);
      await feedback(defaults()).getByText("low", { exact: true }).waitFor();
      assert.equal((await state()).writes, before);
      await adopt(defaults());
      assert.equal(await effort().inputValue(), "low");
    },
  );
  await check(
    "a rejected write keeps its draft and same-version reading allows an explicit retry",
    async () => {
      await effort().selectOption("high");
      await control("fail-write");
      await save(502);
      assert.equal(await effort().inputValue(), "high");
      assert.equal(await button(defaults(), "保存到 Codex").isDisabled(), true);
      await control("recover-write");
      const before = (await state()).writes;
      await read(defaults());
      await feedback(defaults())
        .getByText("配置版本未变化，可检查草稿后重新保存。", { exact: true })
        .waitFor();
      assert.equal((await state()).writes, before);
      assert.equal(await button(defaults(), "保存到 Codex").isEnabled(), true);
      await save();
      assert.equal((await state()).effort, "high");
    },
  );
  await check(
    "lost native replies report uncertainty and read back without resubmitting the edit",
    async () => {
      await effort().selectOption("low");
      await control("lost-response");
      await save(409);
      const before = (await state()).writes;
      await feedback(defaults())
        .getByText("当前结果尚未确认，请先读取配置再决定下一步。", {
          exact: true,
        })
        .waitFor();
      await read(defaults());
      assert.equal((await state()).writes, before);
      await adopt(defaults());
      assert.equal(await effort().inputValue(), "low");
    },
  );
  await check(
    "a dropped HTTP response is treated as unconfirmed even when the server committed the change",
    async () => {
      let dropped = false;
      await page.route("**/api/config", async (route) => {
        if (
          !dropped &&
          route.request().method() === "POST" &&
          JSON.parse(route.request().postData()).action === "settings/defaults"
        ) {
          dropped = true;
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          await route.abort("failed");
        } else await route.continue();
      });
      await effort().selectOption("high");
      await button(defaults(), "保存到 Codex").click();
      await feedback(defaults())
        .getByRole("alert")
        .filter({ hasText: "连接中断" })
        .waitFor();
      assert.equal((await state()).effort, "high");
      const before = (await state()).writes;
      await read(defaults());
      assert.equal((await state()).writes, before);
      await adopt(defaults());
      await page.unroute("**/api/config");
    },
  );
  await check(
    "partial source overrides show acknowledged persistence and the actual effective defaults",
    async () => {
      await control("external");
      await control("overridden");
      await reset();
      await effort().selectOption("high");
      await save();
      await feedback(defaults())
        .getByText("配置已提交到服务端，请核对实际生效状态。", { exact: true })
        .waitFor();
      assert.equal((await state()).effort, "high");
      const before = (await state()).writes;
      await read(defaults());
      await feedback(defaults()).getByText("medium", { exact: true }).waitFor();
      assert.equal((await state()).writes, before);
      await adopt(defaults());
      await control("clear-override");
      await reset();
    },
  );
  await check(
    "acknowledged defaults with failed readback reconnect inside settings and preserve the committed value",
    async () => {
      await effort().selectOption("low");
      await control("readback-fail");
      await save(502);
      assert.equal((await state()).runtime, "offline");
      await feedback(defaults())
        .getByText("配置已提交到服务端，请核对实际生效状态。", { exact: true })
        .waitFor();
      await control("recover-read");
      const before = (await state()).writes;
      await post(feedback(defaults()), "重新连接并读取配置");
      await feedback(defaults())
        .getByText("当前生效配置", { exact: true })
        .waitFor();
      assert.equal((await state()).writes, before);
      assert.equal((await state()).runtime, "ready");
      assert.equal(await page.getByRole("dialog").isVisible(), true);
      await adopt(defaults());
      assert.equal(await effort().inputValue(), "low");
    },
  );
  await check(
    "Provider restart failures use the same saved-state and reconnect flow without losing the form",
    async () => {
      const r = providers();
      await button(r, "编辑 secondary").click();
      await r.getByLabel("显示名称", { exact: true }).fill("Recovered label");
      await control("fail-restart");
      await post(r, "保存 Provider", 502);
      assert.equal(
        await r.getByLabel("显示名称", { exact: true }).inputValue(),
        "Recovered label",
      );
      await feedback(r)
        .getByText("配置已提交到服务端，请核对实际生效状态。", { exact: true })
        .waitFor();
      const before = (await state()).writes;
      await post(feedback(r), "重新连接并读取配置");
      await feedback(r).getByText("Recovered label", { exact: true }).waitFor();
      assert.equal((await state()).writes, before);
      assert.equal(await button(r, "保存 Provider").isDisabled(), true);
      await adopt(r);
      await r.getByText("Recovered label", { exact: true }).waitFor();
    },
  );
  await check(
    "MCP reload failures recover in the same panel while keeping timeout edits and avoiding duplicate writes",
    async () => {
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "MCP 连接", exact: true })
        .click();
      const r = mcps();
      await button(r, "编辑 local").click();
      await r.getByLabel("工具超时（秒）", { exact: true }).fill("110");
      await control("fail-reload");
      await post(r, "保存 MCP", 502);
      assert.equal(
        await r.getByLabel("工具超时（秒）", { exact: true }).inputValue(),
        "110",
      );
      await control("recover-reload");
      const before = (await state()).writes;
      await post(feedback(r), "重新连接并读取配置");
      await feedback(r).getByText("当前生效配置", { exact: true }).waitFor();
      assert.equal((await state()).writes, before);
      await adopt(r);
      assert.equal((await state()).mcpTimeout, 110);
    },
  );
  await check(
    "reconnect never interrupts an active task or clears its reservation",
    async () => {
      const r = mcps();
      await button(r, "编辑 local").click();
      await r.getByLabel("工具超时（秒）", { exact: true }).fill("115");
      await control("fail-reload");
      await post(r, "保存 MCP", 502);
      await control("recover-reload");
      await control("busy");
      const before = (await state()).restarts;
      await post(feedback(r), "重新连接并读取配置", 400);
      assert.equal((await state()).active, 1);
      assert.equal((await state()).interrupts, 0);
      assert.equal((await state()).restarts, before);
      await control("idle");
      await post(feedback(r), "重新连接并读取配置");
      await feedback(r).getByText("当前生效配置", { exact: true }).waitFor();
      await adopt(r);
    },
  );
  await check(
    "failed reconnects keep the recovery actions and release the server guard for a later attempt",
    async () => {
      const r = mcps();
      await button(r, "编辑 local").click();
      await r.getByLabel("工具超时（秒）", { exact: true }).fill("116");
      await control("fail-reload");
      await post(r, "保存 MCP", 502);
      await control("recover-reload");
      await control("fail-restart");
      await post(feedback(r), "重新连接并读取配置", 502);
      assert.equal((await state()).runtime, "offline");
      assert.equal(
        await r.getByLabel("工具超时（秒）", { exact: true }).inputValue(),
        "116",
      );
      await post(feedback(r), "重新连接并读取配置");
      await feedback(r).getByText("当前生效配置", { exact: true }).waitFor();
      await adopt(r);
    },
  );
  await check(
    "errors focus the recovery panel and mobile controls remain reachable with 44px targets",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      const r = mcps();
      await button(r, "编辑 local").click();
      await r.getByLabel("工具超时（秒）", { exact: true }).fill("117");
      await control("external");
      await post(r, "保存 MCP", 409);
      const panel = feedback(r);
      assert.equal(
        await panel.evaluate((el) => document.activeElement === el),
        true,
      );
      assert.ok(
        (await button(panel, "读取当前生效配置").boundingBox()).height >= 44,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({ path: resolve(output, "mobile-recovery.png") });
      await read(r);
      await page.evaluate(
        () => (document.documentElement.dataset.theme = "dark"),
      );
      await page.setViewportSize({ width: 844, height: 390 });
      await panel
        .getByText("当前生效配置", { exact: true })
        .scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({ path: resolve(output, "landscape-review.png") });
      await adopt(r);
    },
  );
  await check(
    "loading shows progress instead of configuration errors and stale reads cannot overwrite a fresher result",
    async () => {
      const p = await create();
      await p.goto(origin);
      await p.getByLabel("登录密码").fill("recovery-ui-test-password");
      await p.getByRole("button", { name: "继续", exact: true }).click();
      await p.getByPlaceholder("询问任何问题").waitFor();
      await control("external");
      let release, entered;
      const gate = new Promise((r) => (release = r)),
        waiting = new Promise((r) => (entered = r));
      let held = false,
        allowFresh = false;
      await p.route("**/api/config", async (route) => {
        if (route.request().method() === "GET" && !allowFresh) {
          const response = await route.fetch();
          if (!held) {
            held = true;
            entered();
          }
          await gate;
          await route.fulfill({ response });
        } else await route.continue();
      });
      await p.reload();
      await waiting;
      await open(p);
      const r = defaults(p);
      await r.getByText("正在读取配置…", { exact: true }).waitFor();
      assert.equal(await r.getByRole("alert").count(), 0);
      await control("external-high");
      allowFresh = true;
      await r
        .getByRole("button", { name: /^重新读取配置$|^读取最新并重置修改$/ })
        .click();
      await effort(p)
        .locator('option[value="high"]')
        .waitFor({ state: "attached" });
      await p.waitForFunction(
        () =>
          document.querySelector('select[aria-label="默认推理强度"]')?.value ===
          "high",
      );
      const old = p.waitForResponse(
        (res) =>
          res.url().endsWith("/api/config") && res.request().method() === "GET",
      );
      release();
      await old;
      await p.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      assert.equal(await effort(p).inputValue(), "high");
      await p.close();
    },
  );
  await check(
    "recovery requests contain only their action and mode and browser execution stays isolated",
    async () => {
      for (const p of payloads.filter(
        (p) => p.action === "configuration/recover",
      ))
        assert.deepEqual(Object.keys(p).sort(), ["action", "mode"]);
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
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
  console.log(`Configuration recovery UI: ${checks.length} checks passed`);
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
