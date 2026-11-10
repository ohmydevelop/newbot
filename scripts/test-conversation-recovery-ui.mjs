import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE || "playwright"
  ),
  output = resolve(".data/conversation-recovery-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const f of ["result.json", "failure.json"])
  rmSync(resolve(output, f), { force: true });
const port = Number(process.env.RECOVERY_FLOW_TEST_PORT || 3136),
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["--import", "tsx", "tests/conversation-recovery-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "test",
      AGENT_TRANSPORT: "poll",
      RECOVERY_FLOW_TEST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "",
  browser,
  page;
const exited = new Promise((r) => server.once("exit", r)),
  ready = new Promise((res, rej) => {
    const timer = setTimeout(() => rej(Error("Fixture timeout")), 15000),
      collect = (d) => {
        log += d;
        if (log.includes("Conversation recovery UI fixture ready")) {
          clearTimeout(timer);
          res();
        }
      };
    server.stdout.on("data", collect);
    server.stderr.on("data", collect);
    server.once("exit", () => {
      clearTimeout(timer);
      rej(Error("Fixture exited: " + log));
    });
  });
const checks = [],
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
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  const control = async (action) =>
    (
      await context.request.post(origin + "/api/test/recovery", {
        headers: { origin },
        data: { action },
      })
    ).json();
  const choose = async (name) => {
    await page
      .locator(".history-link")
      .getByText(name, { exact: true })
      .click();
    await page.locator(".turn").first().waitFor();
  };
  const draft = () => page.getByPlaceholder("询问任何问题"),
    file = (name) =>
      page.getByRole("button", { name: `移除 ${name}`, exact: true });
  const send = async (text) => {
    await draft().fill(text);
    await draft().press("Enter");
  };
  const newChat = async () => {
    await page.getByRole("button", { name: /^新聊天/ }).click();
  };
  const upload = async (files) =>
    page.locator('input[type="file"]').setInputFiles(
      files.map(([name, data]) => ({
        name,
        mimeType: "text/plain",
        buffer: Buffer.from(data),
      })),
    );
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("recovery-ui-fixture-login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page
    .locator(".history-link")
    .getByText("Alpha History", { exact: true })
    .waitFor();
  await check(
    "title search handles normalized whitespace and keeps failed list reads recoverable",
    async () => {
      await page.route("**/api/threads", (route) => route.abort("failed"));
      await page.getByRole("button", { name: /搜索聊天/ }).click();
      const modal = page.getByRole("dialog", { name: "搜索聊天", exact: true });
      await modal
        .getByText("对话列表未能读取，请重试。", { exact: false })
        .waitFor();
      await page.unroute("**/api/threads");
      await modal.getByRole("button", { name: "重试", exact: true }).click();
      await modal
        .getByText("对话列表未能读取，请重试。", { exact: false })
        .waitFor({ state: "hidden" });
      await modal.getByLabel("搜索对话").fill("  ＡＬＰＨＡ  ");
      await modal.getByRole("button", { name: /Alpha History/ }).waitFor();
      await modal.getByRole("button", { name: /Alpha History/ }).click();
      await page
        .getByRole("button", { name: "加载更早的消息", exact: true })
        .waitFor();
    },
  );
  await check(
    "page failure preserves current content and retry deduplicates without jumping the reader",
    async () => {
      await control("fail-page");
      await page
        .getByRole("button", { name: "加载更早的消息", exact: true })
        .click();
      await page
        .getByText("更早的消息未能加载，请重试。", { exact: true })
        .waitFor();
      assert.equal(await page.locator(".turn").count(), 30);
      const button = page.getByRole("button", {
        name: "加载更早的消息",
        exact: true,
      });
      await button.scrollIntoViewIfNeeded();
      const anchor = page.locator('.turn[data-turn-id="alpha-35"]'),
        top = (await anchor.boundingBox()).y;
      await button.click();
      await page.waitForFunction(
        () => document.querySelectorAll(".turn").length > 30,
      );
      assert.equal(await page.locator(".turn").count(), 60);
      assert.ok(Math.abs((await anchor.boundingBox()).y - top) < 40);
      await control("tick");
      await page
        .getByText("Updated latest history answer", { exact: true })
        .waitFor();
      assert.equal(await page.locator(".turn").count(), 60);
    },
  );
  await check(
    "late history page cannot replace another selected conversation",
    async () => {
      await control("hold-page");
      await page
        .getByRole("button", { name: "加载更早的消息", exact: true })
        .click();
      await page
        .getByRole("button", { name: "正在加载更早的消息…", exact: true })
        .waitFor();
      await choose("Beta Chat");
      await control("release-page");
      await page.waitForTimeout(200);
      assert.equal(await page.locator(".turn").count(), 1);
      assert.equal(
        await page.getByText("Alpha History answer 0", { exact: true }).count(),
        0,
      );
    },
  );
  await check(
    "rename failure retains its draft and a confirmed retry refreshes title",
    async () => {
      await page
        .getByRole("button", { name: "更多操作：Alpha History", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "重命名", exact: true }).click();
      const modal = page.getByRole("dialog", {
        name: "重命名对话",
        exact: true,
      });
      await modal.getByLabel("对话名称").fill("Renamed Alpha");
      await control("fail-rename");
      await modal.getByRole("button", { name: "保存", exact: true }).click();
      await modal
        .getByText("名称未能确认，草稿已保留。请刷新列表核对后重试。", {
          exact: true,
        })
        .waitFor();
      assert.equal(
        await modal.getByLabel("对话名称").inputValue(),
        "Renamed Alpha",
      );
      await modal.getByRole("button", { name: "保存", exact: true }).click();
      await modal.waitFor({ state: "hidden" });
      await page
        .locator(".history-link")
        .getByText("Renamed Alpha", { exact: true })
        .waitFor();
    },
  );
  await check(
    "archive failure keeps its row and late archive acknowledgement never clears another draft",
    async () => {
      await control("fail-archive");
      await page
        .getByRole("button", { name: "更多操作：Archive Chat", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "归档", exact: true }).click();
      await page.locator(".error-banner").waitFor();
      await page
        .getByRole("button", { name: "关闭错误提示", exact: true })
        .click();
      await control("hold-archive");
      await page
        .getByRole("button", { name: "更多操作：Archive Chat", exact: true })
        .click();
      await page.getByRole("menuitem", { name: "归档", exact: true }).click();
      await choose("Beta Chat");
      await draft().fill("keep beta draft");
      await control("release-archive");
      await page
        .locator(".history-link")
        .getByText("Archive Chat", { exact: true })
        .waitFor({ state: "hidden" });
      assert.equal(await draft().inputValue(), "keep beta draft");
    },
  );
  await check(
    "partial batch upload retains success, reports failures and stays with its draft",
    async () => {
      await upload([
        ["ok.txt", "hello"],
        ["bad.bin", "bad"],
      ]);
      await file("ok.txt").waitFor();
      await page.getByText(/1 个未完成/).waitFor();
      await choose("Renamed Alpha");
      assert.equal(await file("ok.txt").count(), 0);
      await draft().fill("alpha draft");
      await choose("Beta Chat");
      assert.equal(await draft().inputValue(), "keep beta draft");
      await file("ok.txt").waitFor();
    },
  );
  await check(
    "cancel upload keeps prior successes and cannot send a half-uploaded batch",
    async () => {
      await control("hold-upload");
      await upload([
        ["first.txt", "first"],
        ["slow.txt", "later"],
      ]);
      await file("first.txt").waitFor();
      await page
        .getByRole("button", { name: "取消上传", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "发送消息", exact: true })
          .isDisabled(),
        true,
      );
      await page.getByRole("button", { name: "取消上传", exact: true }).click();
      await page.getByText(/已取消剩余上传/).waitFor();
      await control("release-upload");
      await file("first.txt").waitFor();
      assert.equal(
        await file("slow.txt").count(),
        1,
        "canceled files remain retryable under the new attachment contract",
      );
      await file("slow.txt").click();
      assert.equal(await file("slow.txt").count(), 0);
    },
  );
  await check(
    "upload limit is enforced before another batch is sent",
    async () => {
      const before = await control("inspect");
      await upload(
        Array.from({ length: 9 }, (_, i) => [`file${i}.txt`, "test"]),
      );
      await page
        .getByText("每条消息最多 8 个附件，请减少选择后重试。", { exact: true })
        .waitFor();
      assert.equal((await control("inspect")).uploads, before.uploads);
    },
  );
  await check(
    "late accepted response preserves newer typing while transferring the new-conversation draft",
    async () => {
      await newChat();
      let release, ready, finished;
      const reached = new Promise((r) => (ready = r));
      const fulfilled = new Promise((r) => (finished = r));
      await page.route("**/api/agent/run", async (route) => {
        const response = await route.fetch();
        await new Promise((r) => {
          release = () => r();
          ready();
        });
        await route.fulfill({ response });
        finished();
      });
      await send("sent snapshot");
      await reached;
      await draft().fill("next unsent text");
      release();
      await fulfilled;
      await page.unroute("**/api/agent/run");
      await page
        .getByText("Received: sent snapshot", { exact: true })
        .waitFor();
      await page.waitForTimeout(200);
      assert.equal(await draft().inputValue(), "next unsent text");
    },
  );
  await check(
    "checking a hung accepted send releases the composer and its late response cannot clear a newer pending request",
    async () => {
      await newChat();
      const before = await control("inspect");
      let release,
        ready,
        finished,
        calls = 0;
      const reached = new Promise((r) => (ready = r)),
        fulfilled = new Promise((r) => (finished = r));
      await page.route("**/api/agent/run", async (route) => {
        calls++;
        if (calls !== 1) return route.abort("failed");
        const response = await route.fetch();
        await new Promise((r) => {
          release = r;
          ready();
        });
        await route.fulfill({ response });
        finished();
      });
      await send("accepted response hanging");
      await reached;
      await draft().fill("newer outstanding message");
      await page
        .getByRole("button", { name: "检查发送状态", exact: true })
        .click();
      await page.getByText("上次消息已确认提交。", { exact: true }).waitFor();
      await page
        .getByText("Received: accepted response hanging", { exact: true })
        .waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="发送消息"]')?.disabled === false,
      );
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await page
        .getByText("发送结果未确认，请检查发送状态。", { exact: true })
        .waitFor();
      const second = await page.evaluate(() =>
        sessionStorage.getItem("ma_pending_run_id"),
      );
      assert.ok(second);
      release();
      await fulfilled;
      await page.unroute("**/api/agent/run");
      await page.waitForTimeout(200);
      assert.equal(
        await page.evaluate(() => sessionStorage.getItem("ma_pending_run_id")),
        second,
      );
      assert.equal(await draft().inputValue(), "newer outstanding message");
      await page
        .getByRole("button", { name: "检查发送状态", exact: true })
        .click();
      await page
        .getByRole("button", { name: "放弃尚未登记的发送", exact: true })
        .click();
      await page
        .getByText("尚未登记的发送已放弃，草稿保留；迟到请求不会执行。", {
          exact: true,
        })
        .waitFor();
      assert.equal((await control("inspect")).turns, before.turns + 1);
    },
  );
  await check(
    "unknown accepted response can be checked without losing edits or dispatching twice",
    async () => {
      await newChat();
      const before = await control("inspect");
      await page.route("**/api/agent/run", async (route) => {
        await route.fetch();
        await route.abort("failed");
      });
      await send("accepted but lost");
      await page
        .getByRole("button", { name: "检查发送状态", exact: true })
        .waitFor();
      await page.waitForTimeout(200);
      await draft().fill("new draft after network error");
      await page.unroute("**/api/agent/run");
      await page
        .getByRole("button", { name: "检查发送状态", exact: true })
        .click();
      await page.getByText("上次消息已确认提交。", { exact: true }).waitFor();
      assert.equal(await draft().inputValue(), "new draft after network error");
      assert.equal((await control("inspect")).turns, before.turns + 1);
    },
  );
  await check(
    "404 leaves the request stable until explicit abandonment fences late submission",
    async () => {
      await newChat();
      let payload;
      await page.route("**/api/agent/run", async (route) => {
        payload = route.request().postDataJSON();
        await route.abort("failed");
      });
      await send("not registered");
      await page
        .getByRole("button", { name: "检查发送状态", exact: true })
        .waitFor();
      await page.waitForTimeout(100);
      await draft().fill("preserve new content");
      await page
        .getByRole("button", { name: "检查发送状态", exact: true })
        .click();
      await page
        .getByRole("button", { name: "放弃尚未登记的发送", exact: true })
        .waitFor();
      const before = await control("inspect");
      await page
        .getByRole("button", { name: "放弃尚未登记的发送", exact: true })
        .click();
      await page
        .getByText("尚未登记的发送已放弃，草稿保留；迟到请求不会执行。", {
          exact: true,
        })
        .waitFor();
      assert.equal(await draft().inputValue(), "preserve new content");
      await page.unroute("**/api/agent/run");
      const late = await context.request.post(origin + "/api/agent/run", {
        headers: { origin },
        data: payload,
      });
      assert.equal(late.status(), 409);
      assert.equal((await control("inspect")).turns, before.turns);
    },
  );
  await check(
    "stop acknowledgement remains pending until authority changes and never silently resends",
    async () => {
      await newChat();
      await send("hold task");
      await page
        .getByRole("button", { name: "停止回答", exact: true })
        .waitFor();
      await control("ignore-stop");
      const before = await control("inspect");
      await page.getByRole("button", { name: "停止回答", exact: true }).click();
      await page
        .getByText("已请求停止，等待任务状态更新。", { exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "停止回答", exact: true })
          .isDisabled(),
        true,
      );
      await page
        .getByRole("button", { name: "读取停止状态", exact: true })
        .click();
      await page
        .getByText("任务仍在执行，如有需要可再次请求停止。", { exact: true })
        .waitFor();
      assert.equal(
        (await control("inspect")).interrupts,
        before.interrupts + 1,
      );
      await control("allow-stop");
      await page.getByRole("button", { name: "停止回答", exact: true }).click();
      await page.getByText("你已停止本次回答", { exact: true }).waitFor();
      assert.equal(
        (await control("inspect")).interrupts,
        before.interrupts + 2,
      );
    },
  );
  await check(
    "lost stop request stays unconfirmed and needs a read before another explicit attempt",
    async () => {
      await newChat();
      await send("hold unknown stop");
      await page
        .getByRole("button", { name: "停止回答", exact: true })
        .waitFor();
      const before = await control("inspect");
      await page.route("**/api/agent/action", async (route) => {
        if (route.request().postDataJSON().action === "turn/interrupt")
          await route.abort("failed");
        else await route.continue();
      });
      await page.getByRole("button", { name: "停止回答", exact: true }).click();
      await page
        .getByText("停止请求未确认，请读取状态；不会自动重发。", {
          exact: true,
        })
        .waitFor();
      assert.equal((await control("inspect")).interrupts, before.interrupts);
      await page.unroute("**/api/agent/action");
      await page
        .getByRole("button", { name: "读取停止状态", exact: true })
        .click();
      await page
        .getByText("任务仍在执行，如有需要可再次请求停止。", { exact: true })
        .waitFor();
      await page.getByRole("button", { name: "停止回答", exact: true }).click();
      await page.getByText("你已停止本次回答", { exact: true }).waitFor();
      assert.equal(
        (await control("inspect")).interrupts,
        before.interrupts + 1,
      );
    },
  );
  await check(
    "mobile dark recovery controls fit the viewport and preserve keyboard input",
    async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.locator(".sidebar").waitFor({ state: "hidden" });
      await draft().fill("mobile draft");
      assert.equal(await draft().inputValue(), "mobile draft");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      await page.screenshot({ path: resolve(output, "mobile.png") });
      assert.deepEqual(errors, []);
    },
  );
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      { checks, passed: checks.length, counts: await control("inspect") },
      null,
      2,
    ),
    { mode: 0o600 },
  );
} catch (error) {
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify({ checks, error: String(error) }, null, 2),
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
}
