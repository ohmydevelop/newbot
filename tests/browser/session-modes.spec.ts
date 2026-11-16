import { test, expect } from "@playwright/test";
for (const width of [320, 390, 1280])
  for (const theme of ["light", "dark"]) {
    test(`交互模式保持紧凑布局和焦点 ${width} ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme as "light" | "dark" });
      await page.goto("/?profile=1");
      await page.getByLabel("登录密码").fill("issue-fixture-login");
      await page.getByRole("button", { name: "继续", exact: true }).click();
      const input = page.getByRole("textbox", { name: "消息", exact: true });
      await input.waitFor();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const trigger = page.getByRole("button", {
        name: "交互模式：聊天",
        exact: true,
      });
      await expect(trigger).toBeVisible();
      await expect(trigger.locator("span")).toBeVisible();
      expect(await trigger.getAttribute("title")).toContain("只读");
      await trigger.click();
      await expect(
        page.getByRole("menuitemradio", { name: "聊天", exact: true }),
      ).toHaveAttribute("aria-checked", "true");
      await expect(page.getByRole("menu")).toHaveCSS("opacity", "1");
      await page.screenshot({ path: info.outputPath("mode-menu.png") });
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page
        .getByRole("menuitemradio", { name: "规划", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "交互模式：规划", exact: true }),
      ).toBeVisible();
      await input.fill("MODE 浏览器验收");
      await page.getByRole("button", { name: "发送消息", exact: true }).click();
      await expect(
        page.getByText("测试回复完成。", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "交互模式：规划", exact: true }),
      ).toBeVisible();
      await page.reload();
      await input.waitFor();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(
        page.getByRole("button", { name: "交互模式：规划", exact: true }),
      ).toBeVisible();
      const controls = page.locator(".composer-tools");
      const box = await controls.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBeLessThanOrEqual(width);
      await page.screenshot({ path: info.outputPath("mode-saved.png") });
    });
  }
for (const width of [390, 1280])
  test(`只读工具许可保存与刷新 ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/");
    await page.getByLabel("登录密码").fill("issue-fixture-login");
    await page.getByRole("button", { name: "继续", exact: true }).click();
    await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
    if (width < 760)
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "连接器", exact: true }).click();
    await page
      .getByRole("button", { name: "查看 test-server", exact: true })
      .click();
    await page.getByText("聊天与规划可用工具", { exact: true }).click();
    const access = page.locator(".readonly-tools");
    await access.locator("input[type=checkbox]").first().waitFor();
    await page.screenshot({ path: info.outputPath("readonly-picker.png") });
    const first = access.locator("input[type=checkbox]").first();
    await first.check();
    await expect(access.getByRole("status")).toHaveText("已保存，下次任务生效");
    await access
      .getByRole("button", { name: "刷新只读工具", exact: true })
      .click();
    await expect(first).toBeChecked();
    await first.uncheck();
    await expect(access.getByRole("status")).toHaveText("已保存，下次任务生效");
    await access
      .getByRole("button", { name: "刷新只读工具", exact: true })
      .click();
    await expect(first).not.toBeChecked();
    await access
      .getByRole("searchbox", { name: "搜索只读工具" })
      .fill("metrics");
    await expect(access.locator("input[type=checkbox]")).toHaveCount(1);
    await page.route("**/api/agent/action", async (route) => {
      if (route.request().postDataJSON().action === "mode/tools/update")
        await route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({ error: "工具定义已变化，请刷新" }),
        });
      else await route.continue();
    });
    await first.check();
    await expect(access.getByRole("alert")).toContainText("工具定义已变化");
    await expect(first).not.toBeChecked();
    await page.unroute("**/api/agent/action");

    await page.getByRole("button", { name: "返回", exact: true }).click();
    await page.screenshot({ path: info.outputPath("tools-return.png") });
  });
