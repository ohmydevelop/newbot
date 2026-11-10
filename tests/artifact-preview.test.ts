import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  artifactLanguage,
  csvPreview,
  jsonPreview,
  previewText,
} from "../shared/artifact-preview.js";
import { Renderer } from "../web/components/Renderer.js";
test("CSV preview handles BOM, CRLF, escaped quotes, multiline cells and uneven columns", () => {
  const result = csvPreview(
    '\uFEFFname,notes,value\r\n"alpha, beta","line one\nline ""two""",12\r\nlast,,',
  );
  assert.equal(result.error, "");
  assert.deepEqual(result.rows, [
    ["name", "notes", "value"],
    ["alpha, beta", 'line one\nline "two"', "12"],
    ["last", "", ""],
  ]);
  assert.equal(result.truncated, false);
  assert.deepEqual(csvPreview("").rows, []);
  assert.match(csvPreview('a\n"unclosed').error, /闭合/);
  assert.match(csvPreview('a\n"closed"extra').error, /格式/);
});
test("CSV preview bounds rows, columns, cell lengths and incomplete large records", () => {
  const rows = csvPreview(
    Array.from({ length: 250 }, (_, n) => `${n},row`).join("\n"),
  );
  assert.equal(rows.rows.length, 101);
  assert.equal(rows.truncated, true);
  const wide = csvPreview(
    Array.from({ length: 50 }, (_, n) => `${n}`).join(","),
  );
  assert.equal(wide.rows[0].length, 30);
  assert.equal(wide.truncated, true);
  const cell = csvPreview(`header\n${"x".repeat(5000)}`);
  assert.equal(cell.rows[1][0].length, 2000);
  assert.equal(cell.truncated, true);
  const cut = csvPreview(`header\n"${"x".repeat(200_000)}`);
  assert.equal(cut.error, "");
  assert.equal(cut.truncated, true);
  assert.equal(cut.rows.length, 1);
});
test("text and JSON previews bound render work and preserve invalid or large source for download", () => {
  assert.equal(previewText("x".repeat(100_000)).text.length, 64_000);
  assert.equal(previewText("x".repeat(100_000)).truncated, true);
  assert.equal(jsonPreview('\uFEFF{"safe":1}').text, '{\n  "safe": 1\n}');
  assert.equal(jsonPreview("invalid").formatted, false);
  assert.match(jsonPreview("invalid").error, /无效/);
  assert.equal(jsonPreview("x".repeat(200_000)).text.length, 64_000);
  assert.equal(artifactLanguage("folder/file.TSX"), "tsx");
  assert.equal(artifactLanguage("unknown.txt"), "text");
});
test("artifact Markdown keeps HTML inert, does not load images or widgets, and preserves explicit web links", () => {
  const html = renderToStaticMarkup(
    createElement(Renderer, {
      document: true,
      text: '<script>globalThis.leaked=true</script>\n\n![image](/api/private)\n\n[relative](/api/private) [safe](https://example.com)\n\n```echarts\n{"title":{"text":"untrusted"}}\n```',
    }),
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes('href="/api/private"'));
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes("untrusted"));
  assert.ok(!html.includes("加载图表"));
});
