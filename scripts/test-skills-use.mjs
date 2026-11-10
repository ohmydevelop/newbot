import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const output = resolve(".data/skills-use");
mkdirSync(output, { recursive: true, mode: 0o700 });
for (const file of ["result.json", "failure.json", "failure.png"])
  rmSync(resolve(output, file), { force: true });
const port = Number(process.env.SKILLS_TEST_PORT || 3110),
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
  const runs = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/agent/run"))
      runs.push(JSON.parse(request.postData()));
  });
  const control = async (action) => {
    const r = await context.request.post(`${origin}/api/test/skills`, {
      headers: { origin },
      data: { action },
    });
    assert.equal(r.status(), 200);
  };
  const wire = async () =>
    (
      await (
        await context.request.get(`${origin}/api/test/skill-inputs`)
      ).json()
    ).turns;
  const picker = async () => {
    await page.getByRole("button", { name: "选择技能", exact: true }).click();
    await dialog()
      .getByRole("combobox", { name: "搜索技能", exact: true })
      .waitFor();
  };
  const choose = async (name) => {
    const button = dialog().getByRole("option").filter({ hasText: name });
    await button.click();
    await page.waitForFunction(
      (name) =>
        Array.from(document.querySelectorAll("[role=option]")).some(
          (n) =>
            n.textContent.includes(name) &&
            n.getAttribute("aria-selected") === "true",
        ),
      name,
    );
  };
  const done = async () => {
    await dialog().getByRole("button", { name: "完成", exact: true }).click();
    await dialog().waitFor({ state: "hidden" });
  };
  const select = async (...names) => {
    await picker();
    for (const name of names) await choose(name);
    await done();
  };
  const send = async (text, expected = 200) => {
    await page.getByPlaceholder("询问任何问题").fill(text);
    const event = page.waitForResponse((r) =>
      r.url().endsWith("/api/agent/run"),
    );
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    const response = await event;
    assert.equal(response.status(), expected, await response.text());
    if (expected === 200)
      await page
        .getByRole("button", { name: "发送消息", exact: true })
        .waitFor();
    return response;
  };
  const viewReference = async () => {
    await page
      .getByRole("button", { name: "查看已指定技能 代码审查", exact: true })
      .first()
      .click();
    await dialog().locator(".skill-document-body[aria-busy=false]").waitFor();
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await dialog().waitFor({ state: "hidden" });
  };
  const shot = (name) =>
    page.screenshot({ path: `${output}/${name}.png`, animations: "disabled" });
  await page.goto(origin);
  await page.getByLabel("登录密码").fill("skills-ui-test-password");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("button", { name: "选择技能", exact: true }).waitFor();
  await check(
    "search, enabled state, multiple selection and removable draft chips",
    async () => {
      await picker();
      assert.equal(
        await dialog()
          .getByRole("option")
          .filter({ hasText: "disabled-skill" })
          .isDisabled(),
        true,
      );
      await dialog().getByRole("combobox").fill("审查");
      assert.equal(await dialog().getByRole("option").count(), 1);
      await choose("code-review");
      await dialog().getByRole("combobox").fill("");
      await choose("metadata-only");
      await done();
      assert.equal(await page.locator(".skill-draft-list > span").count(), 2);
      await page
        .getByRole("button", { name: "移除技能 metadata-only", exact: true })
        .click();
      assert.equal(await page.locator(".skill-draft-list > span").count(), 1);
      assert.equal((await wire()).length, 0);
    },
  );
  await check(
    "sending uses native skill input and stores an immutable message reference",
    async () => {
      await send("使用选定的技能检查代码");
      await page
        .getByRole("button", { name: "查看已指定技能 代码审查", exact: true })
        .waitFor();
      assert.equal(await page.locator(".skill-draft-list").count(), 0);
      const payload = runs.at(-1);
      assert.deepEqual(Object.keys(payload.skills[0]).sort(), ["id", "sha256"]);
      assert.equal(payload.skills[0].id.length, 64);
      const input = (await wire()).at(-1);
      const skills = input.filter((i) => i.type === "skill");
      assert.equal(skills.length, 1);
      assert.equal(skills[0].name, "code-review");
      assert.ok(skills[0].path.endsWith("/code-review/SKILL.md"));
      assert.equal(
        input.find((i) => i.type === "text").text,
        "使用选定的技能检查代码",
      );
      await viewReference();
      await dialog()
        .getByRole("heading", { name: "审查流程", exact: true })
        .waitFor();
      await close();
      await shot("skill-message");
    },
  );
  await check(
    "multiple selected skills preserve order and remain separate from message text",
    async () => {
      await select("metadata-only", "code-review");
      await send("第二轮使用两个技能");
      const input = (await wire()).at(-1);
      assert.deepEqual(
        input.filter((i) => i.type === "skill").map((i) => i.name),
        ["metadata-only", "code-review"],
      );
      assert.equal(await page.locator(".message-skill-refs button").count(), 3);
    },
  );
  await check(
    "changed content rejects dispatch and retains draft until the user reselects",
    async () => {
      await select("code-review");
      await control("update");
      const before = (await wire()).length;
      await send("保留这条未发送草稿", 409);
      await page
        .getByRole("alert")
        .filter({ hasText: "所选技能说明已变化" })
        .waitFor();
      assert.equal(
        await page.getByPlaceholder("询问任何问题").inputValue(),
        "保留这条未发送草稿",
      );
      assert.equal(await page.locator(".skill-draft-list > span").count(), 1);
      assert.equal((await wire()).length, before);
      await page
        .getByRole("button", { name: "移除技能 代码审查", exact: true })
        .click();
      await select("code-review");
      await send("使用重新选择的版本");
      await viewReference();
      await dialog()
        .getByRole("status")
        .filter({ hasText: "说明已变化" })
        .waitFor();
      await dialog()
        .getByRole("heading", { name: "已更新的技能说明", exact: true })
        .waitFor();
      await shot("skill-reference-changed");
      await close();
    },
  );
  await check(
    "disabled selections cannot execute and historical references still identify the original skill",
    async () => {
      await select("code-review");
      await control("disable");
      const before = (await wire()).length;
      await send("停用后不能执行", 409);
      await page
        .getByRole("alert")
        .filter({ hasText: "所选技能已停用" })
        .waitFor();
      assert.equal((await wire()).length, before);
      await page
        .getByRole("button", { name: "移除技能 代码审查", exact: true })
        .click();
      await viewReference();
      assert.match(
        await dialog().locator(".skill-metadata").textContent(),
        /已停用/,
      );
      await close();
      await control("enable");
    },
  );
  await check(
    "missing files reject sends; historical missing or removed skills show recoverable errors",
    async () => {
      await select("code-review");
      await control("delete-file");
      const before = (await wire()).length;
      await send("文件已不存在", 410);
      assert.equal((await wire()).length, before);
      await page
        .getByRole("button", { name: "移除技能 代码审查", exact: true })
        .click();
      await viewReference();
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "技能说明文件已失效" })
        .waitFor();
      await close();
      await control("restore");
      await control("remove");
      await viewReference();
      await dialog()
        .getByRole("alert")
        .filter({ hasText: "技能已不在当前列表中" })
        .waitFor();
      await close();
      await control("readd");
      await viewReference();
      await dialog()
        .getByRole("heading", { name: "审查流程", exact: true })
        .waitFor();
      await close();
    },
  );
  await check(
    "cancelled selection cannot append a stale skill to a different draft",
    async () => {
      const pattern = "**/api/skills/*";
      await page.route(pattern, async (route) => {
        await new Promise((r) => setTimeout(r, 500));
        await route.continue().catch(() => {});
      });
      await picker();
      await dialog()
        .getByRole("option")
        .filter({ hasText: "code-review" })
        .click();
      await close();
      await page.unroute(pattern);
      await select("metadata-only");
      assert.equal(await page.locator(".skill-draft-list > span").count(), 1);
      assert.equal(
        await page
          .getByRole("button", { name: "移除技能 代码审查", exact: true })
          .count(),
        0,
      );
      await page
        .getByRole("button", { name: "移除技能 metadata-only", exact: true })
        .click();
    },
  );
  await check(
    "refresh and reconnect restore the original message references without duplicating them",
    async () => {
      const before = await page.locator(".message-skill-refs button").count();
      await page.reload();
      await page
        .getByRole("button", { name: "查看已指定技能 代码审查", exact: true })
        .first()
        .waitFor();
      assert.equal(
        await page.locator(".message-skill-refs button").count(),
        before,
      );
      await viewReference();
      await dialog()
        .getByRole("heading", { name: "审查流程", exact: true })
        .waitFor();
      await close();
    },
  );
  await check(
    "new chat clears unsent skill selection and preserves historical references",
    async () => {
      await select("code-review");
      await page
        .getByRole("button", { name: "Minimal Agent，新对话", exact: true })
        .click();
      assert.equal(await page.locator(".skill-draft-list").count(), 0);
      await select("metadata-only");
      await send("新会话独立选择技能");
      assert.equal(await page.locator(".message-skill-refs button").count(), 1);
    },
  );
  await check(
    "mobile picker, chips and history viewer fit the viewport with 44px controls",
    async () => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.reload();
      await page
        .getByRole("button", { name: "选择技能", exact: true })
        .waitFor();
      await select("code-review");
      const remove = await page
        .getByRole("button", { name: "移除技能 代码审查", exact: true })
        .boundingBox();
      assert.ok(remove.width >= 44 && remove.height >= 44);
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await shot("skill-composer-mobile");
      await picker();
      await shot("skill-picker-mobile");
      const doneBox = await dialog()
        .getByRole("button", { name: "完成", exact: true })
        .boundingBox();
      assert.ok(doneBox.y + doneBox.height <= 812);
      await done();
      await send("手机发送指定技能");
      await viewReference();
      await shot("skill-history-mobile");
      await close();
    },
  );
  await check(
    "landscape selection and history actions stay visible",
    async () => {
      await page.setViewportSize({ width: 812, height: 375 });
      await page.reload();
      await page
        .getByRole("button", { name: "选择技能", exact: true })
        .waitFor();
      await picker();
      const box = await dialog()
        .getByRole("button", { name: "完成", exact: true })
        .boundingBox();
      assert.ok(box.y >= 0 && box.y + box.height <= 375);
      await close();
      await viewReference();
      const body = await dialog().locator(".skill-document-body").boundingBox();
      assert.ok(body.height >= 120);
      await shot("skill-history-landscape");
      await close();
    },
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(externalRequests, []);
  writeFileSync(
    `${output}/result.json`,
    JSON.stringify(
      {
        checks,
        pageErrors: errors,
        externalRequests,
        dispatchedTurns: (await wire()).length,
      },
      null,
      2,
    ),
  );
  console.log(
    `Skills use regression: ${checks.length} checks passed. Evidence: ${output}`,
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
