import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/a2ui-recovery-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const file of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, file), { force: true });
const port = Number(process.env.A2UI_CHAT_TEST_PORT || 3124),
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/a2ui-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      A2UI_CHAT_TEST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
const exited = new Promise((resolve) => server.once("exit", resolve));
const ready = new Promise((resolve, reject) => {
  const timeout = setTimeout(
    () => reject(new Error("Fixture did not start")),
    15_000,
  );
  const collect = (data) => {
    log += data.toString();
    if (log.includes("A2UI chat fixture ready")) {
      clearTimeout(timeout);
      resolve();
    }
  };
  server.stdout.on("data", collect);
  server.stderr.on("data", collect);
  server.once("exit", (code) => {
    clearTimeout(timeout);
    reject(new Error(`Fixture exited ${code}: ${log}`));
  });
});
const checks = [],
  errors = [],
  writes = [],
  external = [];
let browser, page;
let releaseRequest = () => {};
async function check(name, action) {
  await action();
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
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1100 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  await page.clock.install({ time: Date.now() });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().endsWith("/api/a2ui/action"))
      writes.push(JSON.parse(request.postData()));
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith(origin + "/")
    )
      external.push(request.url());
  });
  const panel = () =>
    page.getByRole("region", { name: "助手生成的表单", exact: true }).last();
  const name = () => panel().getByLabel("任务名称", { exact: true });
  const submit = () =>
    panel().getByRole("button", { name: "创建任务", exact: true });
  const screenshot = async (name) => {
    if (/restart|fallback|expired/.test(name))
      await page
        .locator(".chat-a2ui")
        .last()
        .locator(".a2ui-footer")
        .scrollIntoViewIfNeeded();
    return page.screenshot({
      path: resolve(output, `${name}.png`),
      animations: "disabled",
    });
  };
  const start = async (text) => {
    await page.getByPlaceholder("询问任何问题").fill(text);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await name().waitFor();
    await page.getByText("等待填写", { exact: true }).last().waitFor();
  };
  const inspect = async (action = "inspect") =>
    (
      await context.request.post(origin + "/api/test/a2ui", {
        headers: { origin },
        data: { action },
      })
    ).json();
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("a2ui-chat-test-password");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await check(
    "chat creates a form linked to its native item and applies a later native update",
    async () => {
      await start("A2UI 任务参数");
      assert.equal(
        await panel()
          .getByText("请选择任务参数，然后提交。", { exact: true })
          .count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("region", { name: "助手生成的表单", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "停止回答", exact: true })
          .count(),
        1,
      );
      await screenshot("waiting-desktop");
    },
  );
  await check(
    "browser submits editable field values and no trusted action context",
    async () => {
      await name().fill("浏览器任务");
      await panel()
        .getByLabel("服务器", { exact: true })
        .selectOption("host-b");
      await panel().getByLabel("内存", { exact: true }).check();
      await page.route(
        "**/api/a2ui/action",
        (route) =>
          new Promise((resolve) => {
            releaseRequest = () => {
              void route
                .continue()
                .catch(() => {})
                .finally(resolve);
            };
          }),
      );
      await submit().click();
      await page.waitForFunction(
        () =>
          document.querySelector(".a2ui-panel")?.getAttribute("aria-busy") ===
          "true",
      );
      assert.equal(
        await page
          .getByRole("button", { name: "取消填写", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "重载表单", exact: true })
          .isDisabled(),
        true,
      );
      releaseRequest();
      await page
        .getByText("已收到任务：浏览器任务，服务器：host-b。", { exact: true })
        .waitFor();
      assert.equal(writes.length, 1);
      assert.equal(writes[0].sourceComponentId, "submit");
      assert.equal(writes[0].values.name, "浏览器任务");
      assert.equal(Object.hasOwn(writes[0], "context"), false);
      assert.equal((await inspect()).pending, 0);
      await page.unroute("**/api/a2ui/action");
    },
  );
  await check(
    "native tool completion keeps the submitted form visible and read-only",
    async () => {
      await page.getByText("已提交", { exact: true }).waitFor();
      assert.equal(await name().inputValue(), "浏览器任务");
      assert.equal(await name().isDisabled(), true);
      assert.equal(await submit().isDisabled(), true);
      assert.equal(
        await page
          .getByRole("button", { name: "取消填写", exact: true })
          .count(),
        0,
      );
      await screenshot("submitted-desktop");
    },
  );
  await check(
    "reload reads the current authoritative submitted state without sending another action",
    async () => {
      await page.getByRole("button", { name: "重载表单", exact: true }).click();
      assert.equal(await name().inputValue(), "浏览器任务");
      assert.equal(writes.length, 1);
      await page.reload();
      await name().waitFor();
      assert.equal(await name().inputValue(), "浏览器任务");
      assert.equal(await submit().isDisabled(), true);
    },
  );
  await check(
    "pending browser refresh rejoins the same backend request",
    async () => {
      await start("再次显示表单");
      const before = await inspect();
      assert.equal(before.pending, 1);
      await page.reload();
      await name().waitFor();
      await page.getByText("等待填写", { exact: true }).last().waitFor();
      assert.equal((await inspect()).pending, 1);
      assert.equal(writes.length, 1);
      assert.equal(await submit().isDisabled(), false);
    },
  );
  await check(
    "autosave preserves keyboard focus and refresh restores server draft without a model action",
    async () => {
      await name().fill("草稿任务 A");
      await page.getByText("草稿已保存", { exact: true }).last().waitFor();
      assert.equal(
        await name().evaluate((el) => el === document.activeElement),
        true,
      );
      const before = writes.length;
      await page.reload();
      await name().waitFor();
      assert.equal(await name().inputValue(), "草稿任务 A");
      await page.getByText("已恢复草稿", { exact: true }).last().waitFor();
      assert.equal(writes.length, before);
      const contents = await page.evaluate(() =>
        JSON.stringify({ ...localStorage, ...sessionStorage }),
      );
      assert.ok(!contents.includes("草稿任务 A"));
    },
  );
  await check(
    "another tab cannot silently overwrite a newer draft and keeps its own unsaved input",
    async () => {
      const tab = await context.newPage();
      tab.on("pageerror", (error) => errors.push(error.message));
      try {
        await tab.goto(origin);
        const otherName = tab
          .getByRole("region", { name: "助手生成的表单", exact: true })
          .last()
          .getByLabel("任务名称", { exact: true });
        await otherName.waitFor();
        assert.equal(await otherName.inputValue(), "草稿任务 A");
        await name().fill("草稿任务 B");
        await page.getByText("草稿已保存", { exact: true }).last().waitFor();
        await otherName.fill("另一页尚未保存的修改");
        await tab
          .getByText("草稿已变化，请重载表单后继续；当前输入尚未保存。", {
            exact: true,
          })
          .last()
          .waitFor();
        assert.equal(await otherName.inputValue(), "另一页尚未保存的修改");
        await tab
          .getByRole("button", { name: "重载表单", exact: true })
          .last()
          .click();
        await tab.waitForFunction(() =>
          [...document.querySelectorAll(".a2ui-field input")].some(
            (el) => el.value === "草稿任务 B",
          ),
        );
      } finally {
        await tab.close();
      }
    },
  );
  await check(
    "clear removes the stored draft and leaves current controls intact until refresh",
    async () => {
      await page
        .getByRole("button", { name: "清除草稿", exact: true })
        .last()
        .click();
      await page
        .getByText("已清除已保存的草稿；当前输入保持不变", { exact: true })
        .last()
        .waitFor();
      assert.equal(await name().inputValue(), "草稿任务 B");
      await page.reload();
      await name().waitFor();
      assert.equal(await name().inputValue(), "资源监控");
    },
  );
  await check(
    "failed draft transport keeps input and reports unsaved state until a manual retry",
    async () => {
      await page.route("**/api/a2ui/draft", (route) => route.abort("failed"));
      await name().fill("断线时的草稿");
      await page
        .getByText("草稿未保存，请检查连接后点击保存草稿。", { exact: true })
        .last()
        .waitFor();
      assert.equal(await name().inputValue(), "断线时的草稿");
      await page.unroute("**/api/a2ui/draft");
      await page
        .getByRole("button", { name: "保存草稿", exact: true })
        .last()
        .click();
      await page.getByText("草稿已保存", { exact: true }).last().waitFor();
      await page.reload();
      await name().waitFor();
      assert.equal(await name().inputValue(), "断线时的草稿");
    },
  );
  await check(
    "host cancel resumes the task with a structured cancellation",
    async () => {
      await page.getByRole("button", { name: "取消填写", exact: true }).click();
      await page.getByText("已取消本次填写。", { exact: true }).waitFor();
      assert.equal(writes.at(-1).sourceComponentId, "$cancel");
      assert.deepEqual(writes.at(-1).values, {});
      assert.equal(await name().isDisabled(), true);
      assert.equal((await inspect()).pending, 0);
    },
  );
  await check(
    "model-provided cancel button returns its allowed event through the same path",
    async () => {
      await start("第三次显示表单");
      await panel().getByRole("button", { name: "取消", exact: true }).click();
      await page
        .getByText("已取消本次填写。", { exact: true })
        .last()
        .waitFor();
      assert.equal(writes.at(-1).sourceComponentId, "cancel");
      assert.equal((await inspect()).pending, 0);
    },
  );
  await check(
    "failed transport keeps fields and retries the same idempotency key",
    async () => {
      await start("网络失败后重试");
      await name().fill("重试任务");
      let intercepted = false;
      await page.route("**/api/a2ui/action", (route) => {
        if (!intercepted) {
          intercepted = true;
          return route.abort("failed");
        }
        return route.continue();
      });
      const before = writes.length;
      await submit().click();
      await panel()
        .getByRole("alert")
        .filter({ hasText: "操作未能提交，请重试。" })
        .waitFor();
      assert.equal(await name().inputValue(), "重试任务");
      await submit().click();
      await page
        .getByText("已收到任务：重试任务，服务器：host-a。", { exact: true })
        .waitFor();
      assert.equal(writes[before].requestId, writes[before + 1].requestId);
      await page.unroute("**/api/a2ui/action");
    },
  );
  await check(
    "a stale browser request cannot consume the native request and can reload authority",
    async () => {
      await start("过期版本验证");
      const intercepted = [];
      await page.route("**/api/a2ui/action", (route) => {
        const body = route.request().postDataJSON();
        intercepted.push(body);
        return route.continue({
          postData: JSON.stringify({ ...body, revision: body.revision + 100 }),
        });
      });
      await submit().click();
      await panel().getByRole("alert").waitFor();
      assert.equal((await inspect()).pending, 1);
      await page.unroute("**/api/a2ui/action");
      await page.getByRole("button", { name: "取消填写", exact: true }).click();
      await page
        .getByText("已取消本次填写。", { exact: true })
        .last()
        .waitFor();
    },
  );
  await check(
    "mobile form follows product theme, wraps fields and keeps the input notice",
    async () => {
      await start("手机表单");
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.locator(".sidebar").waitFor({ state: "hidden" });
      await name().scrollIntoViewIfNeeded();
      assert.equal(
        await name().evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return (
            document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            ) === element
          );
        }),
        true,
      );
      await panel()
        .getByText("普通信息会随操作发送给助手，请勿填写密码或密钥。", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.ok((await name().boundingBox()).height >= 44);
      await screenshot("waiting-mobile-dark");
    },
  );
  await check(
    "native interruption disables the old form and sends no automatic user action",
    async () => {
      const before = writes.length;
      await inspect("interrupt");
      await page
        .getByText("表单已结束，请重新生成", { exact: true })
        .last()
        .waitFor();
      assert.equal(await submit().isDisabled(), true);
      assert.equal(writes.length, before);
      assert.equal((await inspect()).pending, 0);
    },
  );
  const restart = async (action = "restart") => {
    await inspect(action);
    await page.waitForTimeout(250);
    for (let i = 0; i < 80; i++) {
      try {
        const r = await context.request.get(origin + "/api/ready");
        if (r.ok() && (await r.json()).ready) break;
      } catch {}
      await page.waitForTimeout(100);
    }
    await page.reload();
  };
  await check(
    "Bridge restart restores pending draft read-only and never recreates an old authorization",
    async () => {
      await start("服务重启恢复");
      await name().fill("重启前保存的草稿");
      await page.getByText("草稿已保存", { exact: true }).last().waitFor();
      const before = writes.length;
      await restart();
      await name().waitFor();
      await page
        .getByText("服务已重启，旧表单仅供查看，请重新生成", { exact: true })
        .last()
        .waitFor();
      assert.equal(await name().inputValue(), "重启前保存的草稿");
      assert.equal(await name().isDisabled(), true);
      assert.equal(await submit().isDisabled(), true);
      assert.equal((await inspect()).pending, 0);
      assert.equal(writes.length, before);
      await screenshot("restart-readonly-mobile");
    },
  );
  await check(
    "submitted form survives a full Bridge restart with user values and no duplicate action",
    async () => {
      await start("已提交表单恢复");
      await name().fill("重启保留结果");
      await submit().click();
      await page
        .getByText("已收到任务：重启保留结果，服务器：host-a。", {
          exact: true,
        })
        .waitFor();
      const before = writes.length;
      await restart();
      await name().waitFor();
      assert.equal(await name().inputValue(), "重启保留结果");
      assert.equal(await name().isDisabled(), true);
      assert.equal(writes.length, before);
    },
  );
  await check(
    "corrupted historical descriptions use a fixed fallback without blocking the conversation",
    async () => {
      await start("损坏数据降级");
      await restart("restart-invalid");
      await page
        .getByText("表单描述无法安全显示，请让助手重新生成", { exact: true })
        .last()
        .waitFor();
      assert.equal(await page.locator(".chat-a2ui").last().locator("input,select,textarea").count(), 0);
      assert.equal(await page.locator(".chat-a2ui").last().locator("script,iframe").count(), 0);
      await screenshot("invalid-fallback-mobile");
    },
  );
  await check(
    "expired browser view disables input and explains that saved draft is read-only",
    async () => {
      await start("到期反馈");
      await name().fill("到期前草稿");
      await page.getByText("草稿已保存", { exact: true }).last().waitFor();
      await page.clock.fastForward(600_001);
      await page
        .getByText("表单已过期，请重新生成；已保存的草稿仅供查看", {
          exact: true,
        })
        .last()
        .waitFor();
      assert.equal(await name().isDisabled(), true);
      assert.equal(await submit().isDisabled(), true);
      await screenshot("expired-mobile");
      await inspect("interrupt");
    },
  );
  await check(
    "normal Markdown remains available and browser errors/external requests stay absent",
    async () => {
      assert.ok(
        await page
          .getByText("已收到任务：浏览器任务，服务器：host-b。", {
            exact: true,
          })
          .count(),
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
      assert.equal(
        await panel().locator("iframe,img,input[type=password]").count(),
        0,
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
        actionRequests: writes.length,
      },
      null,
      2,
    ),
  );
  console.log(`${checks.length} A2UI chat browser checks passed`);
} catch (error) {
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify(
      {
        checks,
        error: String(error),
        pageErrors: errors,
        log: log.slice(-2000),
      },
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
  releaseRequest();
  await browser?.close();
  server.kill("SIGTERM");
  await exited;
}
