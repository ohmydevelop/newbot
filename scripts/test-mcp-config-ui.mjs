import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/mcp-config-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const f of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, f), { force: true });
const port = Number(process.env.MCP_CONFIG_TEST_PORT || 3114),
  origin = `http://127.0.0.1:${port}`,
  server = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "tests/mcp-config-preview-server.ts"],
    {
      env: {
        ...process.env,
        NODE_ENV: "test",
        MCP_CONFIG_TEST_PORT: String(port),
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
      if (log.includes("MCP config UI fixture ready")) {
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
      .getByRole("button", { name: "MCP 连接", exact: true })
      .click();
    await p.getByRole("region", { name: "MCP 管理" }).waitFor();
  };
  const login = async (p) => {
    await p.goto(origin);
    await p.getByLabel("登录密码").fill("mcp-config-ui-password");
    await p.getByRole("button", { name: "继续", exact: true }).click();
    await open(p);
  };
  const region = (p = page) => p.getByRole("region", { name: "MCP 管理" }),
    button = (name, p = page) =>
      region(p).getByRole("button", { name, exact: true });
  const click = async (name, p = page, status = 200) => {
    const e = p.waitForResponse(
      (r) =>
        r.url().startsWith(origin + "/api/") &&
        r.request().method() === "POST" &&
        !r.url().includes("/api/test/"),
    );
    await button(name, p).click();
    const r = await e;
    assert.equal(r.status(), status, await r.text());
    await region(p)
      .getByText("正在处理 MCP 配置…", { exact: true })
      .waitFor({ state: "hidden" });
    return r;
  };
  const reload = async (p = page) => {
    await region(p)
      .getByRole("button", {
        name: /^读取最新并放弃 MCP 修改$|^重新读取 MCP 配置$/,
      })
      .click();
    await region(p)
      .getByText("已读取最新 MCP 配置。", { exact: true })
      .waitFor();
  };
  const control = async (action) =>
      assert.equal(
        (
          await page.request.post(origin + "/api/test/mcp-config", {
            data: { action },
            headers: { origin },
          })
        ).status(),
        200,
      ),
    state = async () =>
      (await page.request.get(origin + "/api/test/mcp-state")).json();
  await login(page);
  await login(other);
  await check(
    "inventory shows safe transport, state and tool counts without private configuration",
    async () => {
      await button("编辑 local").waitFor();
      await button("启用 remote").waitFor();
      assert.ok(!(await page.content()).includes("SYNTHETIC_CONFIG_SECRET"));
      await region()
        .getByText("端点：https://mcp.example.com", { exact: true })
        .waitFor();
    },
  );
  await check(
    "MCP editing preserves hidden command arguments and environment values",
    async () => {
      await button("编辑 local").click();
      assert.equal(
        await region().getByLabel("启动命令", { exact: true }).inputValue(),
        "",
      );
      assert.equal(
        await region()
          .getByLabel("命令参数 JSON", { exact: true })
          .inputValue(),
        "",
      );
      await region().getByLabel("工具超时（秒）", { exact: true }).fill("90");
      await click("保存 MCP");
      assert.equal((await state()).localTimeout, 90);
      assert.equal((await state()).preserved, true);
      assert.equal((await state()).localArgsCount, 2);
    },
  );
  await check(
    "a second browser retains a rejected stale draft and must explicitly reload",
    async () => {
      await button("编辑 local", other).click();
      await region(other)
        .getByLabel("工具超时（秒）", { exact: true })
        .fill("75");
      await click("保存 MCP", other, 409);
      assert.equal(
        await region(other)
          .getByLabel("工具超时（秒）", { exact: true })
          .inputValue(),
        "75",
      );
      assert.equal((await state()).localTimeout, 90);
      await reload(other);
    },
  );
  await check(
    "HTTP MCP creation validates IDs and stores a non-sensitive endpoint",
    async () => {
      await button("新增 MCP").click();
      const id = region().getByLabel("MCP 标识", { exact: true });
      await id.fill("Invalid.ID");
      assert.equal(await id.evaluate((el) => el.checkValidity()), false);
      await id.fill("httpdemo");
      await region()
        .getByLabel("传输方式", { exact: true })
        .selectOption("http");
      await region()
        .getByLabel("MCP HTTP URL", { exact: true })
        .fill("http://127.0.0.1:9/mcp");
      await region().getByLabel("启用此连接", { exact: true }).uncheck();
      await click("保存 MCP");
      assert.ok((await state()).ids.includes("httpdemo"));
    },
  );
  await check(
    "unsafe HTTP endpoints and credential references remain rejected with a recoverable draft",
    async () => {
      await button("编辑 httpdemo").click();
      await region()
        .getByLabel("MCP HTTP URL", { exact: true })
        .fill("https://user:password@example.com/mcp");
      await click("保存 MCP", page, 400);
      await region().getByLabel("MCP HTTP URL", { exact: true }).fill("");
      await region()
        .getByLabel("Bearer 环境变量引用", { exact: true })
        .fill("ADMIN_PASSWORD");
      await click("保存 MCP", page, 409);
      await button("取消 MCP 编辑").click();
    },
  );
  await check(
    "stdio MCP creation accepts explicit JSON arguments and rejects malformed arrays locally",
    async () => {
      await button("新增 MCP").click();
      await region().getByLabel("MCP 标识", { exact: true }).fill("stdiodemo");
      await region().getByLabel("启动命令", { exact: true }).fill("node");
      await region()
        .getByLabel("命令参数 JSON", { exact: true })
        .fill("not json");
      await button("保存 MCP").click();
      await region()
        .getByRole("alert")
        .filter({ hasText: "JSON 字符串数组" })
        .waitFor();
      await region()
        .getByLabel("命令参数 JSON", { exact: true })
        .fill('["server.js"]');
      await click("保存 MCP");
      assert.ok((await state()).ids.includes("stdiodemo"));
    },
  );
  await check(
    "disabled connection tests report disabled without reloading, then enable uses native config",
    async () => {
      await click("停用 local");
      const before = (await state()).reloads;
      await click("测试 local");
      await region()
        .getByRole("status")
        .filter({ hasText: "此 MCP 已停用" })
        .waitFor();
      assert.equal((await state()).reloads, before);
      await click("启用 local");
      assert.equal((await state()).localEnabled, true);
    },
  );
  await check(
    "native discovery reports tool availability without executing tools",
    async () => {
      await click("测试 local");
      await region()
        .getByRole("status")
        .filter({ hasText: "原生 MCP 目录读取成功" })
        .waitFor();
      assert.equal((await state()).toolCalls, 0);
    },
  );
  await check(
    "connection failures are redacted and can recover through another test",
    async () => {
      await control("failed");
      await click("测试 local");
      await region()
        .getByRole("status")
        .filter({ hasText: "连接或目录读取失败" })
        .waitFor();
      assert.ok(!(await page.content()).includes("SYNTHETIC_CONFIG_SECRET"));
      await control("ok");
      await click("测试 local");
      await region()
        .getByRole("status")
        .filter({ hasText: "原生 MCP 目录读取成功" })
        .waitFor();
    },
  );
  await check(
    "OAuth uses an explicit safe link and pending authorization prevents changes",
    async () => {
      await control("auth");
      await click("测试 local");
      await click("授权 local");
      const link = region().getByRole("link", { name: "打开 local 授权页面" });
      await link.waitFor();
      assert.equal(await link.getAttribute("target"), "_blank");
      assert.match(await link.getAttribute("rel"), /noopener/);
      await click("停用 local", page, 400);
      await control("oauth-complete");
      await control("ok");
      await reload();
    },
  );
  await check(
    "active tasks prevent configuration changes and preserve the form",
    async () => {
      await control("busy");
      await button("编辑 local").click();
      await region().getByLabel("工具超时（秒）", { exact: true }).fill("100");
      await click("保存 MCP", page, 400);
      assert.equal(
        await region()
          .getByLabel("工具超时（秒）", { exact: true })
          .inputValue(),
        "100",
      );
      await control("idle");
      await button("取消 MCP 编辑").click();
    },
  );
  await check(
    "write failures preserve edits until explicit reload",
    async () => {
      await button("编辑 local").click();
      await region().getByLabel("工具超时（秒）", { exact: true }).fill("100");
      await control("fail-write");
      await click("保存 MCP", page, 502);
      assert.equal(
        await region()
          .getByLabel("工具超时（秒）", { exact: true })
          .inputValue(),
        "100",
      );
      await control("recover-write");
      await reload();
      assert.equal((await state()).localTimeout, 90);
    },
  );
  await check(
    "lost write replies reload native state without repeating the mutation",
    async () => {
      await button("编辑 local").click();
      await region().getByLabel("工具超时（秒）", { exact: true }).fill("105");
      const before = (await state()).writes;
      await control("lost-response");
      await click("保存 MCP", page, 409);
      assert.equal((await state()).writes, before + 1);
      assert.equal((await state()).localTimeout, 105);
      await reload();
    },
  );
  await check(
    "manual reload rejects external configuration races and succeeds after reading",
    async () => {
      await control("external");
      await click("重载 MCP 连接", page, 409);
      await reload();
      await click("重载 MCP 连接");
      await region()
        .getByRole("status")
        .filter({ hasText: "已提交原生 MCP 重载" })
        .waitFor();
    },
  );
  await check(
    "deleting a connection removes only its config and preserves other private fields",
    async () => {
      await button("删除 httpdemo").click();
      await click("确认删除 httpdemo");
      assert.ok(!(await state()).ids.includes("httpdemo"));
      assert.equal((await state()).preserved, true);
      await button("删除 stdiodemo").click();
      await button("取消 MCP 删除").click();
      assert.ok((await state()).ids.includes("stdiodemo"));
    },
  );
  await check(
    "reload failure reports saved state and recovers using the offline reconnect flow",
    async () => {
      await button("编辑 local").click();
      await region().getByLabel("工具超时（秒）", { exact: true }).fill("110");
      await control("fail-reload");
      await click("保存 MCP", page, 502);
      assert.equal((await state()).localTimeout, 110);
      assert.equal((await state()).runtime, "offline");
      await control("recover-reload");
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await page.getByRole("button", { name: "重新连接", exact: true }).click();
      await page
        .getByRole("button", { name: "重新连接", exact: true })
        .waitFor({ state: "hidden" });
      await open(page);
      await button("编辑 local").click();
      assert.equal(
        await region()
          .getByLabel("工具超时（秒）", { exact: true })
          .inputValue(),
        "110",
      );
      await button("取消 MCP 编辑").click();
    },
  );
  await check(
    "mobile and landscape editors retain labels, focus and reachable actions",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await button("编辑 local").click();
      const field = region().getByLabel("启动命令", { exact: true });
      await field.focus();
      assert.equal(
        await field.evaluate((el) => document.activeElement === el),
        true,
      );
      assert.ok((await field.boundingBox()).height >= 44);
      await button("保存 MCP").scrollIntoViewIfNeeded();
      assert.ok((await button("保存 MCP").boundingBox()).height >= 44);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({ path: resolve(output, "mobile-editor.png") });
      await page.evaluate(
        () => (document.documentElement.dataset.theme = "dark"),
      );
      await page.setViewportSize({ width: 844, height: 390 });
      await region()
        .getByLabel("命令参数 JSON", { exact: true })
        .scrollIntoViewIfNeeded();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({ path: resolve(output, "landscape-editor.png") });
    },
  );
  await check(
    "browser errors, external requests and private API data remain absent",
    async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      assert.ok(
        responses.every(
          (r) =>
            !r.includes("SYNTHETIC_CONFIG_SECRET") && !r.includes("/private/"),
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
  console.log(`MCP config UI: ${checks.length} checks passed`);
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
