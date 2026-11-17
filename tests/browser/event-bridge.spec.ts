import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
for (const width of [320, 390, 768, 1280])
  for (const theme of ["light", "dark"] as const)
    test(`通用事件插件 ${width} ${theme}`, async ({ page }, info) => {
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
        .fill("汇总收到的 信箱事件");
      await editor
        .getByRole("button", { name: "添加触发器", exact: true })
        .click();
      for (const name of ["GitHub", "OpenClaw", "Hermes", "Webhook"])
        await expect(
          page.getByRole("button", { name, exact: true }),
        ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "测试信箱", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "来自插件", exact: true }),
      ).toBeVisible();
      const sourceSearch = page.getByLabel("搜索添加触发器", { exact: true });
      await sourceSearch.fill("测试信箱");
      await expect(
        page.getByRole("heading", { name: "时间", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "外部事件", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "来自插件", exact: true }),
      ).toBeVisible();
      await sourceSearch.fill("");
      await page.screenshot({
        path: info.outputPath("installed-plugin-menu.png"),
      });
      await page
        .getByRole("textbox", { name: "搜索添加触发器", exact: true })
        .fill("测试信箱");
      await page.getByRole("button", { name: "测试信箱", exact: true }).click();
      const trigger = editor.getByRole("button", {
        name: "应用事件条件 1",
        exact: true,
      });
      await trigger.click();
      await page.getByRole("button", { name: "连接账号", exact: true }).click();
      await page
        .getByLabel("事件账号名称", { exact: true })
        .fill(`信箱账号 ${width} ${theme}`);
      const { file } = await page.evaluate(() =>
        fetch("/fixture/bridge").then((r) => r.json()),
      );
      await page.getByLabel("消息文件", { exact: true }).fill(file);
      mkdirSync(".impeccable/review/plugin-only-triggers", { recursive: true });
      await page.screenshot({
        path: `.impeccable/review/plugin-only-triggers/account-${width}-${theme}.png`,
      });
      await page.getByRole("button", { name: "保存账号", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "编辑账号", exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: "订阅事件", exact: true }).click();
      await page
        .getByRole("button", { name: "收到邮件（测试）", exact: true })
        .click();
      await page
        .getByLabel("信箱", { exact: true })
        .fill(`inbox-${width}-${theme}`);
      const priority = page.getByRole("button", {
        name: "优先级",
        exact: true,
      });
      await expect(page.getByText("优先级", { exact: true })).toBeVisible();
      await priority.click();
      await page.getByRole("button", { name: "重要", exact: true }).click();
      await expect(priority).toHaveText("重要");
      await expect(page.getByText("优先级", { exact: true })).toBeVisible();
      await priority.click();
      await page.keyboard.press("Escape");
      await expect(priority).toBeFocused();
      const checkbox = page.getByRole("checkbox", {
        name: "仅未读",
        exact: true,
      });
      await checkbox.check();
      await expect(checkbox).toBeChecked();
      const alignment = await checkbox.evaluate((el) => {
        const input = el.getBoundingClientRect(),
          label = el.closest("label")!.getBoundingClientRect();
        return {
          delta: Math.abs(
            input.y + input.height / 2 - label.y - label.height / 2,
          ),
          width: input.width,
        };
      });
      expect(alignment.delta).toBeLessThanOrEqual(1);
      expect(alignment.width).toBeLessThanOrEqual(20);
      await expect(page.getByLabel("事件接收地址")).toHaveCount(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      const path = `.impeccable/review/plugin-only-triggers/${width}-${theme}.png`;
      mkdirSync(".impeccable/review/plugin-only-triggers", { recursive: true });
      await page.screenshot({ path });
      await info.attach("条件", { path, contentType: "image/png" });
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect(editor).not.toBeVisible();
      const mailbox = `inbox-${width}-${theme}`;
      await page.evaluate(async (mailbox) => {
        await fetch("/fixture/bridge-step", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mailbox, baseline: true }),
        });
      }, mailbox);
      await page.evaluate(async (mailbox) => {
        await fetch("/fixture/bridge-step", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mailbox }),
        });
      }, mailbox);
      await page
        .getByRole("button", { name: /订阅状态$/ })
        .first()
        .click();
      await expect(page.getByRole("status")).toHaveText("监听中");
      await page.screenshot({
        path: `.impeccable/review/plugin-only-triggers/status-${width}-${theme}.png`,
      });
      await expect(page.getByLabel("事件接收地址")).toHaveCount(0);
      await page.keyboard.press("Escape");
      await page.getByRole("tab", { name: "运行记录", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "已完成", exact: true }).first(),
      ).toBeVisible({ timeout: 20000 });
    });
