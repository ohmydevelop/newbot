import { test, expect } from "@playwright/test";
for (const width of [320, 390, 1280])
  for (const theme of ["light", "dark"] as const)
    test(`无插件时只显示平台时间触发器 ${width} ${theme}`, async ({
      page,
    }, info) => {
      test.setTimeout(60000);
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
      await page.route("**/api/automations/sources", (route) =>
        route.fulfill({ json: { providers: [], accounts: [] } }),
      );
      if (width < 760)
        await page
          .getByRole("button", { name: "展开侧栏", exact: true })
          .click();
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name: /^自动任务/ })
        .click();
      await page.getByRole("button", { name: "新建任务", exact: true }).click();
      const draft = page.getByRole("region", {
        name: "新建自动任务",
        exact: true,
      });
      await draft
        .getByRole("button", { name: "添加触发器", exact: true })
        .click();
      for (const name of ["GitHub", "OpenClaw", "Hermes", "Webhook"])
        await expect(
          page.getByRole("button", { name, exact: true }),
        ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "每天", exact: true }),
      ).toBeVisible();
      const motion = await page
        .locator(".picker-panel")
        .evaluate(async (el) => {
          const animations = el.getAnimations({ subtree: true });
          const durations = animations.map((a) =>
            Number(a.effect?.getTiming().duration || 0),
          );
          await Promise.all(animations.map((a) => a.finished.catch(() => {})));
          const a = el.getBoundingClientRect();
          await new Promise(requestAnimationFrame);
          const b = el.getBoundingClientRect();
          return {
            durations,
            shift: Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
            opacity: getComputedStyle(el).opacity,
          };
        });
      expect(motion.shift).toBeLessThan(1);
      expect(motion.opacity).toBe("1");
      expect(
        motion.durations.every(
          (duration) => duration <= (theme === "dark" ? 0 : 200),
        ),
      ).toBe(true);
      await info.attach("motion", {
        body: JSON.stringify({ theme, ...motion }),
        contentType: "application/json",
      });
      await page.screenshot({
        path: info.outputPath("plugin-only-trigger-menu.png"),
      });
      await page.keyboard.press("Escape");
      await expect(
        draft.getByRole("button", { name: "添加触发器", exact: true }),
      ).toBeFocused();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth),
      ).toBe(width);
      await draft.getByRole("button", { name: "取消", exact: true }).click();
    });
