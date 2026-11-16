import { test, expect, type Page } from "@playwright/test";

async function login(page: Page, settings = false) {
  await page.goto("/?profile=1");
  await page.getByLabel("登录密码").fill("issue-fixture-login");
  await page.getByRole("button", { name: "继续", exact: true }).click();
  await page.getByRole("textbox", { name: "消息", exact: true }).waitFor();
  if (settings) {
    if (page.viewportSize()!.width <= 760)
      await page.getByRole("button", { name: "展开侧栏", exact: true }).click();
    await page.getByRole("button", { name: "设置", exact: true }).click();
  }
}
async function fixture(page: Page, path: string, data: unknown) {
  const response = await page.request.post(path, {
    data,
    headers: { Origin: "http://127.0.0.1:3169" },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function chat(page: Page, message: string) {
  const replies = page.getByText("测试回复完成。", { exact: true });
  const count = await replies.count();
  await page.getByRole("textbox", { name: "消息", exact: true }).fill(message);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(replies).toHaveCount(count + 1);
  await replies.last().waitFor();
}
async function startDrag(page: Page, side: "左" | "右") {
  const handle = page.getByRole("separator", { name: `调整${side}侧栏宽度` });
  await handle.hover();
  const r = (await handle.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, 250);
  await page.mouse.down();
  await expect(page.locator(".panel-drag-shield")).toHaveCount(1);
  return { handle, x: r.x + r.width / 2 };
}

test("左右拖拽跨越不透明 iframe，边界、点击恢复与宽度持久化", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 844 });
  await login(page);
  await chat(page, "UI13 iframe drag");
  await page.getByLabel("打开右侧栏", { exact: true }).click();
  await page.evaluate(() => {
    (window as any).dragFrames = [];
    window.addEventListener("newbot:panel-frame", (e) =>
      (window as any).dragFrames.push((e as CustomEvent).detail),
    );
  });
  for (const side of ["左", "右"] as const) {
    const h = page.getByRole("separator", { name: `调整${side}侧栏宽度` });
    await h.press("Home");
    await expect(h).toHaveAttribute(
      "aria-valuenow",
      side === "左" ? "220" : "260",
    );
    await h.press(side === "左" ? "ArrowRight" : "ArrowLeft");
    await expect(h).toHaveAttribute(
      "aria-valuenow",
      side === "左" ? "230" : "270",
    );
    await page.evaluate((side) => {
      const f = document.createElement("iframe");
      f.id = "drag-fixture";
      f.setAttribute("sandbox", "allow-scripts");
      f.srcdoc = '<input type="checkbox" aria-label="iframe click">';
      f.style.cssText = `position:fixed;top:180px;left:${side === "左" ? 260 : 1000}px;width:160px;height:160px;z-index:100`;
      document.body.append(f);
    }, side);
    await expect(
      page.frameLocator("#drag-fixture").getByRole("checkbox"),
    ).toBeVisible();
    expect(
      await page
        .locator("#drag-fixture")
        .evaluate((f: HTMLIFrameElement) => f.contentDocument),
    ).toBeNull();
    const { x } = await startDrag(page, side);
    await page.mouse.move(x + (side === "左" ? 250 : -250), 250, { steps: 18 });
    await page.mouse.up();
    await expect(page.locator(".panel-drag-shield")).toHaveCount(0);
    await expect(h).toHaveAttribute(
      "aria-valuenow",
      side === "左" ? "400" : "520",
    );
    await page.frameLocator("#drag-fixture").getByRole("checkbox").click();
    await expect(
      page.frameLocator("#drag-fixture").getByRole("checkbox"),
    ).toBeChecked();
    await page.locator("#drag-fixture").evaluate((f) => f.remove());
  }
  const samples = await page.evaluate(
    () => (window as any).dragFrames as number[],
  );
  samples.sort((a, b) => a - b);
  expect(samples.length).toBeGreaterThan(20);
  const p95 = samples[Math.floor(samples.length * 0.95)];
  await info.attach("drag-frames.json", {
    body: JSON.stringify({ samples, p95, budgetMs: 40 }),
    contentType: "application/json",
  });
  expect(p95).toBeLessThanOrEqual(40);
  await page.reload();
  await expect(
    page.getByRole("separator", { name: "调整左侧栏宽度" }),
  ).toHaveAttribute("aria-valuenow", "400");
  await expect(
    page.getByRole("separator", { name: "调整右侧栏宽度" }),
  ).toHaveAttribute("aria-valuenow", "520");
});

