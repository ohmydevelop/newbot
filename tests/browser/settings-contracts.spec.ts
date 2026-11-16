import { test, expect, type Page } from "@playwright/test";
import { assertToolbar, assertCatalogReturn } from "../../scripts/ui-contracts";
async function login(page: Page) {
  await page.goto("/?profile=1");
  await page.getByLabel("登录密码").fill("issue-fixture-login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  if ((page.viewportSize()?.width || 1280) <= 760)
    await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "连接器", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索连接器" }).waitFor();
}
async function catalogState(page: Page) {
  return page.evaluate(() => ({
    query: document.querySelector<HTMLInputElement>(".settings-toolbar input")!
      .value,
    filter:
      document.querySelector('[aria-label="插件商店"]')!.textContent || "",
    scroll: document.querySelector(".plugin-center-content")!.scrollTop,
  }));
}
test("分类真正卸载、关闭重开和详情返回保留目录状态", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.getByRole("searchbox", { name: "搜索连接器" }).fill("测试扩展");
  await page
    .getByRole("button", { name: "查看 测试扩展 3", exact: true })
    .waitFor();
  await page.locator(".plugin-center-content").evaluate((element) => {
    element.scrollTop = 150;
  });
  await expect.poll(async () => (await catalogState(page)).scroll).toBe(150);
  const before = await catalogState(page);
  await page.getByRole("button", { name: "技能", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索技能" }).waitFor();
  await page.getByRole("button", { name: "连接器", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索连接器" }).waitFor();
  await expect
    .poll(async () => (await catalogState(page)).scroll)
    .toBe(before.scroll);
  assertCatalogReturn(before, await catalogState(page));
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "连接器", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索连接器" }).waitFor();
  await expect
    .poll(async () => (await catalogState(page)).scroll)
    .toBe(before.scroll);
  assertCatalogReturn(before, await catalogState(page));
  const entry = page.getByRole("button", {
    name: "查看 测试扩展 3",
    exact: true,
  });
  await entry.click();
  await page.getByRole("button", { name: "返回", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await expect(entry).toBeFocused();
  await expect
    .poll(async () => (await catalogState(page)).scroll)
    .toBe(before.scroll);
  assertCatalogReturn(before, await catalogState(page));
});
for (const width of [1440, 1280, 768, 390, 320])
  for (const theme of ["light", "dark"]) {
    test(`设置布局 ${width} ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await login(page);
      await page.getByRole("button", { name: "外观", exact: true }).click();
      await page
        .getByRole("button", {
          name: theme === "light" ? "浅色" : "深色",
          exact: true,
        })
        .click();
      for (const section of ["连接器", "技能", "模型", "专家"]) {
        await page.getByRole("button", { name: section, exact: true }).click();
        await page.getByRole("searchbox", { name: `搜索${section}` }).waitFor();
        await expect(
          page.getByRole("button", {
            name: /^刷新(连接器|插件|技能|专家|模型)$/,
          }),
        ).toBeEnabled();
        const rectangles = await page
          .locator(
            `.settings-dialog > .modal-header ${width > 700 ? ".icon-button," : ".catalog-toolbar .icon-button,"} .settings-toolbar .catalog-query, .settings-toolbar .catalog-add`,
          )
          .evaluateAll((elements) =>
            elements.map((e) => {
              const r = e.getBoundingClientRect();
              return {
                label: e.getAttribute("aria-label") || e.textContent || "",
                width: r.width,
                height: r.height,
                y: r.y,
              };
            }),
          );
        assertToolbar(rectangles, width <= 700);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await expect(
          page.locator(".extension-tabs,.sidebar-plugins"),
        ).toHaveCount(0);
        await info.attach(`${width}-${theme}-${section}`, {
          body: await page.screenshot({ animations: "disabled" }),
          contentType: "image/png",
        });
        if (section === "专家") {
          await page.getByText("尚未创建专家", { exact: true }).waitFor();
          await page
            .locator(".settings-layout > nav > .selected")
            .evaluate((e) =>
              e.scrollIntoView({ block: "nearest", inline: "center" }),
            );
          const rect = (await page.locator(".settings-dialog").boundingBox())!;
          await page.mouse.move(0, 0);
          await expect(
            await page.screenshot({
              animations: "disabled",
              clip: { ...rect, height: Math.floor(rect.height) },
              path: info.outputPath(`${width}-${theme}-review.png`),
            }),
          ).toMatchSnapshot(`${width}-${theme}-experts.png`, {
            maxDiffPixelRatio: 0.005,
          });
        }
      }
    });
  }
test("标题栏偏移与查询丢失注入会被同一验收器拒绝", async ({ page }) => {
  await login(page);
  await page.addStyleTag({
    content:
      ".settings-dialog > .modal-header > .icon-button { transform: translateY(5px) !important; }",
  });
  const rectangles = await page
    .locator(
      ".settings-dialog > .modal-header .icon-button, .settings-toolbar .catalog-query",
    )
    .evaluateAll((elements) =>
      elements.map((e) => {
        const r = e.getBoundingClientRect();
        return {
          label: e.getAttribute("aria-label") || "",
          width: r.width,
          height: r.height,
          y: r.y,
        };
      }),
    );
  expect(() => assertToolbar(rectangles)).toThrow(/中心差/);
  await page.getByRole("searchbox", { name: "搜索连接器" }).fill("cloudwalker");
  const before = await catalogState(page);
  await page.getByRole("searchbox", { name: "搜索连接器" }).fill("");
  expect(() => assertCatalogReturn(before, { ...before, query: "" })).toThrow(
    /搜索条件/,
  );
});
test("左栏键盘/拖拽与刷新持久化，折叠保留设置入口", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const handle = page.getByRole("separator", { name: "调整左侧栏宽度" });
  await handle.press("Home");
  await expect(handle).toHaveAttribute("aria-valuenow", "220");
  await handle.press("ArrowRight");
  await expect(handle).toHaveAttribute("aria-valuenow", "230");
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 200, { steps: 8 });
  await page.mouse.up();
  const width = await handle.getAttribute("aria-valuenow");
  await expect(page.locator(".panel-drag-shield")).toHaveCount(0);
  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", width!);
  await page.getByRole("button", { name: "收起侧栏", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "设置", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "插件", exact: true }),
  ).toHaveCount(0);
});
for (const reduced of [false, true])
  test(`正常/减弱动画 ${reduced}`, async ({ page }) => {
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await login(page);
    await page
      .getByRole("button", { name: "查看 测试插件", exact: true })
      .click();
    await page.getByRole("button", { name: "返回", exact: true }).waitFor();
    const duration = await page
      .locator(".catalog-step")
      .evaluate((e) => getComputedStyle(e).animationDuration);
    expect(duration).toBe(reduced ? "0s" : "0.18s");
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    const navDuration = await page
      .locator(".navigation-slot")
      .evaluate((e) => getComputedStyle(e).transitionDuration);
    expect(navDuration).toBe(reduced ? "0s" : "0.3s");
  });
test("桌面设置缩为手机时右栏不能抢焦点", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page
    .getByRole("textbox", { name: "消息", exact: true })
    .fill("UI12 responsive fixture");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByLabel("打开右侧栏", { exact: true }).click();
  await page.getByRole("separator", { name: "调整右侧栏宽度" }).waitFor();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("searchbox", { name: "搜索连接器" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".settings-dialog")).toBeVisible();
  await expect(page.locator(".rail-overlay")).toHaveCount(0);
  await page.getByRole("searchbox", { name: "搜索连接器" }).fill("测试");
  await expect(page.getByRole("searchbox", { name: "搜索连接器" })).toHaveValue(
    "测试",
  );
});
