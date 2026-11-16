import { test, expect, type Page } from "@playwright/test";
async function login(page: Page) {
  await page.goto("/?profile=1");
  await page.getByLabel("登录密码").fill("issue-fixture-login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
}
async function settings(page: Page, tab = "连接器") {
  await login(page);
  if (page.viewportSize()!.width <= 760)
    await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: tab, exact: true }).click();
  await page.getByRole("searchbox", { name: `搜索${tab}` }).waitFor();
}
for (const width of [390, 1280])
  test(`侧栏同坐标连续折叠和导航顺序 ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page);
    const first = page.getByRole("button", {
        name: width <= 760 ? "展开侧栏" : "收起侧栏",
        exact: true,
      }),
      r = (await first.boundingBox())!;
    for (let i = 0; i < 6; i++) {
      await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2);
      const next = page.getByRole("button", {
        name: (width <= 760 ? i % 2 === 0 : i % 2 !== 0)
          ? "收起侧栏"
          : "展开侧栏",
        exact: true,
      });
      await expect(next).toBeVisible();
      if (width <= 760) await page.waitForTimeout(320);
      const b = (await next.boundingBox())!;
      expect(Math.abs(b.x - r.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.y - r.y)).toBeLessThanOrEqual(1);
    }
    if (width <= 760)
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "newbot 首页", exact: true }),
    ).toHaveCount(0);
    const nav = page.getByRole("navigation", { name: "主导航" });
    expect(
      (await nav.getByRole("button", { name: /新建聊天/ }).boundingBox())!.y,
    ).toBeLessThan(
      (await nav.getByRole("button", { name: /搜索聊天/ }).boundingBox())!.y,
    );
  });
for (const width of [390, 1280])
  test(`已有会话的两个输入框入口就地搜索选择 ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page);
    await page
      .getByRole("textbox", { name: "消息", exact: true })
      .fill("就地选择验收");
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await expect(
      page.getByText("测试回复完成。", { exact: true }),
    ).toBeVisible();
    for (const kind of ["plugins", "skills"]) {
      const trigger = page.locator(`[data-composer-picker="${kind}"]`);
      await expect(trigger).toBeEnabled();
      await trigger.click();
      const popup = page.locator(".composer-selection-panel");
      await expect(popup).toBeVisible();
      await trigger.click();
      await expect(popup).toHaveCount(0);
      await trigger.click();
      await expect(popup).toBeVisible();
      await expect(page.locator(".rail")).toHaveCount(0);
      const query = popup.getByRole("combobox");
      await query.fill(kind === "plugins" ? "测试插件" : "代码审查");
      const option = popup.getByRole("option").first();
      await expect(option).toBeVisible();
      await option.click();
      await expect(option).toHaveAttribute("aria-selected", "true");
      const box = (await popup.boundingBox())!,
        anchor = (await trigger.boundingBox())!;
      expect(box.height).toBeLessThan(240);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(Math.abs(box.y + box.height - anchor.y)).toBeLessThan(15);
      await info.attach(kind, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await page.keyboard.press("Escape");
      await expect(popup).toHaveCount(0);
      await expect(trigger).toBeFocused();
    }
    await page.getByRole("button", { name: "打开右侧栏", exact: true }).click();
    const rail = page.locator(".rail");
    await expect(rail).toBeVisible();
    await rail
      .getByRole("button", { name: "移除 测试插件", exact: true })
      .click();
    await expect(
      rail.getByRole("button", { name: "移除 测试插件", exact: true }),
    ).toHaveCount(0);
    await rail
      .getByRole("button", { name: "移除 代码审查", exact: true })
      .click();
    await expect(
      rail.getByRole("button", { name: "移除 代码审查", exact: true }),
    ).toHaveCount(0);
    await rail.getByRole("button", { name: "关闭右侧栏", exact: true }).click();
  });
