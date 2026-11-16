import { test, expect, type Page } from "@playwright/test";
async function geometry(page: Page) {
  const boxes = await page
    .locator(".automation-capabilities button")
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }),
    );
  expect(boxes).toHaveLength(5);
  for (const box of boxes) {
    expect(box.height).toBe(36);
    expect(box.y + box.height / 2).toBeCloseTo(
      boxes[0].y + boxes[0].height / 2,
      0,
    );
    expect(box.width).toBeGreaterThanOrEqual(36);
  }
  for (let i = 1; i < boxes.length; i++)
    expect(boxes[i].x).toBeGreaterThanOrEqual(
      boxes[i - 1].x + boxes[i - 1].width,
    );
  const prompt = (await page.locator(".automation-prompt").boundingBox())!;
  expect(boxes[4].x + boxes[4].width).toBeLessThanOrEqual(
    prompt.x + prompt.width,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    page.viewportSize()!.width,
  );
}
for (const width of [320, 390, 768, 1280])
  for (const theme of ["light", "dark"] as const) {
    test(`自定义任务工具栏同高与长名称 ${width} ${theme}`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme });
      const model = "用于验收的超长模型名称与版本标识";
      await page.route("**/api/agent/action", async (route) => {
        if (route.request().postDataJSON()?.action === "gateway/catalog")
          return route.fulfill({
            json: [
              {
                id: "fixture",
                name: "测试连接",
                models: [{ model: "fixture-long-model", displayName: model }],
              },
            ],
          });
        return route.continue();
      });
      await page.goto("/");
      await page.getByLabel("登录密码").fill("issue-fixture-login");
      await page.getByRole("button", { name: "继续", exact: true }).click();
      if (width < 760)
        await page
          .getByRole("button", { name: "展开侧栏", exact: true })
          .click();
      await page
        .getByRole("navigation", { name: "主导航" })
        .getByRole("button", { name: /^自动任务/ })
        .click();
      await page.getByRole("button", { name: "新建任务", exact: true }).click();
      await geometry(page);
      const modelButton = page.getByRole("button", {
        name: "任务模型",
        exact: true,
      });
      await modelButton.click();
      await page
        .getByRole("button", { name: `${model} · 测试连接`, exact: true })
        .click();
      await expect(modelButton).toHaveAttribute("title", `${model} · 测试连接`);
      await page
        .getByRole("button", { name: "交互模式：聊天", exact: true })
        .click();
      await page
        .getByRole("menuitemradio", { name: "工作", exact: true })
        .click();
      await geometry(page);
      for (const kind of ["连接器", "技能"]) {
        const trigger = page.getByRole("button", {
          name: new RegExp(`^${kind}( [0-9]+)?$`),
        });
        await trigger.click();
        const popup = page.getByRole("dialog", {
          name: kind === "技能" ? "选择技能" : "选择专家或插件",
          exact: true,
        });
        await expect(popup).toBeVisible();
        const option = popup.getByRole("option").first();
        await expect(option).toBeVisible();
        await option.click();
        await expect(option).toHaveAttribute("aria-selected", "true");
        await page.keyboard.press("Escape");
        await expect(trigger).toBeFocused();
      }
      await geometry(page);
      await info.attach("toolbar", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    });
  }
