import assert from "node:assert/strict";
export function assertToolbar(
  rectangles: { label: string; width: number; height: number; y: number }[],
  mobile = false,
) {
  assert.ok(rectangles.length >= 3, "标题栏测量不完整");
  for (const item of rectangles) {
    assert.ok(item.width > 0 && item.height > 0, `${item.label}: 控件不可见`);
    if (mobile)
      assert.ok(item.height >= 44, `${item.label}: 手机点击高度不足44px`);
  }
  const centers = rectangles.map((r) => r.y + r.height / 2);
  assert.ok(
    Math.max(...centers) - Math.min(...centers) <= 1,
    "标题栏中心差超过1px",
  );
}
export function assertCatalogReturn(
  before: { query: string; filter: string; scroll: number },
  after: { query: string; filter: string; scroll: number },
) {
  assert.equal(after.query, before.query, "分类往返丢失搜索条件");
  assert.equal(after.filter, before.filter, "分类往返丢失筛选条件");
  assert.ok(
    Math.abs(after.scroll - before.scroll) <= 1,
    "分类往返丢失滚动位置",
  );
}
