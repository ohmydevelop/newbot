import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect, type Page } from "@playwright/test";
async function settleDetail(page: Page) {
  await page
    .locator(".catalog-step")
    .last()
    .evaluate(async (e) => {
      await Promise.all(
        e
          .getAnimations({ subtree: true })
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => {})),
      );
    });
}
async function settings(page: Page, section: string) {
  await page.goto("/?profile=1");
  await page.getByLabel("登录密码").fill("issue-fixture-login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  if (page.viewportSize()!.width <= 760)
    await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: section, exact: true }).click();
  await page.getByRole("searchbox", { name: `搜索${section}` }).waitFor();
}

test("目录主行状态和更多操作对齐，与有无说明无关", async ({ page }) => {
  await settings(page, "连接器");
  await page
    .getByRole("button", { name: "查看 测试插件", exact: true })
    .waitFor();
  const rows = await page.locator(".catalog-entry").evaluateAll((rows) =>
    rows.flatMap((e) => {
      const status = e.querySelector(".catalog-status"),
        more = e.querySelector(".catalog-more");
      if (!status || !more) return [];
      const a = status.getBoundingClientRect(),
        b = more.getBoundingClientRect();
      return [
        {
          name: e.querySelector("strong")?.textContent,
          delta: Math.abs(a.y + a.height / 2 - b.y - b.height / 2),
        },
      ];
    }),
  );
  expect(rows.length).toBeGreaterThan(1);
  for (const row of rows)
    expect(row.delta, row.name || "row").toBeLessThanOrEqual(1);
});

test("技能切换说明和源码不会移动主操作", async ({ page }) => {
  await settings(page, "技能");
  await page
    .getByRole("button", { name: "查看 personal-note 说明", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "重新读取技能说明" }),
  ).toBeEnabled();
  const action = page.getByRole("button", {
    name: "在聊天中使用",
    exact: true,
  });
  await settleDetail(page);
  const before = (await action.boundingBox())!;
  await page.getByRole("button", { name: "源码", exact: true }).click();
  const after = (await action.boundingBox())!;
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(1);
  await expect(
    page.getByRole("button", { name: "personal-note 更多操作" }),
  ).toBeVisible();
});

test("持久表单字段填值后标签仍然可见", async ({ page }) => {
  await settings(page, "模型");
  await page.getByRole("button", { name: "添加模型连接", exact: true }).click();
  await page
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("可读连接");
  for (const label of ["名称", "连接地址"]) {
    const text = page
      .locator("label")
      .filter({ has: page.getByRole("textbox", { name: label, exact: true }) })
      .locator("span")
      .first();
    expect((await text.boundingBox())!.height).toBeGreaterThan(10);
  }
});

test("工具详情使用主滚动容器，长目录不受旧卡片高度限制", async ({ page }) => {
  await settings(page, "连接器");
  await page
    .getByRole("button", { name: "查看 test-server", exact: true })
    .click();
  await expect(page.locator(".connection-tool")).toHaveCount(125);
  const nested = await page.locator(".connection-tools").evaluate((e) => {
    let p = e.parentElement;
    const bad = [];
    while (p && !p.classList.contains("plugin-center-content")) {
      if (
        p.scrollHeight > p.clientHeight + 2 &&
        ["auto", "scroll"].includes(getComputedStyle(p).overflowY)
      )
        bad.push(p.className);
      p = p.parentElement;
    }
    return bad;
  });
  expect(nested).toEqual([]);
});

async function alignedRows(page: Page) {
  const values = await page
    .locator(".catalog-entry,.compact-skill-entry")
    .evaluateAll((rows) =>
      rows.flatMap((e) => {
        const s = e.querySelector(".catalog-status"),
          m = e.querySelector(".catalog-more");
        if (!s || !m || !e.getClientRects().length) return [];
        const a = s.getBoundingClientRect(),
          b = m.getBoundingClientRect();
        return [
          {
            name: e.querySelector("strong")?.textContent,
            delta: Math.abs(a.y + a.height / 2 - b.y - b.height / 2),
          },
        ];
      }),
    );
  expect(values.length).toBeGreaterThan(0);
  for (const v of values)
    expect(v.delta, v.name || "row").toBeLessThanOrEqual(1);
}

