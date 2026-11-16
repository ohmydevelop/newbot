import { test, expect } from "@playwright/test";
for (const width of [320, 390, 1280])
  for (const theme of ["light", "dark"] as const)
    test(`事件触发配置与持续会话入口 ${width} ${theme}`, async ({
      page,
    }, info) => {
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
      const name = `事件验收 ${width} ${theme}`;
      await editor.getByLabel("任务名称", { exact: true }).fill(name);
      await editor
        .getByLabel("任务指令", { exact: true })
        .fill("汇总收到的事件");
      await editor
        .getByRole("button", { name: "添加触发器", exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "搜索添加触发器", exact: true })
        .fill("GitHub");
      await page.getByRole("button", { name: "GitHub", exact: true }).click();
      await editor
        .getByRole("button", { name: "事件条件 1", exact: true })
        .click();
      await page
        .getByLabel("仓库 owner/repo", { exact: true })
        .fill("example/long-repository-name-for-responsive-check");
      await page
        .getByLabel("事件类型，逗号分隔", { exact: true })
        .fill("issues, pull_request");
      await page
        .getByLabel("事件动作，逗号分隔", { exact: true })
        .fill("opened, reopened");
      await page.screenshot({ path: info.outputPath("event-conditions.png") });
      await page.keyboard.press("Escape");
      await editor
        .getByRole("button", { name: "添加触发器", exact: true })
        .click();
      await page.getByRole("button", { name: "Hermes", exact: true }).click();
      await editor
        .getByRole("button", { name: "添加触发器", exact: true })
        .click();
      await page.getByRole("button", { name: "OpenClaw", exact: true }).click();
      await editor
        .getByRole("button", { name: "移除事件触发器 3", exact: true })
        .click();
      await page.screenshot({ path: info.outputPath("event-editor.png") });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect(editor).not.toBeVisible();
      await expect(
        page.getByRole("heading", { name, exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("等待事件触发", { exact: true }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "GitHub 连接设置", exact: true })
        .click();
      const secret = page.getByLabel("事件密钥", { exact: true });
      await expect(secret).not.toHaveValue("");
      await expect(secret).toHaveAttribute("type", "password");
      await expect(
        page.getByLabel("事件接收地址", { exact: true }),
      ).toHaveValue(/\/api\/automation-hooks\//);
      await page.screenshot({ path: info.outputPath("event-connection.png") });
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "GitHub 连接设置", exact: true }),
      ).toBeFocused();
      await page.getByRole("button", { name: "立即运行", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "已完成", exact: true }),
      ).toBeVisible({ timeout: 25000 });
      await page.getByRole("tab", { name: "概览", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "任务会话", exact: true }),
      ).toBeVisible();
      const geometry = await page
        .locator(".automation-detail-actions")
        .evaluate((el) => {
          const status = el.querySelector("span")!;
          const buttons = [...el.querySelectorAll("button")].map((button) =>
            button.getBoundingClientRect(),
          );
          return {
            statusHeight: status.getBoundingClientRect().height,
            heights: buttons.map((r) => r.height),
            centers: buttons.map((r) => r.y + r.height / 2),
          };
        });
      expect(geometry.statusHeight).toBeLessThan(25);
      expect(
        Math.max(...geometry.heights) - Math.min(...geometry.heights),
      ).toBeLessThan(1);
      expect(
        Math.max(...geometry.centers) - Math.min(...geometry.centers),
      ).toBeLessThan(1);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      await page.screenshot({ path: info.outputPath("event-after-run.png") });
      await page.getByRole("button", { name: "任务会话", exact: true }).click();
      await expect(
        page.getByRole("textbox", { name: "消息", exact: true }),
      ).toBeVisible();
    });
