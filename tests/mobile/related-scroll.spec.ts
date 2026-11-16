import { test, expect } from "@playwright/test";
import { settings, chain, swipe } from "./touch-helpers";
test("技能导入预览触摸两端交接，不执行安装", async ({
  page,
  context,
}, info) => {
  const preview = {
    id: "00000000-0000-4000-8000-000000000015",
    source: { kind: "files", name: "触摸预览夹具" },
    state: "ready",
    bytes: 1000,
    files: 24,
    created: 1,
    retained: true,
    entries: [
      {
        id: "fixture",
        kind: "skills",
        name: "触摸预览夹具",
        root: ".",
        description: "",
        digest: "fixture",
        state: "available",
        mcp: [],
        hooks: [],
        skills: Array.from({ length: 24 }, (_, i) => ({
          id: `skill-${i}`,
          name: `技能 ${i}`,
          description: "滚动边界验证",
          path: `skill-${i}/SKILL.md`,
        })),
      },
    ],
  };
  await page.route("**/api/imports**", (route) =>
    route.fulfill({
      json:
        new URL(route.request().url()).pathname === "/api/imports"
          ? [preview]
          : preview,
    }),
  );
  await page.setViewportSize({ width: 390, height: 640 });
  await settings(page, "技能");
  await page.getByRole("button", { name: "添加技能", exact: true }).tap();
  await page.getByRole("menuitem", { name: "导入技能", exact: true }).tap();
  await page
    .getByRole("button", { name: "触摸预览夹具 继续导入", exact: true })
    .tap();
  await chain(
    page,
    await context.newCDPSession(page),
    page.locator(".import-skills"),
    page.locator(".plugin-center-content"),
  );
  await info.attach("import-touch", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "返回", exact: true }).tap();
  await expect(page.getByRole("searchbox", { name: "搜索技能" })).toBeVisible();
});
test("插件长工具目录触摸主滚动与返回", async ({ page, context }, info) => {
  await settings(page, "连接器");
  await page.getByRole("button", { name: "查看 测试插件", exact: true }).tap();
  await expect(
    page.getByRole("heading", { name: "测试插件", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "查看 test-server", exact: true })
    .tap();
  await expect(page.locator(".connection-tool")).toHaveCount(125);
  const outer = page.locator(".plugin-center-content"),
    cdp = await context.newCDPSession(page);
  await swipe(cdp, 195, 650, 0, -400);
  await expect
    .poll(() => outer.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(200);
  const before = await outer.evaluate((e) => e.scrollTop);
  await swipe(cdp, 195, 250, 0, 300);
  await expect
    .poll(() => outer.evaluate((e) => e.scrollTop))
    .toBeLessThan(before - 100);
  await info.attach("plugin-tools-touch", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "返回", exact: true }).tap();
  await expect(
    page.getByRole("heading", { name: "测试插件", exact: true }),
  ).toBeVisible();
});
