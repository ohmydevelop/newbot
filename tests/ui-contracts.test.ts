import test from "node:test";
import assert from "node:assert/strict";
import { assertToolbar, assertCatalogReturn } from "../scripts/ui-contracts.ts";
test("故障注入：5px中心偏移必须阻止验收", () => {
  const rectangles = ["search", "add", "close"].map((label) => ({
    label,
    x: 0,
    y: 20,
    width: 44,
    height: 44,
  }));
  assertToolbar(rectangles, true);
  assert.throws(
    () =>
      assertToolbar(
        rectangles.map((r, i) => ({ ...r, y: r.y + (i === 2 ? 5 : 0) })),
        true,
      ),
    /中心差/,
  );
});
test("故障注入：查询/筛选/滚动丢失必须阻止验收", () => {
  const before = { query: "cloudwalker", filter: "official", scroll: 100 };
  assertCatalogReturn(before, { ...before });
  for (const after of [
    { ...before, query: "" },
    { ...before, filter: "" },
    { ...before, scroll: 0 },
  ])
    assert.throws(() => assertCatalogReturn(before, after));
});
