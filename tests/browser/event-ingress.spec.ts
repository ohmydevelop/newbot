import { test, expect } from "@playwright/test";
for (const width of [390, 1280])
  for (const theme of ["light", "dark"] as const)
    test(`直接接收事件 ${width} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({
        colorScheme: theme,
        reducedMotion: theme === "dark" ? "reduce" : "no-preference",
      });
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
        .fill(`直接接收 ${width} ${theme}`);
      await editor
        .getByLabel("任务指令", { exact: true })
        .fill("汇总收到的构建结果");
      await editor
        .getByRole("button", { name: "添加触发器", exact: true })
        .click();
      await page.getByRole("button", { name: "接收事件", exact: true }).click();
      await editor
        .getByRole("button", { name: "接收事件条件", exact: true })
        .click();
      await page
        .getByLabel("接收事件类型", { exact: true })
        .fill("build.completed");
      await page.keyboard.press("Escape");
      await expect(
        editor.getByRole("button", { name: "接收事件条件", exact: true }),
      ).toBeFocused();
      await editor.getByRole("button", { name: "保存", exact: true }).click();
      await expect(editor).not.toBeVisible();
      const button = page.getByRole("button", {
        name: "接收配置",
        exact: true,
      });
      await button.click();
      await expect(page.getByLabel("接收地址", { exact: true })).toHaveValue(
        /\/api\/events\/incoming\//,
      );
      const address = await page
        .getByLabel("接收地址", { exact: true })
        .inputValue();
      const token = await page
        .getByLabel("访问凭证", { exact: true })
        .inputValue();
      expect(token).toHaveLength(43);
      const panel = page.locator(".automation-event-settings");
      const geometry = await panel.evaluate(async (el) => {
        await Promise.all(
          el
            .getAnimations({ subtree: true })
            .map((a) => a.finished.catch(() => {})),
        );
        const r = el.getBoundingClientRect();
        return {
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
          overflow: el.scrollWidth > el.clientWidth,
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.top).toBeGreaterThanOrEqual(0);
      expect(geometry.bottom).toBeLessThanOrEqual(844);
      expect(geometry.overflow).toBe(false);
      await page.screenshot({
        path: info.outputPath("incoming-connection.png"),
      });
      await page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.getByRole("button", { name: "复制地址", exact: true }).click();
      await expect(page.getByRole("status")).toHaveText("地址已复制");
      const result = await page.request.post(address, {
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/cloudevents+json",
        },
        data: {
          specversion: "1.0",
          id: `ui-${width}-${theme}`,
          source: "urn:newbot:browser-test",
          type: "build.completed",
          time: new Date().toISOString(),
          data: { conclusion: "success" },
        },
      });
      expect(result.status()).toBe(202);
      await page.getByRole("button", { name: "更换凭证", exact: true }).click();
      await expect(
        page.getByLabel("访问凭证", { exact: true }),
      ).not.toHaveValue(token);
      await page.keyboard.press("Escape");
      await expect(button).toBeFocused();
      await expect(page.getByLabel("访问凭证", { exact: true })).toHaveCount(0);
      await button.click();
      await expect(
        page.getByLabel("访问凭证", { exact: true }),
      ).not.toHaveValue(token);
      await page.keyboard.press("Escape");
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
    });
