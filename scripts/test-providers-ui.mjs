import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/providers-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const file of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, file), { force: true });
const port = Number(process.env.PROVIDERS_TEST_PORT || 3113),
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "tests/providers-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      PROVIDERS_TEST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const exited = new Promise((r) => server.once("exit", r));
let log = "";
const ready = new Promise((r, j) => {
  const timer = setTimeout(() => j(new Error("fixture timeout")), 15000);
  const collect = (data) => {
    log += data;
    if (log.includes("Providers UI fixture ready")) {
      clearTimeout(timer);
      r();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", (code) => {
    clearTimeout(timer);
    j(new Error(`fixture ${code}: ${log}`));
  });
});
let browser, page, other;
const checks = [],
  errors = [],
  external = [],
  responses = [];
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log(`PASS ${name}`);
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
    context.setDefaultTimeout(12000);
    const p = await context.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (/^https?:/.test(r.url()) && !r.url().startsWith(origin + "/"))
        external.push(r.url());
    });
    p.on("response", async (r) => {
      if (
        r.url().startsWith(origin + "/api/") &&
        !r.url().includes("/api/test/") &&
        r.headers()["content-type"]?.includes("json")
      )
        responses.push(await r.text().catch(() => ""));
    });
    return p;
  };
  page = await create();
  other = await create();
  const open = async (p) => {
    await p.getByPlaceholder("询问任何问题").waitFor();
    if (await p.getByRole("button", { name: "展开侧栏", exact: true }).count())
      await p.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await p.getByRole("button", { name: "个人工作台 私有实例" }).click();
    await p
      .getByRole("dialog")
      .getByRole("button", { name: "模型与 Provider", exact: true })
      .click();
    await p.getByRole("region", { name: "Provider 管理" }).waitFor();
  };
  const login = async (p) => {
    await p.goto(origin);
    await p.getByLabel("登录密码").fill("providers-ui-test-password");
    await p.getByRole("button", { name: "继续", exact: true }).click();
    await open(p);
  };
  const region = (p = page) => p.getByRole("region", { name: "Provider 管理" });
  const button = (name, p = page) =>
    region(p).getByRole("button", { name, exact: true });
  const click = async (name, p = page, status = 200) => {
    const event = p.waitForResponse(
      (r) =>
        r.url().startsWith(origin + "/api/") &&
        r.request().method() === "POST" &&
        !r.url().includes("/api/test/"),
    );
    await button(name, p).click();
    const res = await event;
    assert.equal(res.status(), status, await res.text());
    await button("新增 Provider", p).waitFor({ state: "visible" });
    await region(p)
      .getByText("正在处理 Provider 配置…", { exact: true })
      .waitFor({ state: "hidden" });
    return res;
  };
  const reload = async (p = page) => {
    const b = region(p).getByRole("button", {
      name: /^读取最新并放弃 Provider 修改$|^重新读取 Provider 配置$/,
    });
    await b.click();
    await region(p).getByText("已读取最新配置。", { exact: true }).waitFor();
  };
  const control = async (action) => {
    assert.equal(
      (
        await page.request.post(origin + "/api/test/provider", {
          data: { action },
          headers: { origin },
        })
      ).status(),
      200,
    );
  };
  const state = async () =>
    (await page.request.get(origin + "/api/test/provider-state")).json();
  await login(page);
  await login(other);
  await check(
    "provider inventory distinguishes current, protected and editable entries",
    async () => {
      assert.equal(await button("删除 fixture").isEnabled(), false);
      assert.equal(await button("编辑 openai").count(), 0);
      await button("编辑 secondary").waitFor();
    },
  );
  await check(
    "editing preserves existing endpoint and private configuration",
    async () => {
      await button("编辑 fixture").click();
      assert.equal(
        await region().getByLabel("API 基础 URL", { exact: true }).inputValue(),
        "",
      );
      await region()
        .getByLabel("显示名称", { exact: true })
        .fill("主 Provider");
      await click("保存 Provider");
      assert.equal((await state()).names.fixture, "主 Provider");
      assert.equal((await state()).preserved, true);
    },
  );
  await check(
    "stale drafts cannot overwrite a newer server configuration",
    async () => {
      await button("编辑 fixture", other).click();
      await region(other)
        .getByLabel("显示名称", { exact: true })
        .fill("Stale draft");
      await click("保存 Provider", other, 409);
      assert.equal(
        await region(other)
          .getByLabel("显示名称", { exact: true })
          .inputValue(),
        "Stale draft",
      );
      assert.equal((await state()).names.fixture, "主 Provider");
      await reload(other);
    },
  );
  await check(
    "provider creation saves a native Responses definition",
    async () => {
      await button("新增 Provider").click();
      const idField = region().getByLabel("Provider 标识", { exact: true });
      await idField.fill("Invalid.ID");
      assert.equal(await idField.evaluate((el) => el.checkValidity()), false);
      await region()
        .getByLabel("Provider 标识", { exact: true })
        .fill("newtest");
      await region()
        .getByLabel("显示名称", { exact: true })
        .fill("新测试 Provider");
      await region()
        .getByLabel("API 基础 URL", { exact: true })
        .fill((await state()).endpoint);
      await click("保存 Provider");
      assert.equal((await state()).names.newtest, "新测试 Provider");
      await button("编辑 newtest").waitFor();
    },
  );
  await check(
    "unsafe endpoint input produces an error and retains the form",
    async () => {
      await button("编辑 newtest").click();
      await region()
        .getByLabel("API 基础 URL", { exact: true })
        .fill("https://user:secret@example.com/v1");
      await click("保存 Provider", page, 400);
      await region().getByRole("alert").waitFor();
      assert.equal(await region().getByRole("form").count(), 1);
      await button("取消编辑").click();
    },
  );
  await check(
    "unapproved credential references never become configuration",
    async () => {
      await button("编辑 newtest").click();
      await region()
        .getByLabel("凭证环境变量引用", { exact: true })
        .fill("ADMIN_PASSWORD");
      await click("保存 Provider", page, 409);
      await region().getByRole("alert").filter({ hasText: "未授权" }).waitFor();
      await button("取消编辑").click();
    },
  );
  await check(
    "failed writes preserve draft values and recover by explicit reload",
    async () => {
      await button("编辑 newtest").click();
      await region()
        .getByLabel("显示名称", { exact: true })
        .fill("Fail preserved");
      await control("fail-write");
      await click("保存 Provider", page, 502);
      assert.equal(
        await region().getByLabel("显示名称", { exact: true }).inputValue(),
        "Fail preserved",
      );
      await control("recover-write");
      await reload();
      assert.equal((await state()).names.newtest, "新测试 Provider");
    },
  );
  await check(
    "lost write responses require readback instead of duplicate saves",
    async () => {
      await button("编辑 newtest").click();
      await region().getByLabel("显示名称", { exact: true }).fill("Saved once");
      await control("lost-response");
      await click("保存 Provider", page, 409);
      assert.equal((await state()).names.newtest, "Saved once");
      await reload();
    },
  );
  await check("busy runtimes prevent provider mutations", async () => {
    await control("busy");
    await button("编辑 newtest").click();
    await region().getByLabel("显示名称", { exact: true }).fill("Must wait");
    await click("保存 Provider", page, 400);
    await control("idle");
    await button("取消编辑").click();
  });
  await check(
    "upstream model discovery remains separate from the chat model picker",
    async () => {
      await button("检查 secondary").click();
      await click("发现模型");
      await region()
        .getByRole("status")
        .filter({ hasText: "兼容性未验证" })
        .waitFor();
      assert.equal(
        await page
          .getByLabel("默认模型", { exact: true })
          .locator('option[value="secondary-model"]')
          .count(),
        0,
      );
    },
  );
  await check(
    "Responses diagnostics report only basic connectivity",
    async () => {
      await region()
        .getByLabel("测试模型 ID", { exact: true })
        .fill("secondary-model");
      await click("测试 Responses 连接");
      await region()
        .getByRole("status")
        .filter({ hasText: "基础 Responses 请求已响应" })
        .waitFor();
      await button("关闭检查").click();
    },
  );
  await check(
    "native catalog discovery and account authorization are explicit",
    async () => {
      await button("检查 fixture").click();
      await click("发现模型");
      await region()
        .getByRole("status")
        .filter({ hasText: "Codex 模型目录" })
        .waitFor();
      await button("关闭检查").click();
      await button("检查 openai").click();
      await click("测试 Responses 连接");
      await region()
        .getByRole("status")
        .filter({ hasText: "Codex 账户授权" })
        .waitFor();
      await button("关闭检查").click();
    },
  );
  await check(
    "archived history protects a provider from deletion",
    async () => {
      await control("history");
      await button("删除 secondary").click();
      await click("确认删除 secondary", page, 409);
      await region()
        .getByRole("alert")
        .filter({ hasText: "历史会话" })
        .waitFor();
      await button("取消删除").click();
      await control("clear-history");
    },
  );
  await check(
    "unreferenced provider deletion removes only its definition",
    async () => {
      await button("删除 newtest").click();
      await click("确认删除 newtest");
      assert.equal((await state()).names.newtest, undefined);
      assert.equal((await state()).preserved, true);
    },
  );
  await check(
    "switching refreshes the model catalog and valid defaults",
    async () => {
      await click("切换到 secondary");
      assert.equal((await state()).provider, "secondary");
      assert.equal((await state()).model, "secondary-model");
      assert.equal((await state()).effort, "low");
      await page
        .getByLabel("默认模型", { exact: true })
        .locator('option[value="secondary-model"]')
        .waitFor({ state: "attached" });
      assert.equal(await button("删除 secondary").isEnabled(), false);
    },
  );
  await check(
    "mobile forms have touch targets, labels and no horizontal overflow",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await button("编辑 secondary").click();
      const field = region().getByLabel("显示名称", { exact: true });
      await field.focus();
      assert.equal(
        await field.evaluate((el) => document.activeElement === el),
        true,
      );
      assert.ok((await field.boundingBox()).height >= 44);
      assert.ok((await button("保存 Provider").boundingBox()).height >= 44);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await field.scrollIntoViewIfNeeded();
      await page.screenshot({ path: resolve(output, "mobile-editor.png") });
      await button("取消编辑").click();
    },
  );
  await check("dark and landscape settings stay scrollable", async () => {
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
    await page.setViewportSize({ width: 844, height: 390 });
    await button("检查 secondary").click();
    await region()
      .getByLabel("测试模型 ID", { exact: true })
      .scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: resolve(output, "landscape-diagnostic.png"),
    });
  });
  await check(
    "browser traffic and API views contain no server configuration secrets",
    async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      assert.ok(
        responses.every(
          (v) =>
            !v.includes("SYNTHETIC_CONFIG_SECRET") &&
            !v.includes("preserved-private-header"),
        ),
      );
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
  console.log(`Provider UI: ${checks.length} checks passed`);
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
