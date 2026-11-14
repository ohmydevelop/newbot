import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleCatalogSkills } from "../web/skill-catalog";
import type { Skill } from "../shared/types";
const own = {
  id: "a",
  name: "review",
  description: "Review changes",
  scope: "repo",
  pluginId: null,
  enabled: true,
  path: "/skills/review/SKILL.md",
  interface: { displayName: "代码审查" },
} as Skill;
const bundled = {
  ...own,
  id: "b",
  name: "bundle-only",
  pluginId: "bundle@local",
  description: "private bundle entry",
  interface: undefined,
} as Skill;
test("a search matching only bundled skills is empty in the standalone catalog", () => {
  assert.deepEqual(visibleCatalogSkills([own, bundled], "bundle"), []);
});
test("a catalog containing only bundled skills has the same empty set with and without a query", () => {
  assert.deepEqual(visibleCatalogSkills([bundled]), []);
  assert.deepEqual(visibleCatalogSkills([bundled], "bundle"), []);
});
test("visible standalone skills match localized names and selected source without changing input", () => {
  const input = [own, bundled];
  assert.deepEqual(visibleCatalogSkills(input, "  代码审查  ", "repo"), [own]);
  assert.deepEqual(visibleCatalogSkills(input, "REVIEW", "user"), []);
  assert.equal(input.length, 2);
});
