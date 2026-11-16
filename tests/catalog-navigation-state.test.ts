import test from "node:test";
import assert from "node:assert/strict";
import { catalogViews, settingsSection } from "../web/catalog-state";

test("旧入口进入设置中的同一分类", () => {
  assert.equal(settingsSection("plugins"), "connectors");
  assert.equal(settingsSection("mcp"), "connectors");
  assert.equal(settingsSection("skills"), "skills");
  assert.equal(settingsSection("unknown"), "general");
});
test("目录卸载和往返不清空查询，各分类互不污染", () => {
  catalogViews
    .getState()
    .update("connectors", {
      query: "cloudwalker",
      filter: "official",
      scroll: 320,
    });
  catalogViews.getState().update("skills", { query: "audit" });
  assert.deepEqual(catalogViews.getState().views.connectors, {
    query: "cloudwalker",
    filter: "official",
    scroll: 320,
    focus: "",
  });
  assert.equal(catalogViews.getState().views.skills.query, "audit");
  assert.equal(catalogViews.getState().views.experts.query, "");
});
