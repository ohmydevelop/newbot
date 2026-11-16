import {
  expect,
  type Page,
  type CDPSession,
  type Locator,
} from "@playwright/test";
export async function login(page: Page) {
  await page.goto("/?profile=1");
  await page.getByLabel("登录密码").fill("issue-fixture-login");
  await page.getByRole("button", { name: "继续", exact: true }).tap();
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
}
export async function settings(page: Page, section: string) {
  await login(page);
  await page.getByRole("button", { name: "展开侧栏", exact: true }).tap();
  await page.getByRole("button", { name: "设置", exact: true }).tap();
  await page.getByRole("button", { name: section, exact: true }).tap();
  await page.getByRole("searchbox", { name: `搜索${section}` }).waitFor();
}
export async function swipe(
  cdp: CDPSession,
  x: number,
  y: number,
  dx: number,
  dy: number,
  cancel = false,
) {
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ id: 0, x, y }],
  });
  for (let i = 1; i <= 16; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ id: 0, x: x + (dx * i) / 16, y: y + (dy * i) / 16 }],
    });
    await new Promise((r) => setTimeout(r, 16));
  }
  await cdp.send("Input.dispatchTouchEvent", {
    type: cancel ? "touchCancel" : "touchEnd",
    touchPoints: [],
  });
}
export async function center(locator: Locator, page: Page) {
  const r = (await locator.boundingBox())!,
    h = page.viewportSize()!.height;
  return {
    x: r.x + r.width / 2,
    y: (Math.max(r.y, 150) + Math.min(r.y + r.height, h - 30)) / 2,
  };
}
export async function paint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
export async function chain(
  page: Page,
  cdp: CDPSession,
  inner: Locator,
  outer: Locator,
) {
  await inner.scrollIntoViewIfNeeded();
  const max = await inner.evaluate((e) => e.scrollHeight - e.clientHeight);
  expect(max).toBeGreaterThan(100);
  await inner.evaluate(
    (e) => (e.scrollTop = Math.min(150, (e.scrollHeight - e.clientHeight) / 2)),
  );
  await paint(page);
  let p = await center(inner, page),
    before = await outer.evaluate((e) => e.scrollTop),
    mid = await inner.evaluate((e) => e.scrollTop);
  await swipe(cdp, p.x, p.y + 60, 0, -120);
  await expect
    .poll(() => inner.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(mid + 30);
  expect(await outer.evaluate((e) => e.scrollTop)).toBeCloseTo(before, 0);
  for (
    let n = 0;
    n < 25 && (await inner.evaluate((e) => e.scrollTop)) > 1;
    n++
  ) {
    await page.waitForTimeout(180);
    p = await center(inner, page);
    await swipe(cdp, p.x, p.y - 60, 0, 120);
  }
  await expect
    .poll(() => inner.evaluate((e) => e.scrollTop))
    .toBeLessThanOrEqual(1);
  before = await outer.evaluate((e) => e.scrollTop);
  expect(before).toBeGreaterThan(10);
  p = await center(inner, page);
  await swipe(cdp, p.x, p.y - 60, 0, 120);
  await expect
    .poll(() => outer.evaluate((e) => e.scrollTop))
    .toBeLessThan(before - 10);
  await inner.scrollIntoViewIfNeeded();
  for (
    let n = 0;
    n < 35 &&
    (await inner.evaluate(
      (e) => e.scrollHeight - e.clientHeight - e.scrollTop,
    )) > 1;
    n++
  ) {
    await page.waitForTimeout(180);
    p = await center(inner, page);
    await swipe(cdp, p.x, p.y + 60, 0, -120);
  }
  await expect
    .poll(() =>
      inner.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop),
    )
    .toBeLessThanOrEqual(1);
  before = await outer.evaluate((e) => e.scrollTop);
  expect(
    await outer.evaluate((e) => e.scrollHeight - e.clientHeight - e.scrollTop),
  ).toBeGreaterThan(10);
  p = await center(inner, page);
  await swipe(cdp, p.x, p.y + 60, 0, -120);
  await expect
    .poll(() => outer.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(before + 10);
}
