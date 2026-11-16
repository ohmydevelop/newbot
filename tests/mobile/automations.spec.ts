import { test, expect } from "@playwright/test";
import { swipe } from "./touch-helpers";
for (const reducedMotion of ["reduce", "no-preference"] as const)
  test(`自动任务触摸滚动与固定操作 ${reducedMotion}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width: 390, height: 740 });
    await page.emulateMedia({ reducedMotion });
    await page.goto("/");
    await page.getByLabel("登录密码").fill("issue-fixture-login");
    await page.getByRole("button", { name: "继续", exact: true }).tap();
    await page.getByRole("button", { name: "展开侧栏", exact: true }).tap();
    await page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("button", { name: /^自动任务/ })
      .tap();
    await page.getByRole("button", { name: "新建任务", exact: true }).tap();
    const modal = page.getByRole("region", {
        name: "新建自动任务",
        exact: true,
      }),
      body = modal.locator(".automation-editor-body");
    for (let i = 0; i < 6; i++) {
      await modal
        .getByRole("button", { name: "添加触发器", exact: true })
        .tap();
      await page
        .getByRole("button", { name: i < 3 ? "每周" : "GitHub", exact: true })
        .tap();
    }
    const cdp = await context.newCDPSession(page);
    await swipe(cdp, 200, 560, 0, -350);
    await expect
      .poll(() => body.evaluate((e) => e.scrollTop))
      .toBeGreaterThan(100);
    await expect(
      modal.getByRole("button", { name: "保存", exact: true }),
    ).toBeInViewport();
    await expect(
      modal.getByRole("button", { name: "关闭", exact: true }),
    ).toBeInViewport();
    await modal.getByRole("button", { name: "事件条件 3", exact: true }).tap();
    await page
      .getByLabel("仓库 owner/repo", { exact: true })
      .fill("example/repository");
    await expect(page.getByText("事件动作", { exact: true })).toBeInViewport();
    await info.attach("automation-event-touch", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.keyboard.press("Escape");
    await expect(
      modal.getByRole("button", { name: "事件条件 3", exact: true }),
    ).toBeFocused();
    await body.evaluate((e) => (e.scrollTop = e.scrollHeight));
    await page.getByRole("button", { name: "任务通知", exact: true }).tap();
    await page.getByRole("button", { name: "邮件", exact: true }).tap();
    await expect(
      modal.getByRole("button", { name: "配置邮件", exact: true }),
    ).toBeVisible();
    const before = await body.evaluate((e) => e.scrollTop);
    await swipe(cdp, 200, 250, 0, 300);
    await expect
      .poll(() => body.evaluate((e) => e.scrollTop))
      .toBeLessThan(before);
    await info.attach("automation-touch", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await body.evaluate(
      (element) =>
        new Promise<void>((resolve, reject) => {
          let previous = element.scrollTop;
          let stableSince = performance.now();
          const started = stableSince;
          const sample = () => {
            const now = performance.now();
            if (element.scrollTop !== previous) stableSince = now;
            previous = element.scrollTop;
            if (now - stableSince >= 160) return resolve();
            if (now - started > 4000)
              return reject(new Error("Touch scrolling did not settle"));
            requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }),
    );
    await modal.getByRole("button", { name: "关闭", exact: true }).tap();
    await expect(
      page.getByRole("button", { name: "新建任务", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(390);
  });
