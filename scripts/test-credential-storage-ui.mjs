import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/credential-storage-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const f of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, f), { force: true });
const port = Number(process.env.CREDENTIAL_STORAGE_TEST_PORT || 3128),
  origin = `http://127.0.0.1:${port}`,
  secret = "credential-fixture-private-value-ONLY-TEST";
const child = spawn(
  process.execPath,
  ["--import", "tsx", "tests/credential-storage-preview-server.ts"],
  {
    env: {
      ...process.env,
      NODE_ENV: "development",
      CREDENTIAL_STORAGE_TEST_PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "",
  browser,
  page;
const exited = new Promise((r) => child.once("exit", r));
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Fixture startup timed out")),
    15000,
  );
  const collect = (data) => {
    log += data;
    if (log.includes("Credential storage fixture ready")) {
      clearTimeout(timer);
      resolve();
    }
  };
  child.stdout.on("data", collect);
  child.stderr.on("data", collect);
  child.once("exit", () => {
    clearTimeout(timer);
    reject(new Error("Fixture exited"));
  });
});
const checks = [],
  errors = [],
  external = [],
  responses = [],
  writes = [];
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
    viewport: { width: 1280, height: 1100 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith(origin + "/"))
      external.push(r.url());
    if (r.url().endsWith("/api/credentials/requests"))
      writes.push(r.postDataJSON());
  });
  page.on("response", async (r) => {
    if (
      r.url().startsWith(origin + "/api/") &&
      r.headers()["content-type"]?.includes("json")
    )
      responses.push(await r.text().catch(() => ""));
  });
  const control = async (action = "inspect") =>
    (
      await context.request.post(origin + "/api/test/credential-storage", {
        headers: { origin },
        data: { action },
      })
    ).json();
  const section = (scope = "provider") =>
    page.getByRole("region", {
      name:
        scope === "provider"
          ? "Provider secondary 的私密凭证"
          : "MCP secure 的私密凭证",
      exact: true,
    });
  const modal = () =>
    page.getByRole("dialog", { name: "保存私密凭证", exact: true });
  const key = (scope = "provider") =>
    modal().getByLabel(scope === "provider" ? "API Key" : "Bearer Token", {
      exact: true,
    });
  const settings = () =>
    page.getByRole("dialog", { name: "设置", exact: true });
  const openSettings = async () => {
    await page.getByPlaceholder("询问任何问题").waitFor();
    if (
      await page.getByRole("button", { name: "展开侧栏", exact: true }).count()
    )
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await page.getByRole("button", { name: "个人工作台 私有实例" }).click();
    await settings()
      .getByRole("button", { name: "模型与 Provider", exact: true })
      .click();
    await section().waitFor();
  };
  const open = async (scope = "provider", mode = "memory") => {
    const s = section(scope);
    await s.getByRole("button", { name: /设置私密凭证|更新私密凭证/ }).click();
    await s.getByRole("group", { name: "保存方式" }).waitFor();
    assert.equal(
      await s
        .getByRole("radio", { name: "仅当前工作台运行期间，重启后需重填" })
        .isChecked(),
      true,
    );
    if (mode === "encrypted")
      await s
        .getByRole("radio", { name: "在本机加密保存，重启后恢复" })
        .check();
    await s.getByRole("button", { name: "继续私密输入", exact: true }).click();
    await key(scope).waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector(".credential-modal input[type=password]")
          ?.disabled,
    );
  };
  const send = async (scope = "provider", value = secret) => {
    await key(scope).fill(value);
    await modal()
      .getByRole("button", { name: "保存并重新连接", exact: true })
      .click();
  };
  const close = async () => {
    await modal().getByRole("button", { name: "关闭", exact: true }).click();
    await modal().waitFor({ state: "hidden" });
  };
  const success = async () =>
    modal()
      .getByText("凭证已保存并重新连接，原值无法回读。", { exact: true })
      .waitFor();
  const restart = async () => {
    const old = (await control()).generation;
    await control("restart");
    await page.waitForTimeout(250);
    for (let i = 0; i < 60; i++) {
      try {
        const status = await control();
        if (status.generation > old) break;
      } catch {}
      await page.waitForTimeout(100);
    }
    await page.reload();
    await openSettings();
  };
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("private-fixture-password");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await openSettings();
  await check(
    "Provider storage defaults to memory and makes encrypted persistence an explicit choice",
    async () => {
      await open();
      assert.match(
        await modal().locator(".credential-scope").textContent(),
        /仅当前工作台内存保存/,
      );
      assert.equal(await key().getAttribute("type"), "password");
      assert.equal(await key().inputValue(), "");
    },
  );
  await check(
    "memory save uses a write-only input and reconnects native credentials without a DB secret row",
    async () => {
      await send();
      await success();
      assert.equal(await key().inputValue(), "");
      const state = await control();
      assert.equal(state.provider.state, "memory");
      assert.equal(state.provider.applied, true);
      assert.equal(state.encryptedRows, 0);
      assert.equal(state.nativeSecretSeen, false);
      assert.equal(writes[0].operation, "credential.save");
      assert.equal(Object.hasOwn(writes[0], "secret"), false);
      await close();
    },
  );
  await check(
    "refresh retains server memory credentials while updates never prefill the old value",
    async () => {
      await page.reload();
      await openSettings();
      await section()
        .getByText("仅保存在本次工作台内存 · 已载入", { exact: true })
        .waitFor();
      await open();
      assert.equal(await key().inputValue(), "");
      await modal()
        .getByRole("button", { name: "取消本次请求", exact: true })
        .click();
      await close();
    },
  );
  await check(
    "Bridge restart loses memory-only credentials and leaves an explicit refill state",
    async () => {
      await restart();
      await section()
        .getByText("上次内存凭证已丢失，请重新填写", { exact: true })
        .waitFor();
      assert.equal((await control()).provider.applied, false);
    },
  );
  await check(
    "explicit encrypted save persists only authenticated ciphertext and reports native activation",
    async () => {
      await open("provider", "encrypted");
      await send();
      await success();
      assert.equal((await control()).encryptedRows, 1);
      assert.equal((await control()).dbSecretSeen, false);
      await close();
      await section()
        .getByText("已在本机加密保存 · 已载入", { exact: true })
        .waitFor();
    },
  );
  await check(
    "full Bridge restart restores the encrypted credential and preserves login without reentering a key",
    async () => {
      await restart();
      await section()
        .getByText("已在本机加密保存 · 已载入", { exact: true })
        .waitFor();
      assert.equal((await control()).provider.applied, true);
    },
  );
  await check(
    "credential update starts blank, defaults to memory again and replaces the old encrypted entry",
    async () => {
      await open("provider", "encrypted");
      assert.equal(await key().inputValue(), "");
      await send("provider", secret + "_rotated");
      await success();
      assert.equal((await control()).encryptedRows, 1);
      await close();
    },
  );
  await check(
    "HTTPS MCP exposes a separate Bearer input while stdio does not offer credential storage",
    async () => {
      await settings()
        .getByRole("button", { name: "MCP 连接", exact: true })
        .click();
      await section("mcp").waitFor();
      assert.equal(
        await page
          .getByRole("region", { name: "MCP local 的私密凭证", exact: true })
          .count(),
        0,
      );
      await open("mcp", "encrypted");
      assert.equal(await key("mcp").getAttribute("type"), "password");
      await send("mcp");
      await success();
      assert.equal((await control()).mcp.applied, true);
      assert.equal((await control()).encryptedRows, 2);
      await close();
    },
  );
  await check(
    "a configuration conflict cannot replace the key and clears the attempted input",
    async () => {
      await settings()
        .getByRole("button", { name: "模型与 Provider", exact: true })
        .click();
      await open("provider", "encrypted");
      await control("change");
      await send();
      await modal()
        .getByText("保存结果未确认，请重新读取实际状态；不会自动重写凭证。", {
          exact: true,
        })
        .waitFor();
      assert.equal(await key().inputValue(), "");
      assert.equal((await control()).encryptedRows, 2);
      await close();
    },
  );
  await check(
    "clear requires explicit confirmation and removes only the selected credential",
    async () => {
      await section()
        .getByRole("button", { name: "清除私密凭证", exact: true })
        .click();
      await section()
        .getByRole("button", { name: "保留凭证", exact: true })
        .click();
      assert.equal((await control()).encryptedRows, 2);
      await section()
        .getByRole("button", { name: "清除私密凭证", exact: true })
        .click();
      await section()
        .getByRole("button", { name: "确认清除并重连", exact: true })
        .click();
      await section()
        .getByText("凭证已清除并重新连接。", { exact: true })
        .waitFor();
      assert.equal((await control()).provider.state, "none");
      assert.equal((await control()).mcp.state, "encrypted");
      assert.equal((await control()).encryptedRows, 1);
    },
  );
  await check(
    "saved but failed restart keeps the encrypted value and reconnects without submitting it again",
    async () => {
      await open("provider", "encrypted");
      await control("fail-restart");
      await send();
      await modal()
        .getByText("凭证已保存，运行时尚未就绪；请重新连接确认。", {
          exact: true,
        })
        .waitFor();
      const before = writes.length;
      assert.equal((await control()).provider.state, "encrypted");
      await modal()
        .getByRole("button", { name: "重新连接已保存凭证", exact: true })
        .click();
      await success();
      assert.equal(writes.length, before);
      assert.equal((await control()).provider.applied, true);
      await close();
    },
  );
  await check(
    "lost write acknowledgment is resolved by authoritative reads and applying the saved reference",
    async () => {
      await open("provider", "encrypted");
      await control("lose-write");
      await send();
      await modal()
        .getByText("凭证已保存，运行时尚未就绪；请重新连接确认。", {
          exact: true,
        })
        .waitFor();
      await modal()
        .getByRole("button", { name: "重新连接已保存凭证", exact: true })
        .click();
      await success();
      await close();
    },
  );
  await check(
    "mobile dark form preserves visible focus, target identity and touch-size actions",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: "dark" });
      await open();
      await key().scrollIntoViewIfNeeded();
      assert.equal(
        await key().evaluate((el) => document.activeElement === el),
        true,
      );
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
        true,
      );
      assert.ok(
        (
          await modal()
            .getByRole("button", { name: "保存并重新连接", exact: true })
            .boundingBox()
        ).height >= 44,
      );
      await page.screenshot({
        path: resolve(output, "private-storage-mobile-dark.png"),
        animations: "disabled",
      });
      await close();
    },
  );
  await check(
    "model calls, DB rows, API responses, browser storage and logs contain no credential input",
    async () => {
      const state = await control();
      assert.equal(state.nativeSecretSeen, false);
      assert.equal(state.dbSecretSeen, false);
      assert.equal(
        await page.evaluate(
          (value) =>
            JSON.stringify({ ...localStorage, ...sessionStorage }).includes(
              value,
            ),
          secret,
        ),
        false,
      );
      assert.ok(!responses.join("").includes(secret));
      assert.ok(!log.includes(secret));
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    },
  );
  writeFileSync(
    resolve(output, "result.json"),
    JSON.stringify(
      {
        checks,
        pageErrors: errors,
        externalRequests: external,
        secretScanPassed: true,
      },
      null,
      2,
    ),
  );
  console.log(`${checks.length} credential storage browser checks passed`);
} catch (error) {
  writeFileSync(
    resolve(output, "failure.json"),
    JSON.stringify(
      {
        checks,
        error: String(error).replaceAll(secret, "[redacted]"),
        logTail: log.slice(-1800).replaceAll(secret, "[redacted]"),
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
  if (page) {
    await page
      .locator("input[type=password]")
      .evaluateAll((list) => list.forEach((el) => (el.value = "")))
      .catch(() => {});
    await page
      .screenshot({ path: resolve(output, "failure.png") })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser?.close();
  child.kill("SIGTERM");
  await exited;
}
