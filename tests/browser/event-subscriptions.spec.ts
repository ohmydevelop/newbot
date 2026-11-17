import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
for (const width of [320, 390, 1280])
  for (const theme of ["light", "dark"] as const)
    test(`应用订阅 ${width} ${theme}`, async ({ page }, info) => {
      test.setTimeout(60000);
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/");
      await page.getByLabel("登录密码").fill("issue-fixture-login");
      await page.getByRole("button", { name: "继续", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "选择模型", exact: true }),
      ).toBeEnabled();
      if (width < 760)
        await page
          .getByRole("button", { name: "展开侧栏", exact: true })
          .click();
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name: /^自动任务/ })
        .click();
      await page.getByRole("button", { name: "新建任务", exact: true }).click();
      const editor = page.getByRole("region", {
        name: "新建自动任务",
        exact: true,
      });
      await editor
        .getByLabel("任务名称", { exact: true })
        .fill(`订阅验收 ${width} ${theme}`);
      await editor
        .getByLabel("任务指令", { exact: true })
        .fill("汇总收到的 GitHub 事件");
      await editor
        .getByRole("button", { name: "添加触发器", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "搜索添加触发器", exact: true })
        .fill("GitHub 仓库");
      await page
        .getByRole("button", { name: "GitHub 仓库事件", exact: true })
        .click();
      const trigger = editor.getByRole("button", {
        name: "应用事件条件 1",
        exact: true,
      });
      await trigger.click();
      await page.getByRole("button", { name: "连接账号", exact: true }).click();
      await page
        .getByLabel("事件账号名称", { exact: true })
        .fill(`公开仓库 ${width} ${theme}`);
      await expect(page.getByLabel("访问令牌")).toHaveAttribute(
        "type",
        "password",
      );
      mkdirSync(".impeccable/review/event-subscriptions", { recursive: true });
      await page.screenshot({
        path: `.impeccable/review/event-subscriptions/account-${width}-${theme}.png`,
      });
      await page.getByRole("button", { name: "保存账号", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "编辑账号", exact: true }),
      ).toBeVisible();
      await page
        .getByLabel("仓库")
        .fill("example/repository-with-a-long-name-for-responsive-layout");
      await page.getByRole("button", { name: "订阅事件", exact: true }).click();
      await page
        .getByRole("button", { name: "Issue 已关闭", exact: true })
        .click();
      await expect(page.getByLabel("事件接收地址")).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      const path = `.impeccable/review/event-subscriptions/${width}-${theme}.png`;
      mkdirSync(".impeccable/review/event-subscriptions", { recursive: true });
      await page.screenshot({ path });
      await info.attach("条件", { path, contentType: "image/png" });
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect(editor).not.toBeVisible();
      for (let i = 0; i < 2; i++)
        await page.evaluate(async () => {
          const r = await fetch("/fixture/subscription-step", {
            method: "POST",
          });
          if (!r.ok) throw Error(await r.text());
        });
      await page.getByRole("button", { name: /订阅状态$/ }).click();
      await expect(page.getByRole("status")).toHaveText("监听中");
      await page.screenshot({
        path: `.impeccable/review/event-subscriptions/status-${width}-${theme}.png`,
      });
      await expect(page.getByLabel("事件接收地址")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.getByRole("tab", { name: "运行记录", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "已完成", exact: true }).first(),
      ).toBeVisible({ timeout: 20000 });
    });
