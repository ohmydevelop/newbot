# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: related-scroll.spec.ts >> 插件长工具目录触摸主滚动与返回
- Location: tests/mobile/related-scroll.spec.ts:63:1

# Error details

```
TimeoutError: locator.tap: Timeout 10000ms exceeded.
Call log:
  - waiting for getByRole('button', { name: '查看 test-server', exact: true })
    - locator resolved to <button type="button" class="catalog-entry-main" aria-label="查看 test-server">…</button>
  - attempting tap action
    - waiting for element to be visible, enabled and stable
    - element is not stable
  - retrying tap action
    - waiting for element to be visible, enabled and stable
    - element is not visible
  - retrying tap action
    - waiting 20ms
    2 × waiting for element to be visible, enabled and stable
      - element is not visible
    - retrying tap action
      - waiting 100ms
    19 × waiting for element to be visible, enabled and stable
       - element is not visible
     - retrying tap action
       - waiting 500ms

```

# Page snapshot

```yaml
- generic:
  - generic [aria-hidden]:
    - generic:
      - link:
        - /url: "#message-input"
        - text: 跳到消息输入
      - main:
        - generic:
          - generic:
            - button
            - strong: newbot
        - generic:
          - generic:
            - heading [level=1]: 今天想探索什么？
        - generic:
          - generic:
            - textbox:
              - /placeholder: 询问任何问题
            - generic:
              - generic:
                - button
                - button [disabled]
                - button [disabled]
              - generic:
                - button [disabled]:
                  - generic: 测试模型
                - button [disabled]
              - button [disabled]
  - dialog "连接器" [ref=e2]:
    - banner [ref=e3]:
      - heading "连接器" [level=2] [ref=e4]
      - button "关闭" [ref=e5] [cursor=pointer]
    - generic [ref=e6]:
      - navigation "设置分类" [ref=e7]:
        - button "外观" [ref=e8] [cursor=pointer]
        - button "操作" [ref=e9] [cursor=pointer]
        - button "连接器" [ref=e10] [cursor=pointer]
        - button "技能" [ref=e11] [cursor=pointer]
        - button "专家" [ref=e12] [cursor=pointer]
        - button "模型" [ref=e13] [cursor=pointer]
        - button "存储" [ref=e14] [cursor=pointer]
        - button "安全" [ref=e15] [cursor=pointer]
      - region "连接器" [ref=e16]:
        - region "测试插件" [ref=e20]:
          - generic [ref=e21]:
            - button "返回" [ref=e22] [cursor=pointer]
            - heading "测试插件" [active] [level=2] [ref=e24]
            - button "在聊天中使用" [ref=e27] [cursor=pointer]
          - generic [ref=e28]:
            - paragraph [ref=e34]: 插件详细说明
            - region "插件技能" [ref=e36]:
              - heading "技能" [level=4] [ref=e37]
              - generic [ref=e38]:
                - button "plugin-guide 测试插件使用说明" [ref=e39] [cursor=pointer]:
                  - generic [ref=e40]:
                    - strong [ref=e41]: plugin-guide
                    - generic [ref=e42]: 测试插件使用说明
                - button "停用 plugin-guide" [ref=e43] [cursor=pointer]
            - heading "连接器" [level=4] [ref=e44]
            - region "连接器管理" [ref=e45]:
              - generic [ref=e47]:
                - button "查看 test-server" [ref=e48] [cursor=pointer]:
                  - generic [ref=e51]:
                    - strong [ref=e52]: test-server
                    - generic [ref=e53]:
                      - img "已发现，尚未验证连接" [ref=e54]
                      - text: 已添加
                - button "test-server 更多操作" [ref=e55] [cursor=pointer]
            - generic [ref=e56]:
              - button "升级" [disabled] [ref=e57]
              - button "停用" [ref=e58] [cursor=pointer]
              - button "卸载" [ref=e59] [cursor=pointer]
```

# Test source

