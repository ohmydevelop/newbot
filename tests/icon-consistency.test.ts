import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CatalogIcon from "../web/components/CatalogIcon.js";
import { processIcons, PluginIcon } from "../web/components/AppIcons.js";

test("renaming a catalog entry cannot change its functional identity", () => {
  for (const kind of ["skill", "plugin", "connection", "gateway"] as const) {
    const icon = (name: string) =>
      renderToStaticMarkup(createElement(CatalogIcon, { kind, name }));
    assert.equal(icon("code review"), icon("设计搜索文档"));
    assert.equal(icon(""), icon("my custom item"));
    assert.match(icon(""), new RegExp(`data-icon="${kind}"`));
  }
});

test("MCP and dynamic tools use the same plugin identity as selection and catalog", () => {
  assert.equal(processIcons.mcpToolCall, PluginIcon);
  assert.equal(processIcons.dynamicToolCall, PluginIcon);
  for (const type of [
    "commandExecution",
    "fileChange",
    "webSearch",
    "plan",
    "imageView",
    "imageGeneration",
    "collabAgentToolCall",
    "subAgentActivity",
    "sleep",
    "enteredReviewMode",
    "exitedReviewMode",
    "contextCompaction",
    "hookPrompt",
    "functionCallOutput",
  ]) {
    assert.ok(processIcons[type], `${type} must have a functional identity`);
    assert.doesNotMatch(
      renderToStaticMarkup(createElement(processIcons[type])),
      /lucide-circle[" ]/,
    );
  }
});