for (const width of [320, 390, 768, 1280])
  for (const theme of ["浅色", "深色"]) {
    test(`深层目录视觉 ${width} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await settings(page, "连接器");
      await page.getByRole("button", { name: "外观", exact: true }).click();
      await page.getByRole("button", { name: theme, exact: true }).click();
      for (const section of ["连接器", "技能", "模型"]) {
        await page.getByRole("button", { name: section, exact: true }).click();
        await page.getByRole("searchbox", { name: `搜索${section}` }).waitFor();
        await expect(page.locator(".catalog-status").first()).toBeVisible();
        await alignedRows(page);
        const add = page.locator(".settings-toolbar .catalog-create");
        await expect(add).toHaveText("");
        await expect(add).toHaveAttribute("aria-label", /^添加/);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await info.attach(`${section}-${width}-${theme}`, {
          body: await page.screenshot(),
          contentType: "image/png",
        });
      }
      await page.getByRole("button", { name: "技能", exact: true }).click();
      await page
        .getByRole("button", { name: "查看 personal-note 说明", exact: true })
        .click();
      const use = page.getByRole("button", {
        name: "在聊天中使用",
        exact: true,
      });
      await expect(
        page.getByRole("button", { name: "重新读取技能说明" }),
      ).toBeEnabled();
      await settleDetail(page);
      const r = (await use.boundingBox())!;
      await page.getByRole("button", { name: "源码", exact: true }).click();
      expect(Math.abs((await use.boundingBox())!.y - r.y)).toBeLessThanOrEqual(
        1,
      );
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await info.attach(`skill-detail-${width}-${theme}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  }

async function scrollChain(page: Page, selector: string) {
  const outer = page.locator(".plugin-center-content"),
    inner = page.locator(selector);
  await inner.scrollIntoViewIfNeeded();
  const max = await inner.evaluate((e) => e.scrollHeight - e.clientHeight);
  expect(max).toBeGreaterThan(50);
  await inner.evaluate((e) => (e.scrollTop = 40));
  const before = await outer.evaluate((e) => e.scrollTop);
  await inner.hover();
  await page.mouse.wheel(0, 35);
  await expect
    .poll(() => inner.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(40);
  expect(await outer.evaluate((e) => e.scrollTop)).toBeCloseTo(before, 0);
  await inner.evaluate((e) => (e.scrollTop = 0));
  await inner.hover();
  await page.mouse.wheel(0, -100);
  await expect
    .poll(() => outer.evaluate((e) => e.scrollTop))
    .toBeLessThan(before);
  await inner.scrollIntoViewIfNeeded();
  await inner.evaluate((e) => (e.scrollTop = e.scrollHeight));
  // Leave space below the child so that the outer can consume the next wheel.
  await outer.evaluate(
    (e) => (e.scrollTop = Math.max(0, e.scrollHeight - e.clientHeight - 80)),
  );
  const down = await outer.evaluate((e) => e.scrollTop);
  await inner.hover();
  await page.mouse.wheel(0, 100);
  await expect
    .poll(() => outer.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(down);
  expect(await page.locator(".modal-scrim").count()).toBe(1);
}
for (const width of [390, 1280])
  test(`专家选择器双向滚动链 ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 720 });
    await settings(page, "专家");
    await page.getByRole("button", { name: "添加专家", exact: true }).click();
    await scrollChain(page, ".expert-member-picker");
    await info.attach("expert-scroll", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  });

test("技能管理菜单启停、失败重试与卸载取消保持正确状态", async ({ page }) => {
  await settings(page, "技能");
  await page
    .getByRole("button", { name: "personal-note 更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "停用", exact: true }).click();
  const row = page.locator(".compact-skill-entry").filter({
    has: page.getByRole("button", {
      name: "查看 personal-note 说明",
      exact: true,
    }),
  });
  await expect(row).toContainText("已停用");
  await page.reload();
  if (page.viewportSize()!.width <= 760)
    await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "技能", exact: true }).click();
  await expect(row).toContainText("已停用");
  await page.route(
    "**/api/skills/*",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "测试：说明暂不可用" }),
      }),
    { times: 1 },
  );
  await page
    .getByRole("button", { name: "查看 personal-note 说明", exact: true })
    .click();
  const use = page.getByRole("button", { name: "在聊天中使用", exact: true });
  await expect(use).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "重试读取", exact: true }),
  ).toBeVisible();
  await settleDetail(page);
  const before = (await use.boundingBox())!;
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "重新读取技能说明" }),
  ).toBeEnabled();
  expect(Math.abs((await use.boundingBox())!.y - before.y)).toBeLessThanOrEqual(
    1,
  );
  await page
    .getByRole("button", { name: "personal-note 更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "启用", exact: true }).click();
  await expect(use).toBeEnabled();
  await expect(page.locator(".skill-metadata")).toContainText("已启用");
  await page
    .getByRole("button", { name: "personal-note 更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "卸载", exact: true }).click();
  await page.getByRole("button", { name: "保留", exact: true }).click();
  await expect(use).toBeVisible();
});

test("共享表单认证菜单与证书入口保持可访问", async ({ page }) => {
  await settings(page, "连接器");
  await page.getByRole("button", { name: "添加连接器", exact: true }).click();
  await page.getByRole("menuitem", { name: "连接器", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "获取服务器证书", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "选择证书", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "认证方式", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "Bearer Token", exact: true })
    .click();
  await expect(
    page.getByLabel("Bearer Token", { exact: true }),
  ).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "认证方式", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "OAuth 登录", exact: true })
    .click();
  await expect(page.getByLabel("Bearer Token", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "连接方式", exact: true }).click();
  await page
    .getByRole("menuitemradio", { name: "本地程序", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "启动程序", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "认证方式", exact: true }),
  ).toHaveCount(0);
});

test("导入技能选择窗允许边缘交接且不执行安装", async ({ page }, info) => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-ui14-import-"));
  try {
    for (let i = 0; i < 24; i++) {
      const folder = join(dir, `skill-${i}`);
      mkdirSync(folder);
      writeFileSync(
        join(folder, "SKILL.md"),
        `---\nname: ui14-skill-${i}\ndescription: 本地导入滚动验证\n---\n# 技能 ${i}\n只读验收。`,
      );
    }
    const nativeScanner = !!process.env.CODEX_BIN;
    if (!nativeScanner) {
      const preview = {
        id: "00000000-0000-4000-8000-000000000014",
        source: { kind: "files", name: "滚动预览夹具" },
        state: "ready",
        bytes: 1000,
        files: 24,
        created: 1,
        retained: true,
        entries: [
          {
            id: "fixture",
            kind: "skills",
            name: "滚动预览夹具",
            root: ".",
            description: "",
            digest: "fixture",
            state: "available",
            mcp: [],
            hooks: [],
            skills: Array.from({ length: 24 }, (_, i) => ({
              id: `skill-${i}`,
              name: `技能 ${i}`,
              description: "滚动边界验证",
              path: `skill-${i}/SKILL.md`,
            })),
          },
        ],
      };
      await page.route("**/api/imports**", (route) =>
        route.fulfill({
          json:
            new URL(route.request().url()).pathname === "/api/imports"
              ? [preview]
              : preview,
        }),
      );
    }
    await info.attach("scanner-mode", {
      body: JSON.stringify({
        nativeScanner,
        scope: nativeScanner
          ? "local isolated Codex scanning"
          : "UI preview fixture only",
      }),
      contentType: "application/json",
    });
    await page.setViewportSize({ width: 390, height: 640 });
    await settings(page, "技能");
    await page.getByRole("button", { name: "添加技能", exact: true }).click();
    await page.getByRole("menuitem", { name: "导入技能", exact: true }).click();
    if (nativeScanner)
      await page.locator("input[webkitdirectory]").setInputFiles(dir);
    else
      await page.getByRole("button", { name: "滚动预览夹具 继续导入" }).click();
    await expect(page.locator(".import-skills")).toBeVisible();
    await scrollChain(page, ".import-skills");
    await info.attach("import-scroll", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(
      page.getByRole("searchbox", { name: "搜索技能" }),
    ).toBeVisible();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("插件嵌套工具详情使用同一主滚动，返回保留插件上下文", async ({
  page,
}, info) => {
  await settings(page, "连接器");
  await page
    .getByRole("button", { name: "查看 测试插件", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "测试插件", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".catalog-step-heading .catalog-use")).toHaveCount(
    1,
  );
  await page
    .getByRole("button", { name: "查看 test-server", exact: true })
    .click();
  await expect(
    page.locator(".catalog-step:last-child .connection-tool"),
  ).toHaveCount(125);
  const body = page.locator(".catalog-step:last-child .connection-detail-body");
  expect(await body.evaluate((e) => getComputedStyle(e).overflowY)).toBe(
    "visible",
  );
  await page.locator(".connection-tool").last().scrollIntoViewIfNeeded();
  expect(
    await page.locator(".plugin-center-content").evaluate((e) => e.scrollTop),
  ).toBeGreaterThan(200);
  await info.attach("plugin-tools", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "测试插件", exact: true }),
  ).toBeVisible();
});