```ts
  1  | import { test, expect } from "@playwright/test";
  2  | import { settings, chain, swipe } from "./touch-helpers";
  3  | test("技能导入预览触摸两端交接，不执行安装", async ({
  4  |   page,
  5  |   context,
  6  | }, info) => {
  7  |   const preview = {
  8  |     id: "00000000-0000-4000-8000-000000000015",
  9  |     source: { kind: "files", name: "触摸预览夹具" },
  10 |     state: "ready",
  11 |     bytes: 1000,
  12 |     files: 24,
  13 |     created: 1,
  14 |     retained: true,
  15 |     entries: [
  16 |       {
  17 |         id: "fixture",
  18 |         kind: "skills",
  19 |         name: "触摸预览夹具",
  20 |         root: ".",
  21 |         description: "",
  22 |         digest: "fixture",
  23 |         state: "available",
  24 |         mcp: [],
  25 |         hooks: [],
  26 |         skills: Array.from({ length: 24 }, (_, i) => ({
  27 |           id: `skill-${i}`,
  28 |           name: `技能 ${i}`,
  29 |           description: "滚动边界验证",
  30 |           path: `skill-${i}/SKILL.md`,
  31 |         })),
  32 |       },
  33 |     ],
  34 |   };
  35 |   await page.route("**/api/imports**", (route) =>
  36 |     route.fulfill({
  37 |       json:
  38 |         new URL(route.request().url()).pathname === "/api/imports"
  39 |           ? [preview]
  40 |           : preview,
  41 |     }),
  42 |   );
  43 |   await page.setViewportSize({ width: 390, height: 640 });
  44 |   await settings(page, "技能");
  45 |   await page.getByRole("button", { name: "添加技能", exact: true }).tap();
  46 |   await page.getByRole("menuitem", { name: "导入技能", exact: true }).tap();
  47 |   await page
  48 |     .getByRole("button", { name: "触摸预览夹具 继续导入", exact: true })
  49 |     .tap();
  50 |   await chain(
  51 |     page,
  52 |     await context.newCDPSession(page),
  53 |     page.locator(".import-skills"),
  54 |     page.locator(".plugin-center-content"),
  55 |   );
  56 |   await info.attach("import-touch", {
  57 |     body: await page.screenshot(),
  58 |     contentType: "image/png",
  59 |   });
  60 |   await page.getByRole("button", { name: "返回", exact: true }).tap();
  61 |   await expect(page.getByRole("searchbox", { name: "搜索技能" })).toBeVisible();
  62 | });
  63 | test("插件长工具目录触摸主滚动与返回", async ({ page, context }, info) => {
  64 |   await settings(page, "连接器");
  65 |   await page.getByRole("button", { name: "查看 测试插件", exact: true }).tap();
  66 |   await page
  67 |     .getByRole("button", { name: "查看 test-server", exact: true })
> 68 |     .tap();
     |      ^ TimeoutError: locator.tap: Timeout 10000ms exceeded.
  69 |   await expect(page.locator(".connection-tool")).toHaveCount(125);
  70 |   const outer = page.locator(".plugin-center-content"),
  71 |     cdp = await context.newCDPSession(page);
  72 |   await swipe(cdp, 195, 650, 0, -400);
  73 |   await expect
  74 |     .poll(() => outer.evaluate((e) => e.scrollTop))
  75 |     .toBeGreaterThan(200);
  76 |   const before = await outer.evaluate((e) => e.scrollTop);
  77 |   await swipe(cdp, 195, 250, 0, 300);
  78 |   await expect
  79 |     .poll(() => outer.evaluate((e) => e.scrollTop))
  80 |     .toBeLessThan(before - 100);
  81 |   await info.attach("plugin-tools-touch", {
  82 |     body: await page.screenshot(),
  83 |     contentType: "image/png",
  84 |   });
  85 |   await page.getByRole("button", { name: "返回", exact: true }).tap();
  86 |   await expect(
  87 |     page.getByRole("heading", { name: "测试插件", exact: true }),
  88 |   ).toBeVisible();
  89 | });
  90 | 
```