for (const width of [390, 1280])
  test(`目录整体中心对齐、说明省略与图标添加 ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await settings(page);
    const seed = await page.request.post("/api/agent/action", {
      data: {
        action: "expert/save",
        name: `居中验收 ${width}`,
        description: "说明必须省略。".repeat(60),
        instructions: "只读验收",
        skillIds: [],
        pluginIds: [],
        connectorIds: [],
      },
      headers: { Origin: "http://127.0.0.1:3169" },
    });
    expect(seed.ok()).toBe(true);
    for (const section of ["连接器", "技能", "模型", "专家"]) {
      await page.getByRole("button", { name: section, exact: true }).click();
      await page.getByRole("searchbox", { name: `搜索${section}` }).waitFor();
      await expect(page.locator(".catalog-copy").first()).toBeVisible();
      const rows = await page
        .locator(".catalog-entry,.compact-skill-entry")
        .evaluateAll((nodes) =>
          nodes
            .filter((e) => e.getClientRects().length)
            .map((e) => {
              const row = e.getBoundingClientRect();
              const parts = Array.from(
                e.querySelectorAll(
                  ".catalog-status,.catalog-more,.catalog-icon,.expert-icon,.catalog-create",
                ),
              );
              return {
                delta: parts.map((p) => {
                  const r = p.getBoundingClientRect();
                  return Math.abs(r.y + r.height / 2 - row.y - row.height / 2);
                }),
                truncation: Array.from(
                  e.querySelectorAll(".catalog-identity small"),
                ).map((p) => ({
                  nowrap: getComputedStyle(p).whiteSpace,
                  overflow: getComputedStyle(p).textOverflow,
                })),
              };
            }),
        );
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        for (const d of row.delta) expect(d).toBeLessThanOrEqual(1);
        for (const t of row.truncation)
          expect(t).toEqual({ nowrap: "nowrap", overflow: "ellipsis" });
      }
      await info.attach(section, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    }
    const seeded = await seed.json();
    const removed = await page.request.post("/api/agent/action", {
      data: {
        action: "expert/delete",
        id: seeded.id,
        expectedRevision: seeded.revision,
      },
      headers: { Origin: "http://127.0.0.1:3169" },
    });
    expect(removed.ok()).toBe(true);
    await page.getByRole("button", { name: "连接器", exact: true }).click();
  });
test("删除后插件与独立连接器连续填满同一网格", async ({ page }) => {
  await settings(page);
  await page
    .getByRole("button", { name: "测试插件 更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "卸载", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "卸载 测试插件",
    exact: true,
  });
  await dialog.getByRole("button", { name: "卸载", exact: true }).click();
  const add = page.getByRole("button", { name: "添加 测试插件", exact: true });
  await expect(add).toBeVisible();
  await expect(add).toHaveText("");
  await add.click();
  await expect(
    page.getByRole("button", { name: "测试插件 更多操作", exact: true }),
  ).toBeVisible();
  const boxes = await page
    .locator(".tools-catalog > .catalog-grid")
    .first()
    .locator(".catalog-entry")
    .evaluateAll((nodes) =>
      nodes
        .filter((e) => e.getClientRects().length)
        .map((e) => e.getBoundingClientRect().toJSON()),
    );
  expect(boxes.length).toBeGreaterThan(3);
  for (let i = 0; i + 1 < boxes.length; i += 2)
    expect(Math.abs(boxes[i].y - boxes[i + 1].y)).toBeLessThan(2);
});
for (const width of [390, 1280])
  test(`长连接器详情底部仍可返回与管理 ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await settings(page);
    await page
      .getByRole("button", { name: "查看 test-server", exact: true })
      .click();
    await expect(page.locator(".connection-tool")).toHaveCount(125);
    const back = page.getByRole("button", { name: "返回", exact: true });
    await page.locator(".connection-tool").last().scrollIntoViewIfNeeded();
    const scroller = page.locator(".plugin-center-content");
    expect(await scroller.evaluate((e) => e.scrollTop)).toBeGreaterThan(200);
    const r = (await back.boundingBox())!,
      outer = (await scroller.boundingBox())!;
    const navigation = (await page
      .locator(".catalog-step-navigation")
      .last()
      .boundingBox())!;
    expect(Math.abs(navigation.y - outer.y)).toBeLessThanOrEqual(1);
    expect(r.y).toBeGreaterThanOrEqual(outer.y - 1);
    expect(r.y + r.height).toBeLessThan(outer.y + 100);
    const testButton = page.getByRole("button", {
      name: "测试 test-server",
      exact: true,
    });
    await expect(testButton).toBeVisible();
    await testButton.click();
    const feedback = page.locator('.catalog-heading-feedback [role="status"]');
    await expect(feedback).toContainText("需要授权");
    const feedbackBox = (await feedback.boundingBox())!;
    expect(feedbackBox.y).toBeGreaterThanOrEqual(outer.y);
    expect(feedbackBox.y + feedbackBox.height).toBeLessThan(outer.y + 180);
    const before = await scroller.evaluate((e) => e.scrollTop);
    await page
      .getByRole("button", { name: "test-server 更多操作", exact: true })
      .click();
    await expect(
      page.getByRole("menuitem", { name: "编辑", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "删除", exact: true }),
    ).toBeVisible();
    expect(await scroller.evaluate((e) => e.scrollTop)).toBeCloseTo(before, 0);
    await page.keyboard.press("Escape");
    await info.attach("sticky-actions", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await back.click();
    await expect(
      page.getByRole("searchbox", { name: "搜索连接器" }),
    ).toBeVisible();
  });

test("取消就地技能读取后切换聊天，迟到响应不能修改新聊天", async ({ page }) => {
  await login(page);
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("旧会话读取取消");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page.getByText("测试回复完成。", { exact: true })).toBeVisible();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    requested = new Promise<void>((r) => (started = r));
  await page.route(
    "**/api/skills/*",
    async (route) => {
      const response = await route.fetch();
      started();
      await gate;
      await route.fulfill({ response }).catch(() => {});
    },
    { times: 1 },
  );
  await page.locator('[data-composer-picker="skills"]').click();
  const picker = page.locator(".composer-selection-panel");
  await picker.getByRole("combobox").fill("代码审查");
  await picker.getByRole("option").first().click();
  await requested;
  await page.keyboard.press("Escape");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("button", { name: /新建聊天/ })
    .click();
  release();
  await page.locator('[data-composer-picker="skills"]').click();
  await picker.getByRole("combobox").fill("代码审查");
  await expect(picker.getByRole("option").first()).toHaveAttribute(
    "aria-selected",
    "false",
  );
  await expect(page.locator(".rail")).toHaveCount(0);
});
