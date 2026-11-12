import assert from "node:assert/strict";
import { test } from "node:test";
import { absoluteTime, relativeTime } from "../web/time.js";

const now = new Date(2026, 10, 12, 12, 0, 0).getTime();
const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const week = 7 * day;

test("relative labels cover the sidebar recency buckets", () => {
  assert.equal(relativeTime(now - 30_000, now), "刚刚");
  assert.equal(relativeTime(now - 5 * minute, now), "5 分钟前");
  assert.equal(relativeTime(now - 3 * hour, now), "3 小时前");
  assert.equal(relativeTime(now - 2 * day, now), "2 天前");
  assert.equal(relativeTime(now - 3 * week, now), "3 周前");
  assert.equal(relativeTime(now - 9 * week, now), "9 月 10 日");
});

test("relative labels stay sane for empty, future and boundary values", () => {
  assert.equal(relativeTime(undefined, now), "");
  assert.equal(relativeTime(Number.NaN, now), "");
  assert.equal(relativeTime(0, now), "");
  assert.equal(relativeTime(now + day, now), "刚刚");
  assert.equal(relativeTime(now - minute, now), "1 分钟前");
  assert.equal(relativeTime(now - hour, now), "1 小时前");
  assert.equal(relativeTime(now - day, now), "1 天前");
});

test("absolute labels are stable, local and include minutes", () => {
  const value = new Date(2026, 10, 12, 8, 7, 30).getTime();
  assert.equal(absoluteTime(value), "2026-11-12 08:07");
  assert.equal(absoluteTime(undefined), "");
});
