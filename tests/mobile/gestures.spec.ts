import { test, expect } from "@playwright/test";
import { login, settings, chain, swipe } from "./touch-helpers";
for (const width of [320, 390])
  test(`真实触摸事件：专家内外滚动交接 ${width}`, async ({
    page,
    context,
  }, info) => {
    await page.setViewportSize({ width, height: 720 });
    await settings(page, "专家");
    await page.getByRole("button", { name: "添加专家", exact: true }).tap();
    const cdp = await context.newCDPSession(page);
    await chain(
      page,
      cdp,
      page.locator(".expert-member-picker"),
      page.locator(".plugin-center-content"),
    );
    await info.attach("expert-touch", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.getByRole("button", { name: "返回", exact: true }).tap();
    await page.getByRole("button", { name: "关闭", exact: true }).tap();
    await page.getByRole("textbox", { name: "消息", exact: true }).tap();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeFocused();
    expect(await page.locator(".modal-scrim").count()).toBe(0);
  });
for (const reduced of [false, true])
  test(`手机抽屉动画及关闭后触摸恢复 ${reduced}`, async ({
    page,
    context,
  }, info) => {
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await login(page);
    await page.evaluate(() => {
      (window as any).motion = [];
      const start = performance.now();
      function sample(t: number) {
        const node = document.querySelector(".sidebar");
        if (node) {
          const r = node.getBoundingClientRect();
          (window as any).motion.push({ t: t - start, x: r.x, width: r.width });
        }
        if (performance.now() - start < 1100) requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
    await page.getByRole("button", { name: "展开侧栏", exact: true }).tap();
    await expect(
      page.getByRole("dialog", { name: "对话导航", exact: true }),
    ).toBeVisible();
    await page.waitForTimeout(600);
    const frames = await page.evaluate(
      () => (window as any).motion as { t: number; x: number; width: number }[],
    );
    expect(frames.length).toBeGreaterThan(5);
    expect(Math.abs(frames.at(-1)!.x)).toBeLessThan(1);
    const middle = frames.filter((f) => f.x < -1 && f.x > -f.width + 1);
    if (reduced) expect(middle).toHaveLength(0);
    else expect(middle.length).toBeGreaterThan(2);
    await info.attach("drawer-frames", {
      body: JSON.stringify({ reduced, frames }),
      contentType: "application/json",
    });
    await page.touchscreen.tap(page.viewportSize()!.width - 15, 400);
    await expect(
      page.getByRole("dialog", { name: "对话导航", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("textbox", { name: "消息", exact: true }).tap();
    await expect(
      page.getByRole("textbox", { name: "消息", exact: true }),
    ).toBeFocused();
  });
test("触摸分类横滑不改变分类，竖向目录仍可滚动", async ({
  page,
  context,
}, info) => {
  await settings(page, "连接器");
  const nav = page.getByRole("navigation", { name: "设置分类" }),
    cdp = await context.newCDPSession(page),
    r = (await nav.boundingBox())!;
  await swipe(cdp, 300, r.y + r.height / 2, -230, 0);
  await expect
    .poll(() => nav.evaluate((e) => e.scrollLeft))
    .toBeGreaterThan(100);
  await expect(
    page.getByRole("button", { name: "连接器", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const outer = page.locator(".plugin-center-content");
  await swipe(cdp, 195, 620, 0, -300);
  await expect
    .poll(() => outer.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(100);
  await info.attach("horizontal-and-vertical", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
test("平板触控调整宽度、取消释放与下一次操作", async ({
  page,
  context,
}, info) => {
  await page.setViewportSize({ width: 1100, height: 844 });
  await login(page);
  const cdp = await context.newCDPSession(page),
    handle = page.getByRole("separator", { name: "调整左侧栏宽度" });
  let r = (await handle.boundingBox())!;
  await swipe(cdp, r.x + r.width / 2, 300, 100, 0, true);
  await expect(page.locator(".panel-drag-shield")).toHaveCount(0);
  const width = Number(await handle.getAttribute("aria-valuenow"));
  expect(width).toBeGreaterThan(300);
  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", String(width));
  await page.getByRole("button", { name: "设置", exact: true }).tap();
  await expect(
    page.getByRole("button", { name: "连接器", exact: true }),
  ).toBeVisible();
  await info.attach("tablet-cancel", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});
test("触摸工作流程边缘交接聊天且默认折叠", async ({ page, context }, info) => {
  await login(page);
  const send = async (text: string) => {
    const count = await page
      .getByText("测试回复完成。", { exact: true })
      .count();
    await page.getByRole("textbox", { name: "消息", exact: true }).fill(text);
    await page.getByRole("button", { name: "发送消息", exact: true }).tap();
    await expect(page.getByText("测试回复完成。", { exact: true })).toHaveCount(
      count + 1,
    );
  };
  await send(
    Array.from({ length: 45 }, (_, i) => `前文${i}滚动验收`).join("\n"),
  );
  await page.getByRole("button", { name: "展开侧栏", exact: true }).tap();
  const threadId = await page
    .locator(".history-row.selected")
    .getAttribute("data-thread-id");
  await page.touchscreen.tap(375, 400);
  const response = await page.request.post("/api/test/process", {
    data: { threadId, count: 36 },
    headers: { Origin: "http://127.0.0.1:3169" },
  });
  expect(response.ok()).toBe(true);
  await send(
    Array.from({ length: 25 }, (_, i) => `后文${i}继续阅读`).join("\n"),
  );
  const toggle = page.getByRole("button", {
    name: "后续过程 · 36 项",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.tap();
  const inner = page.getByRole("region", { name: "执行过程详情" }).last();
  await chain(
    page,
    await context.newCDPSession(page),
    inner,
    page.locator(".conversation"),
  );
  await info.attach("process-touch", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
});

test("插件内技能可阅读源码并返回，读取页不混入管理操作", async ({
  page,
}, info) => {
  await settings(page, "连接器");
  await page.getByRole("button", { name: "查看 测试插件", exact: true }).tap();
  await page
    .getByRole("region", { name: "插件技能" })
    .locator(".catalog-entry-main")
    .first()
    .tap();
  await expect(
    page.locator(".skill-reader .skill-document-body"),
  ).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".skill-reader .inline-error")).toHaveCount(0);
  await page.getByRole("button", { name: "源码", exact: true }).tap();
  await expect(page.locator(".skill-reader pre")).toBeVisible();
  await expect(
    page
      .locator(".skill-reader")
      .getByRole("button", { name: /卸载|停用|启用|在聊天中使用/ }),
  ).toHaveCount(0);
  await info.attach("plugin-skill-source", {
    body: await page.screenshot(),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "返回", exact: true }).tap();
  await expect(page.getByRole("region", { name: "插件技能" })).toBeVisible();
});
