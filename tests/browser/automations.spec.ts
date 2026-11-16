import { test, expect } from "@playwright/test";
for (const width of [390, 1280])
  for (const theme of ["light", "dark"] as const)
    test(`自动任务完整流程 ${width} ${theme}`, async ({ page }, info) => {
      test.setTimeout(75000);
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/");
      await page.getByLabel("登录密码").fill("issue-fixture-login");
      await page.getByRole("button", { name: "继续", exact: true }).click();
      const composer = page.getByRole("textbox", { name: "消息", exact: true });
      await composer.fill("保留我的聊天草稿");
      if (width < 760)
        await page
          .getByRole("button", { name: "展开侧栏", exact: true })
          .click();
      const nav = page.getByRole("navigation", { name: "主导航" });
      const positions = await Promise.all(
        [/新建聊天/, /^自动任务/, /搜索聊天/].map(
          async (name) =>
            (await nav.getByRole("button", { name }).boundingBox())!.y,
        ),
      );
      expect(positions[0]).toBeLessThan(positions[1]);
      expect(positions[1]).toBeLessThan(positions[2]);
      await nav.getByRole("button", { name: /^自动任务/ }).click();
      await page
        .getByRole("heading", { name: "自动任务", exact: true })
        .waitFor();
      await page.getByRole("button", { name: "新建任务", exact: true }).click();
      const modal = page.getByRole("region", {
        name: "新建自动任务",
        exact: true,
      });
      const name = `自动验收 ${width} ${theme}`;
      await modal
        .getByRole("textbox", { name: "任务名称", exact: true })
        .fill(name);
      await modal
        .getByRole("textbox", { name: "任务指令", exact: true })
        .fill("只回答：自动任务验收成功");
      await modal
        .getByRole("button", { name: "添加触发器", exact: true })
        .click();
      await page.getByRole("button", { name: "每周", exact: true }).click();
      await modal
        .getByRole("button", { name: "执行星期 1", exact: true })
        .click();
      await page.getByRole("button", { name: "星期五", exact: true }).click();
      await page.keyboard.press("Escape");
      await modal
        .getByRole("button", { name: "添加触发器", exact: true })
        .click();
      await page.getByRole("button", { name: "每天", exact: true }).click();
      await modal
        .getByRole("button", { name: "移除触发器 2", exact: true })
        .click();
      await modal
        .locator(".automation-editor-body")
        .evaluate((e) => (e.scrollTop = e.scrollHeight));
      await expect(
        modal.getByRole("button", { name: "保存", exact: true }),
      ).toBeInViewport();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.screenshot({ path: info.outputPath("editor.png") });
      await modal.getByRole("button", { name: "保存", exact: true }).click();
      await expect(modal).not.toBeVisible();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      await page.getByRole("tab", { name: "概览", exact: true }).press("End");
      await expect(
        page.getByRole("tab", { name: "运行记录", exact: true }),
      ).toBeFocused();
      await expect(
        page.getByRole("tabpanel", { name: "运行记录", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("tab", { name: "运行记录", exact: true })
        .press("ArrowLeft");
      await expect(
        page.getByRole("tab", { name: "概览", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await page.getByRole("button", { name: "立即运行", exact: true }).click();
      await page
        .getByRole("button", { name: "打开会话", exact: true })
        .first()
        .waitFor({ timeout: 30000 });
      await expect(
        page.getByRole("button", { name: "已完成", exact: true }),
      ).toBeVisible({ timeout: 30000 });
      await page.screenshot({ path: info.outputPath("runs.png") });
      await page
        .getByRole("button", { name: "打开会话", exact: true })
        .first()
        .click();
      await expect(composer).toBeVisible();
      await expect(
        page.getByText("测试回复完成。", { exact: true }),
      ).toBeVisible();
      if (width < 760)
        await page
          .getByRole("button", { name: "展开侧栏", exact: true })
          .click();
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name: /^自动任务/ })
        .click();
      await page
        .getByRole("button", { name: "返回自动任务", exact: true })
        .click();
      await page
        .getByRole("button", { name: `更多操作：${name}`, exact: true })
        .click();
      await page.getByRole("menuitem", { name: "暂停", exact: true }).click();
      await expect(
        page.getByText("已暂停", { exact: true }).last(),
      ).toBeVisible();
      await page.reload();
      await expect(
        page.getByRole("heading", { name: "自动任务", exact: true }),
      ).toBeVisible();
      await page.getByRole("searchbox", { name: "搜索自动任务" }).fill(name);
      await expect(page.locator(".automation-row")).toHaveCount(1);
      await page.screenshot({ path: info.outputPath("list.png") });
      const search = page.getByRole("searchbox", { name: "搜索自动任务" });
      expect(
        await search.evaluate((e) => getComputedStyle(e).borderTopWidth),
      ).toBe("0px");
      await page
        .getByRole("heading", { name: "自动任务", exact: true })
        .click();
      await page.screenshot({
        path: info.outputPath("list-filled-unfocused.png"),
      });
      await search.fill("");
      await page.screenshot({
        path: info.outputPath("list-empty-focused.png"),
      });
      await page
        .getByRole("heading", { name: "自动任务", exact: true })
        .click();
      await page.screenshot({
        path: info.outputPath("list-empty-unfocused.png"),
      });
      await search.fill(name);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page
        .getByRole("button", { name: `更多操作：${name}`, exact: true })
        .click();
      await page.getByRole("menuitem", { name: "删除", exact: true }).click();
      await page
        .getByRole("dialog", { name: "删除自动任务" })
        .getByRole("button", { name: "删除", exact: true })
        .click();
      await expect(
        page.getByRole("dialog", { name: "删除自动任务" }),
      ).not.toBeVisible();
    });
for (const width of [320, 390, 1280])
  test(`自动任务弹层、邮件配置与焦点 ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/");
    await page.getByLabel("登录密码").fill("issue-fixture-login");
    await page.getByRole("button", { name: "继续", exact: true }).click();
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await composer.fill("切换后保留草稿");
    if (width < 760)
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: /^自动任务/ })
      .click();
    await page.getByRole("button", { name: "新建任务", exact: true }).click();
    const modal = page.getByRole("region", {
      name: "新建自动任务",
      exact: true,
    });
    await modal
      .getByRole("button", { name: "添加触发器", exact: true })
      .click();
    await page.getByRole("button", { name: "每天", exact: true }).click();
    for (const label of [
      "重复频率 1",
      "日期与时区 1",
      "执行时间 1",
      "任务模型",
      "交互模式：聊天",
      "连接器",
      "技能",
    ]) {
      await modal.getByRole("button", { name: label, exact: true }).click();
      if (label.startsWith("交互模式")) {
        await expect(
          page.getByRole("menu", { name: "交互模式：聊天" }),
        ).toBeVisible();
      } else {
        await expect(page.locator(".picker-panel:visible")).toHaveCount(1);
        expect(
          await page.locator(".picker-panel:visible").evaluate((el) => {
            const r = el.getBoundingClientRect();
            return el.contains(
              document.elementFromPoint(
                r.x + r.width / 2,
                r.y + Math.min(20, r.height / 2),
              ),
            );
          }),
        ).toBe(true);
      }
      await page.keyboard.press("Escape");
      await expect(page.locator(".picker-panel:visible")).toHaveCount(0);
      await expect(modal).toBeVisible();
    }
    await modal.getByRole("button", { name: "任务通知", exact: true }).click();
    await page.getByRole("button", { name: "站内与邮件", exact: true }).click();
    await modal.getByRole("button", { name: "配置邮件", exact: true }).click();
    const mail = page.getByRole("dialog", { name: "邮件通知", exact: true });
    await mail.getByLabel("SMTP 服务器", { exact: true }).fill("127.0.0.1");
    await mail.getByLabel("端口", { exact: true }).fill("1");
    await mail.getByLabel("发件邮箱", { exact: true }).fill("bot@example.test");
    await mail
      .getByLabel("收件邮箱", { exact: true })
      .fill("owner@example.test");
    await mail.getByLabel("账号", { exact: true }).fill("fixture");
    await mail.getByLabel("应用密码", { exact: true }).fill("local-test-only");
    await mail
      .getByLabel("newbot 地址", { exact: true })
      .fill("https://newbot.example.test");
    await mail
      .locator(".automation-editor-body")
      .evaluate((e) => (e.scrollTop = e.scrollHeight));
    await expect(
      mail.getByRole("button", { name: "保存", exact: true }),
    ).toBeInViewport();
    await mail.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      mail.getByText("已保存，可检查连接或发送测试邮件。", { exact: true }),
    ).toBeVisible();
    await mail.getByRole("button", { name: "检查连接", exact: true }).click();
    await expect(mail.getByRole("alert")).toContainText("邮件服务器");
    await page.screenshot({ path: info.outputPath("mail.png") });
    await mail
      .locator(".automation-editor-body")
      .evaluate((e) => (e.scrollTop = 0));
    await page.screenshot({ path: info.outputPath("mail-top.png") });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(mail).not.toBeVisible();
    await expect(modal).toBeVisible();
    await modal.getByRole("button", { name: "取消", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "新建任务", exact: true }),
    ).toBeFocused();
  });

for (const width of [320, 768, 1280])
  test(`自动任务目录连续性、日历与小时窗口 ${width}`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.getByLabel("登录密码").fill("issue-fixture-login");
    await page.getByRole("button", { name: "继续", exact: true }).click();
    if (width < 760)
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: /^自动任务/ })
      .click();
    const categories = page.getByRole("group", { name: "任务模板分类" });
    await categories.getByRole("button", { name: "研究", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "添加论文追踪", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "添加晨间简报", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("searchbox", { name: "搜索自动任务" }).fill("论文");
    const template = page.getByRole("button", {
      name: "添加论文追踪",
      exact: true,
    });
    await template.click();
    const editor = page.getByRole("region", {
      name: "新建自动任务",
      exact: true,
    });
    await expect(
      editor.getByRole("textbox", { name: "任务名称", exact: true }),
    ).toHaveValue("论文追踪");
    await editor.getByRole("button", { name: "任务图标", exact: true }).click();
    await page.getByRole("button", { name: "绿色", exact: true }).click();
    await page.getByRole("button", { name: "研究", exact: true }).click();
    await page.keyboard.press("Escape");
    await editor
      .getByRole("button", { name: "重复频率 1", exact: true })
      .click();
    await page.getByRole("button", { name: "每小时", exact: true }).click();
    await editor
      .getByRole("button", { name: "执行时间 1", exact: true })
      .click();
    await page.getByLabel("输入执行时间 1", { exact: true }).fill("09:30");
    await page.getByLabel("结束时间 1", { exact: true }).fill("17:30");
    await page.keyboard.press("Escape");
    await editor
      .getByRole("button", { name: "日期与时区 1", exact: true })
      .click();
    await page.getByRole("button", { name: "时区 1", exact: true }).click();
    await page.getByRole("textbox", { name: "搜索时区 1" }).fill("UTC");
    await page.getByRole("button", { name: "UTC", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(editor).toBeVisible();
    await expect(
      editor.getByRole("button", { name: "日期与时区 1" }),
    ).toContainText("UTC");
    await page.screenshot({ path: info.outputPath("hourly.png") });
    await editor.getByRole("button", { name: "取消", exact: true }).click();
    await expect(template).toBeFocused();
    await expect(
      page.getByRole("searchbox", { name: "搜索自动任务" }),
    ).toHaveValue("论文");
    await expect(
      categories.getByRole("button", { name: "研究", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("searchbox", { name: "搜索自动任务" }).fill("");
    await categories.getByRole("button", { name: "全部", exact: true }).click();
    const scroll = page.locator(".automation-scroll");
    await scroll.evaluate((el) => (el.scrollTop = el.scrollHeight));
    const before = await scroll.evaluate((el) => el.scrollTop);
    await page
      .getByRole("button", { name: "添加安全巡检", exact: true })
      .click();
    await page
      .getByRole("region", { name: "新建自动任务" })
      .getByRole("button", { name: "取消", exact: true })
      .click();
    expect(await scroll.evaluate((el) => el.scrollTop)).toBe(before);
    await scroll.evaluate((el) => (el.scrollTop = 0));
    const templateRows = page
      .getByRole("region", { name: "任务模板" })
      .locator(".automation-row");
    const first = (await templateRows.nth(0).boundingBox())!;
    const second = (await templateRows.nth(1).boundingBox())!;
    if (width <= 768) {
      expect(Math.abs(first.x - second.x)).toBeLessThan(1);
      expect(second.y).toBeGreaterThan(first.y);
    } else {
      expect(second.x).toBeGreaterThan(first.x + 250);
      expect(Math.abs(first.y - second.y)).toBeLessThan(1);
    }
    await page.screenshot({ path: info.outputPath("catalog.png") });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width);
  });
