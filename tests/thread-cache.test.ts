import assert from "node:assert/strict";
import { test } from "node:test";
import { ThreadCache } from "../web/thread-cache";

test("presentation cache bounds retained conversations and evicts the least recently visited", () => {
  const cache = new ThreadCache(2);
  cache.remember({ id: "a", turns: [] });
  cache.remember({ id: "b", turns: [] });
  assert.equal(cache.get("a")?.id, "a");
  cache.remember({ id: "c", turns: [] });
  assert.equal(cache.get("b"), null);
  assert.equal(cache.get("a")?.id, "a");
  cache.clear();
  assert.equal(cache.get("a"), null);
  assert.equal(cache.get("c"), null);
});

test("large histories cannot exceed the byte budget or leave an obsolete version behind", () => {
  const cache = new ThreadCache(6, 200);
  cache.remember({ id: "a", turns: [], revision: 1 });
  cache.remember({ id: "a", turns: [], revision: 2 });
  assert.equal(cache.get("a")?.revision, 2);
  cache.remember({ id: "a", turns: [], preview: "x".repeat(200), revision: 3 });
  assert.equal(cache.get("a"), null);
  cache.remember({ id: "b", turns: [], preview: "x".repeat(40) });
  cache.remember({ id: "c", turns: [], preview: "x".repeat(40) });
  assert.equal(cache.get("b"), null);
  assert.equal(cache.get("c")?.id, "c");
});