test("拖拽只接受所属指针，失去捕获、取消、失焦和卸载均清理", async ({
  page,
}) => {
  await login(page);
  const h = page.getByRole("separator", { name: "调整左侧栏宽度" });
  await h.evaluate((e) =>
    e.addEventListener("pointerdown", (event) =>
      e.setAttribute(
        "data-test-pointer",
        String((event as PointerEvent).pointerId),
      ),
    ),
  );
  await startDrag(page, "左");
  await h.dispatchEvent("pointerup", { pointerId: 999, button: 0 });
  await expect(page.locator(".panel-drag-shield")).toHaveCount(1);
  await page.mouse.move(350, 250, { steps: 4 });
  await h.evaluate((e) =>
    e.releasePointerCapture(Number(e.getAttribute("data-test-pointer"))),
  );
  await page.mouse.move(351, 250);
  await expect(page.locator(".panel-drag-shield")).toHaveCount(0);
  await page.mouse.up();
  for (const boundary of ["pointercancel", "blur", "unmount"]) {
    const { x } = await startDrag(page, "左");
    await page.mouse.move(x - 20, 250, { steps: 3 });
    if (boundary === "pointercancel")
      await h.dispatchEvent("pointercancel", {
        pointerId: Number(await h.getAttribute("data-test-pointer")),
      });
    if (boundary === "blur")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    if (boundary === "unmount")
      await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".panel-drag-shield")).toHaveCount(0);
    await expect(page.locator("html")).not.toHaveAttribute(
      "data-panel-dragging",
      /.+/,
    );
    await page.mouse.up();
  }
});

for (const reduced of [false, true])
  test(`动画真实帧连续且减弱模式即时稳定 ${reduced}`, async ({
    page,
  }, info) => {
    await page.emulateMedia({
      reducedMotion: reduced ? "reduce" : "no-preference",
    });
    await login(page);
    await page.evaluate(() => {
      const frames: { t: number; width: number }[] = [];
      (window as any).navFrames = frames;
      const start = performance.now();
      const read = () => {
        frames.push({
          t: performance.now() - start,
          width: document
            .querySelector(".navigation-slot")!
            .getBoundingClientRect().width,
        });
        if (performance.now() - start < 650) requestAnimationFrame(read);
      };
      requestAnimationFrame(read);
      (
        document.querySelector('[aria-label="收起侧栏"]') as HTMLButtonElement
      ).click();
    });
    await expect
      .poll(() =>
        page
          .locator(".navigation-slot")
          .evaluate((e) => e.getBoundingClientRect().width),
      )
      .toBe(57);
    await page.waitForTimeout(700);
    const frames = await page.evaluate(
      () => (window as any).navFrames as { t: number; width: number }[],
    );
    expect(frames.every((f) => f.width >= 57 && f.width <= 256)).toBe(true);
    for (let i = 1; i < frames.length; i++)
      expect(frames[i].width).toBeLessThanOrEqual(frames[i - 1].width + 0.1);
    if (reduced)
      expect(frames.filter((f) => f.width > 58 && f.width < 255)).toHaveLength(
        0,
      );
    if (!reduced)
      expect(
        frames.filter((f) => f.width > 58 && f.width < 255).length,
      ).toBeGreaterThan(2);
    await info.attach("navigation-frames.json", {
      body: JSON.stringify(frames),
      contentType: "application/json",
    });
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page.getByRole("button", { name: "连接器", exact: true }).click();
    await page
      .getByRole("button", { name: "查看 测试插件", exact: true })
      .waitFor();
    await page.evaluate(() => {
      const frames: { opacity: number; y: number }[] = [];
      (window as any).stepFrames = frames;
      const start = performance.now();
      const read = () => {
        const e = document.querySelector(".catalog-step");
        if (e) {
          const s = getComputedStyle(e);
          frames.push({
            opacity: Number(s.opacity),
            y: s.transform === "none" ? 0 : new DOMMatrix(s.transform).m42,
          });
        }
        if (performance.now() - start < 450) requestAnimationFrame(read);
      };
      requestAnimationFrame(read);
      (
        document.querySelector(
          '[aria-label="查看 测试插件"]',
        ) as HTMLButtonElement
      ).click();
    });
    await page.getByRole("button", { name: "返回", exact: true }).waitFor();
    await page.waitForTimeout(500);
    const stepFrames = await page.evaluate(
      () => (window as any).stepFrames as { opacity: number; y: number }[],
    );
    expect(stepFrames.at(-1)).toEqual({ opacity: 1, y: 0 });
    if (reduced)
      expect(stepFrames.every((f) => f.opacity === 1 && f.y === 0)).toBe(true);
    else
      expect(stepFrames.some((f) => f.opacity > 0.65 && f.opacity < 1)).toBe(
        true,
      );
    await info.attach("detail-frames.json", {
      body: JSON.stringify(stepFrames),
      contentType: "application/json",
    });
  });

