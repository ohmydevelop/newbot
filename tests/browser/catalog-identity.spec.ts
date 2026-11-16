import { test, expect } from "@playwright/test";
for (const width of [390, 1280])
  for (const theme of ["light", "dark"] as const)
    test(`目录身份色与比例 ${width} ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/");
      await page.getByLabel("登录密码").fill("issue-fixture-login");
      await page.getByRole("button", { name: "继续", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "选择模型", exact: true }),
      ).toBeEnabled();
      const result = await page.request.post("/api/agent/action", {
        headers: { Origin: "http://127.0.0.1:3169" },
        data: {
          action: "expert/save",
          name: `身份色验收 ${width} ${theme}`,
          description: "辅助说明与真实状态分离",
          instructions: "只读验收",
          skillIds: [],
          pluginIds: [],
          connectorIds: [],
        },
      });
      expect(result.ok(), await result.text()).toBe(true);
      if (width < 760)
        await page
          .getByRole("button", { name: "展开侧栏", exact: true })
          .click();
      await page.getByRole("button", { name: "设置", exact: true }).click();
      for (const [section, tone] of [
        ["连接器", "blue"],
        ["技能", "orange"],
        ["专家", "green"],
        ["模型", "orange"],
      ]) {
        await page.getByRole("button", { name: section, exact: true }).click();
        await page.getByRole("searchbox", { name: `搜索${section}` }).waitFor();
        const icon = page
          .locator(".catalog-entry-main .catalog-mark:visible")
          .first();
        await expect(icon).toHaveAttribute("data-identity-tone", tone);
        const observed = await icon.evaluate((el) => {
          const style = getComputedStyle(el),
            root = getComputedStyle(document.documentElement);
          const row = el.closest(".catalog-entry-main")!;
          const name = row.querySelector(".catalog-identity strong")!;
          const description = row.querySelector(".catalog-identity small");
          return {
            width: el.getBoundingClientRect().width,
            height: el.getBoundingClientRect().height,
            glyph: el.querySelector("svg")!.getBoundingClientRect().width,
            ink: style.color,
            nameSize: getComputedStyle(name).fontSize,
            descriptionSize: description
              ? getComputedStyle(description).fontSize
              : null,
            nameColor: getComputedStyle(name).color,
            expected: root
              .getPropertyValue(
                "--" +
                  (el.getAttribute("data-identity-tone") === "blue"
                    ? "accent"
                    : el.getAttribute("data-identity-tone") === "green"
                      ? "success"
                      : "entity"),
              )
              .trim(),
          };
        });
        expect(observed.width).toBe(32);
        expect(observed.height).toBe(32);
        expect(observed.glyph).toBe(18);
        expect(observed.nameSize).toBe("14px");
        if (observed.descriptionSize)
          expect(observed.descriptionSize).toBe("12px");
        expect(observed.ink).not.toBe(observed.nameColor);
        const expected = await page.evaluate((color) => {
          const canvas = document.createElement("canvas");
          const c = canvas.getContext("2d")!;
          c.fillStyle = color;
          c.fillRect(0, 0, 1, 1);
          const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
          return `rgb(${r}, ${g}, ${b})`;
        }, observed.expected);
        expect(observed.ink).toBe(expected);
      }
    });
