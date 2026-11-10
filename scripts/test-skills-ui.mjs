import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/skills-ui");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const file of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, file), { force: true });
const port = Number(process.env.SKILLS_TEST_PORT || 3108),
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "tests/skills-preview-server.ts"],
  {
    env: { ...process.env, NODE_ENV: "test", SKILLS_TEST_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const exited = new Promise((resolve) => server.once("exit", resolve));
let log = "";
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Skills fixture did not start")),
    15000,
  );
  const collect = (data) => {
    log += data.toString();
    if (log.includes("Skills UI fixture ready:")) {
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
let browser, page;
const checks = [],
  errors = [],
  externalRequests = [],
  writes = [];
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
    viewport: { width: 1280, height: 900 },
    reducedMotion: "reduce",
  });
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (/^https?:/.test(r.url()) && !r.url().startsWith(origin + "/"))
      externalRequests.push(r.url());
    if (r.method() === "POST" && r.url() === origin + "/api/config")
      writes.push(r.postData());
  });
  const dialog = () => page.getByRole("dialog");
  const read = async (name = "code-review") => {
    await dialog()
      .getByRole("button", { name: `查看 ${name} 说明`, exact: true })
      .click();
    await dialog()
      .locator(".skill-document-body[aria-busy=false]")
      .waitFor({ timeout: 25000 });
  };
  const back = async () => {
    await dialog()
      .getByRole("button", { name: "返回技能列表", exact: true })
      .click();
    await dialog()
      .getByRole("heading", { name: "技能", exact: true })
      .waitFor();
  };
  const control = async (action) => {
    const r = await context.request.post(`${origin}/api/test/skills`, {
      headers: { origin },
      data: { action },
    });
    assert.equal(r.status(), 200);
  };
  const screenshot = async (name) =>
    page.screenshot({ path: `${output}/${name}.png`, animations: "disabled" });
  const openSettings = async () => {
    await page.getByPlaceholder("询问任何问题").waitFor();
    if (
      await page.getByRole("button", { name: "展开侧栏", exact: true }).count()
    )
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: "技能", exact: true })
      .click();
    await dialog()
      .getByRole("button", { name: "查看 code-review 说明", exact: true })
      .waitFor();
  };
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("skills-ui-test-password");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await openSettings();
  await check(
    "native display name, descriptions, scope and enabled state",
    async () => {
      await dialog().getByText("代码审查", { exact: true }).waitFor();
      await dialog()
        .getByText("检查项目改动、风险与测试覆盖", { exact: true })
        .waitFor();
      assert.equal(
        await dialog()
          .getByRole("switch", { name: "启用 disabled-skill", exact: true })
          .getAttribute("aria-checked"),
        "false",
      );
      await screenshot("skills-list");
    },
  );
  await check(
    "formatted skill document is readable and executes no embedded content",
    async () => {
      await read();
      await dialog()
        .getByRole("heading", { name: "审查流程", exact: true })
        .waitFor();
      await dialog()
        .getByRole("heading", { name: "输出格式", exact: true })
        .waitFor();
      assert.match(
        await dialog().locator(".skill-description").textContent(),
        /只读检查不会自动修改文件/,
      );
      assert.equal(
        await dialog()
          .locator(
            ".skill-document-content img,.skill-document-content iframe,.skill-document-content .diagram",
          )
          .count(),
        0,
      );
      assert.equal(
        await dialog()
          .locator('.skill-document-content a[href="/api/config"]')
          .count(),
        0,
      );
      assert.equal(await page.evaluate(() => globalThis.SKILL_XSS), undefined);
      assert.match(
        await dialog().locator(".skill-document-content").textContent(),
        /flowchart LR/,
      );
      await screenshot("skill-document");
    },
  );
  await check(
    "reader focus and return focus remain in the settings dialog",
    async () => {
      assert.equal(
        await dialog()
          .getByRole("heading", { name: "代码审查", exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await back();
      await page.waitForFunction(
        () =>
          document.activeElement?.getAttribute("aria-label") ===
          "查看 code-review 说明",
      );
      assert.equal(
        await dialog()
          .getByRole("button", { name: "查看 code-review 说明", exact: true })
          .evaluate((node) => node === document.activeElement),
        true,
      );
      await page.keyboard.press("Enter");
      await dialog().locator(".skill-document-body[aria-busy=false]").waitFor();
    },
  );
  await check(
    "source view preserves complete frontmatter and text",
    async () => {
      await dialog().getByRole("button", { name: "源码", exact: true }).click();
      const content = await dialog()
        .getByLabel("SKILL.md 源码", { exact: true })
        .textContent();
      const source = await context.request.get(`${origin}/api/config`);
      const catalog = await source.json();
      const response = await context.request.get(
        `${origin}/api/skills/${catalog.skills.find((s) => s.name === "code-review").id}`,
      );
      assert.equal(content, (await response.json()).content);
      assert.ok(content.startsWith("---\nname: code-review"));
      await dialog().getByRole("button", { name: "说明", exact: true }).click();
      await back();
    },
  );
  await check(
    "disabled skill can be viewed without enabling or writing configuration",
    async () => {
      await read("disabled-skill");
      await dialog()
        .getByRole("heading", { name: "停用技能说明", exact: true })
        .waitFor();
      assert.match(
        await dialog().locator(".skill-metadata").textContent(),
        /已停用/,
      );
      assert.equal(writes.length, 0);
      await back();
    },
  );
  await check(
    "existing enable and disable controls still save native configuration",
    async () => {
      await dialog()
        .getByRole("switch", { name: "启用 disabled-skill", exact: true })
        .click();
      await dialog()
        .getByRole("switch", { name: "停用 disabled-skill", exact: true })
        .waitFor();
      await dialog()
        .getByRole("switch", { name: "停用 disabled-skill", exact: true })
        .click();
      await dialog()
        .getByRole("switch", { name: "启用 disabled-skill", exact: true })
        .waitFor();
      assert.equal(writes.length, 2);
    },
  );
  await check(
    "reload reads current content; missing and undiscovered skills fail and recover",
    async () => {
      await read();
      await control("update");
      await dialog()
        .getByRole("button", { name: "重新读取技能说明", exact: true })
        .click();
      await dialog()
        .getByRole("heading", { name: "已更新的技能说明", exact: true })
        .waitFor();
      await control("delete-file");
      await dialog()
        .getByRole("button", { name: "重新读取技能说明", exact: true })
        .click();
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "技能说明文件已失效" })
        .waitFor();
      await control("restore");
      await dialog()
        .getByRole("button", { name: "重试读取", exact: true })
        .click();
      await dialog()
        .getByRole("heading", { name: "审查流程", exact: true })
        .waitFor();
      await control("remove");
      await dialog()
        .getByRole("button", { name: "重新读取技能说明", exact: true })
        .click();
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "技能已不在当前列表中" })
        .waitFor();
      await control("readd");
      await dialog()
        .getByRole("button", { name: "重试读取", exact: true })
        .click();
      await dialog()
        .getByRole("heading", { name: "审查流程", exact: true })
        .waitFor();
      await back();
    },
  );
  await check(
    "empty and metadata-only documents have useful states",
    async () => {
      await read("empty-skill");
      await dialog().getByText("说明文件为空。", { exact: true }).waitFor();
      await back();
      await read("metadata-only");
      await dialog()
        .getByText("此文件仅包含技能元数据，可切换源码查看。", { exact: true })
        .waitFor();
      await dialog().getByRole("button", { name: "源码", exact: true }).click();
      assert.match(
        await dialog().getByLabel("SKILL.md 源码").textContent(),
        /name: metadata-only/,
      );
      await back();
    },
  );
  await check(
    "unsafe, oversized and invalid-text files show bounded errors without secret content",
    async () => {
      for (const [name, message] of [
        ["linked-skill", "链接文件暂不支持查看"],
        ["oversized-skill", "技能说明超过 256 KiB"],
        ["invalid-skill", "技能说明不是有效的 UTF-8"],
      ]) {
        await read(name);
        await dialog()
          .getByRole("alert")
          .filter({ hasText: message })
          .waitFor();
        assert.ok(
          !(await dialog().textContent()).includes("SYNTHETIC_SKILL_SECRET"),
        );
        await back();
      }
    },
  );
  await check(
    "network errors can retry and returning while loading cancels stale content",
    async () => {
      const pattern = "**/api/skills/*";
      await page.route(pattern, (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: "测试技能说明读取失败" }),
        }),
      );
      await read();
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "测试技能说明读取失败" })
        .waitFor();
      await page.unroute(pattern);
      await dialog()
        .getByRole("button", { name: "重试读取", exact: true })
        .click();
      await dialog()
        .getByRole("heading", { name: "审查流程", exact: true })
        .waitFor();
      await back();
      await page.route(pattern, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await route.continue().catch(() => {});
      });
      await dialog()
        .getByRole("button", { name: "查看 code-review 说明", exact: true })
        .click();
      await dialog().getByText("正在读取技能说明…", { exact: true }).waitFor();
      await back();
      await page.unroute(pattern);
      await read("disabled-skill");
      await dialog()
        .getByRole("heading", { name: "停用技能说明", exact: true })
        .waitFor();
      assert.equal(
        await dialog()
          .getByRole("heading", { name: "审查流程", exact: true })
          .count(),
        0,
      );
      await back();
    },
  );
  await check(
    "discovery errors and native warnings are visible and refreshable",
    async () => {
      await control("fail-list");
      await dialog()
        .getByRole("button", { name: "刷新技能", exact: true })
        .click();
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "技能列表读取失败" })
        .waitFor();
      assert.equal(
        await dialog().getByText("没有发现 Skills", { exact: true }).count(),
        0,
      );
      assert.ok(
        !(await dialog().textContent()).includes("private native error"),
      );
      await control("recover-list");
      await control("warnings");
      await dialog()
        .getByRole("button", { name: "刷新技能", exact: true })
        .click();
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "有 1 项技能无法加载" })
        .waitFor();
      await control("clear-warnings");
      await dialog()
        .getByRole("button", { name: "刷新技能", exact: true })
        .click();
      await dialog()
        .getByRole("button", { name: "查看 code-review 说明", exact: true })
        .waitFor();
    },
  );
  await check(
    "closing and refreshing keep the read-only viewer available",
    async () => {
      await read();
      await page.keyboard.press("Escape");
      await dialog().waitFor({ state: "hidden" });
      await page.reload();
      await openSettings();
      await read();
      await dialog()
        .getByRole("heading", { name: "审查流程", exact: true })
        .waitFor();
      await back();
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "dark mode and 375px controls remain readable and tappable",
    async () => {
      await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.reload();
      await openSettings();
      for (const control of await dialog()
        .locator(".skill-list-actions button")
        .all()) {
        const box = await control.boundingBox();
        assert.ok(
          box.height >= 44 && box.width >= 44,
          "Skill list touch targets must be at least 44px",
        );
      }
      await screenshot("skills-mobile-dark");
      await read();
      await dialog()
        .getByRole("heading", { name: "审查流程", exact: true })
        .waitFor();
      const geometry = await page.evaluate(() => ({
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      assert.ok(geometry.scroll <= geometry.width);
      for (const button of await dialog()
        .locator(".skill-reader-toolbar button")
        .all()) {
        const box = await button.boundingBox();
        assert.ok(box.height >= 44 && box.width >= 44);
      }
      await screenshot("skill-mobile-dark");
      await page.keyboard.press("Escape");
    },
  );
  await check(
    "landscape leaves readable page space and keeps reader controls visible",
    async () => {
      await page.setViewportSize({ width: 812, height: 375 });
      await page.reload();
      await openSettings();
      await read();
      const content = await dialog()
        .locator(".skill-document-body")
        .boundingBox();
      assert.ok(content.height >= 120);
      const box = await dialog().boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 375);
      for (const button of await dialog()
        .locator(".skill-reader-toolbar button")
        .all()) {
        const rect = await button.boundingBox();
        assert.ok(rect.y >= 0 && rect.y + rect.height <= 375);
      }
      await screenshot("skill-landscape");
      await back();
    },
  );
  await check(
    "older backends keep native skill controls and hide unsupported document actions",
    async () => {
      await page.keyboard.press("Escape");
      const pattern = "**/api/runtime/capabilities";
      await page.route(pattern, async (route) => {
        const response = await route.fetch();
        const json = await response.json();
        delete json.capabilities.skillDocuments;
        delete json.capabilities.skillSelection;
        await route.fulfill({ response, json });
      });
      await page.reload();
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name: "技能", exact: true })
        .click();
      await dialog().getByText("代码审查", { exact: true }).waitFor();
      assert.equal(
        await dialog()
          .getByRole("button", { name: /^查看 .* 说明$/ })
          .count(),
        0,
      );
      assert.equal(
        await dialog()
          .getByRole("switch", { name: "启用 disabled-skill", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "选择技能", exact: true })
          .count(),
        0,
      );
      await page.keyboard.press("Escape");
      await page.unroute(pattern);
      await page.reload();
      await openSettings();
    },
  );
  await check("session expiry while reading returns to login", async () => {
    await page.route("**/api/skills/*", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "请先登录" }),
      }),
    );
    await dialog()
      .getByRole("button", { name: "查看 code-review 说明", exact: true })
      .click();
    await page.getByLabel("登录密码").waitFor();
  });
  assert.deepEqual(errors, [], "Browser page errors");
  assert.deepEqual(externalRequests, [], "Skills UI made external requests");
  writeFileSync(
    `${output}/result.json`,
    JSON.stringify(
      {
        checks,
        pageErrors: errors,
        externalRequests,
        configurationWrites: writes.length,
      },
      null,
      2,
    ),
  );
  console.log(
    `Skills UI regression: ${checks.length} checks passed. Evidence: ${output}`,
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