test("工作流程默认折叠，内部滚动到两端后衔接聊天，重开保留位置", async ({
  page,
}) => {
  await login(page);
  await chat(
    page,
    Array.from({ length: 45 }, (_, i) => `前文 ${i}：滚动验收`).join("\n"),
  );
  const threadId = await page
    .locator(".history-row.selected")
    .getAttribute("data-thread-id");
  expect(threadId).toBeTruthy();
  await fixture(page, "/api/test/process", { threadId, count: 36 });
  await chat(
    page,
    Array.from({ length: 25 }, (_, i) => `后文 ${i}：继续阅读`).join("\n"),
  );
  const toggle = page.getByRole("button", {
    name: "后续过程 · 36 项",
    exact: true,
  });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  const inner = page.getByRole("region", { name: "执行过程详情" }).last(),
    outer = page.locator(".conversation");
  await expect(inner).toBeVisible();
  await inner.evaluate((e) => {
    e.scrollTop = 180;
  });
  await inner.hover();
  const before = await outer.evaluate((e) => e.scrollTop);
  await page.mouse.wheel(0, 100);
  await expect
    .poll(() => inner.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(180);
  expect(await outer.evaluate((e) => e.scrollTop)).toBeCloseTo(before, 0);
  await inner.evaluate((e) => {
    e.scrollTop = 0;
  });
  await page.waitForTimeout(250);
  await page.mouse.wheel(0, -180);
  await expect
    .poll(() => outer.evaluate((e) => e.scrollTop))
    .toBeLessThan(before - 20);
  await inner.scrollIntoViewIfNeeded();
  await inner.evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await inner.hover();
  const bottomBefore = await outer.evaluate((e) => e.scrollTop);
  await page.waitForTimeout(250);
  await page.mouse.wheel(0, 180);
  await expect
    .poll(() => outer.evaluate((e) => e.scrollTop))
    .toBeGreaterThan(bottomBefore);
  await inner.evaluate((e) => {
    e.scrollTop = 150;
  });
  await toggle.click();
  await toggle.click();
  await expect.poll(() => inner.evaluate((e) => e.scrollTop)).toBe(150);
});

for (const width of [1280, 320])
  test(`模型共享目录和配置详情 ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await login(page, true);
    await page.getByRole("button", { name: "模型", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "搜索模型" });
    await search.waitFor();
    await expect(
      page.getByRole("button", { name: "刷新模型", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByRole("heading", { name: "模型", exact: true }),
    ).toHaveCount(1);
    await expect(page.getByText("模型服务", { exact: true })).toHaveCount(0);
    await expect(page.locator(".settings-dialog select")).toHaveCount(0);
    await search.fill("测试网关");
    await page.getByRole("button", { name: "专家", exact: true }).click();
    await page.getByRole("searchbox", { name: "搜索专家" }).waitFor();
    await page.getByRole("button", { name: "模型", exact: true }).click();
    await expect(search).toHaveValue("测试网关");
    const entry = page.getByRole("button", {
      name: "查看模型连接 测试网关",
      exact: true,
    });
    await expect(entry).toBeEnabled();
    await entry.click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(
      page.getByRole("button", { name: "获取服务器证书", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "测试网关 默认模型", exact: true }),
    ).toHaveText(/测试模型|secondary-model/);
    await page
      .getByRole("button", { name: "测试网关 默认模型", exact: true })
      .click();
    await page
      .getByRole("menuitemradio", { name: "secondary-model", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "测试网关 默认模型", exact: true }),
    ).toHaveText(/secondary-model/);
    await expect(
      page.getByRole("button", { name: "返回", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(entry).toBeFocused();
    await expect(entry).toContainText("secondary-model");
    await page
      .getByRole("button", { name: "添加模型连接", exact: true })
      .click();
    await page
      .getByRole("textbox", { name: "名称", exact: true })
      .fill("未保存的连接");
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "查看模型连接 未保存的连接",
        exact: true,
      }),
    ).toHaveCount(0);
    await search.fill("");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await info.attach(`models-${width}`, {
      body: await page.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
  });

test("目录迟到响应不得覆盖用户新查询、滚动和焦点", async ({ page }) => {
  await login(page, true);
  await page.getByRole("button", { name: "连接器", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "搜索连接器" });
  await search.fill("测试扩展");
  const entry = page.getByRole("button", {
    name: "查看 测试扩展 3",
    exact: true,
  });
  await entry.waitFor();
  await page.locator(".plugin-center-content").evaluate((e) => {
    e.scrollTop = 150;
  });
  await entry.focus();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await fixture(page, "/fixture/catalog-state", {
    rules: [{ key: "plugin/list", delay: 1000, remaining: 1 }],
  });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await search.click();
  await search.fill("测试");
  await entry.waitFor();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("测试");
  await expect
    .poll(() =>
      page.locator(".plugin-center-content").evaluate((e) => e.scrollTop),
    )
    .toBe(0);
  const events = await (
    await page.request.get("/fixture/catalog-state")
  ).json();
  expect(
    events.events.some(
      (e: { key: string; delayed: boolean }) =>
        e.key === "plugin/list" && e.delayed,
    ),
  ).toBe(true);
});

test("浏览器触摸取消释放拖拽捕获并保存最后宽度", async ({ page, context }) => {
  await login(page);
  const handle = page.getByRole("separator", { name: "调整左侧栏宽度" });
  const r = (await handle.boundingBox())!,
    x = r.x + r.width / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled", {
    enabled: true,
    maxTouchPoints: 2,
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y: 250, id: 0 }],
  });
  await expect(page.locator(".panel-drag-shield")).toHaveCount(1);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: x + 50, y: 250, id: 0 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect(page.locator(".panel-drag-shield")).toHaveCount(0);
  await expect(handle).toHaveAttribute("aria-valuenow", "306");
  await page.reload();
  await expect(handle).toHaveAttribute("aria-valuenow", "306");
});

test("模型连接创建保存、重新读取、移除以及目录失败恢复", async ({
  page,
}, info) => {
  await login(page, true);
  await page.getByRole("button", { name: "模型", exact: true }).click();
  const refresh = page.getByRole("button", { name: "刷新模型", exact: true });
  await expect(refresh).toBeEnabled();
  await page.getByRole("button", { name: "添加模型连接", exact: true }).click();
  await page
    .getByRole("textbox", { name: "名称", exact: true })
    .fill("UI13 临时连接");
  await page
    .getByRole("textbox", { name: "连接地址", exact: true })
    .fill("http://127.0.0.1:3169/fixture/provider-b");
  await page.getByText("自定义模型", { exact: true }).click();
  await page
    .getByRole("textbox", { name: "自定义模型", exact: true })
    .fill("ui13-custom-model");
  await info.attach("model-create", {
    body: await page.screenshot({ animations: "disabled" }),
    contentType: "image/png",
  });
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const entry = page.getByRole("button", {
    name: "查看模型连接 UI13 临时连接",
    exact: true,
  });
  await expect(entry).toBeVisible();
  await refresh.click();
  await expect(entry).toBeEnabled();
  await entry.click();
  await expect(
    page.getByRole("textbox", { name: "自定义模型", exact: true }),
  ).toHaveValue("ui13-custom-model");
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await page
    .getByRole("button", { name: "UI13 临时连接 更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "移除连接", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(entry).toHaveCount(0);
  await fixture(page, "/fixture/catalog-state", {
    rules: [{ key: "gateway/catalog", fail: true, remaining: 1 }],
  });
  await refresh.click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看模型连接 测试网关", exact: true }),
  ).toBeEnabled();
  await refresh.click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("设为默认需先选择有效模型，显式操作才切换连接", async ({ page }) => {
  await login(page, true);
  await page.getByRole("button", { name: "模型", exact: true }).click();
  const name = "第二网关 · 用于验证长名称在窄列中保持对齐";
  const entry = page.getByRole("button", {
    name: `查看模型连接 ${name}`,
    exact: true,
  });
  await expect(entry).toBeEnabled();
  await expect(entry.locator(".catalog-status")).toHaveCount(0);
  await entry.click();
  const makeDefault = page.getByRole("button", {
    name: "设为默认连接",
    exact: true,
  });
  await expect(makeDefault).toBeDisabled();
  await page
    .getByRole("button", { name: `${name} 默认模型`, exact: true })
    .click();
  await page
    .getByRole("menuitemradio", { name: "测试模型", exact: true })
    .click();
  await expect(makeDefault).toBeEnabled();
  await makeDefault.click();
  await expect(makeDefault).toHaveCount(0);
  await page.getByRole("button", { name: "返回", exact: true }).click();
  await expect(entry.locator(".catalog-status")).toContainText("默认");
  await page
    .getByRole("button", { name: "测试网关 更多操作", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "设为默认", exact: true }).click();
  await expect(
    page
      .getByRole("button", { name: "查看模型连接 测试网关", exact: true })
      .locator(".catalog-status"),
  ).toContainText("默认");
});

test("模型与MCP长配置共用外层滚动，不截断证书和保存入口", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await login(page, true);
  for (const section of ["模型", "连接器"]) {
    await page.getByRole("button", { name: section, exact: true }).click();
    if (section === "模型")
      await page
        .getByRole("button", { name: "添加模型连接", exact: true })
        .click();
    else {
      await page.getByRole("button", { name: "新连接器", exact: true }).click();
      await page.getByRole("menuitem", { name: "连接器", exact: true }).click();
    }
    for (let i = 0; i < 8; i++)
      await page
        .getByRole("button", { name: "添加请求头", exact: true })
        .click();
    const scroller = page.locator(".plugin-center-content"),
      body = page.locator(".connection-editor-body");
    await scroller.evaluate((e) => {
      e.scrollTop = 0;
    });
    await expect(
      page.getByRole("button", { name: "获取服务器证书", exact: true }),
    ).toBeVisible();
    await scroller.hover();
    await page.mouse.wheel(0, 400);
    await expect
      .poll(() => scroller.evaluate((e) => e.scrollTop))
      .toBeGreaterThan(0);
    expect(await body.evaluate((e) => e.scrollTop)).toBe(0);
    await page
      .getByRole("button", {
        name: section === "模型" ? "保存" : "添加",
        exact: true,
      })
      .scrollIntoViewIfNeeded();
    await expect(
      page.getByRole("button", {
        name: section === "模型" ? "保存" : "添加",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await info.attach(`long-${section}`, {
      body: await page.screenshot({ animations: "disabled" }),
      contentType: "image/png",
    });
    await page.getByRole("button", { name: "返回", exact: true }).click();
    await expect(
      page.getByRole("searchbox", { name: `搜索${section}` }),
    ).toBeVisible();
  }
});
