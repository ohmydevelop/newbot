import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { defaultRemarkPlugins } from "streamdown";
import { markdownPlugins } from "./markdown-plugins.js";

const render = (content: string) =>
  renderToStaticMarkup(
    createElement(ReactMarkdown, {
      children: content,
      remarkPlugins: Object.values(defaultRemarkPlugins),
      rehypePlugins: markdownPlugins,
    }),
  );
test("math markup survives while untrusted HTML and executable URLs remain blocked", () => {
  const math = render("$$\na^2+b^2=c^2\n$$");
  assert.match(math, /class="katex/);
  assert.match(math, /<math /);
  assert.match(math, /class="katex-html" aria-hidden="true"/);
  const malicious = render(
    '<script>alert(1)</script><img src="x" onerror="alert(1)"><a href="javascript:alert(1)">unsafe</a><svg onload="alert(1)"></svg>',
  );
  assert.doesNotMatch(malicious, /<script|onerror|onload|javascript:|<svg/);
  const formulaLink = render("$$\\href{javascript:alert(1)}{unsafe}$$");
  assert.doesNotMatch(formulaLink, /href="javascript:/);
  assert.match(
    render("```html\n<script>alert(1)</script>\n```"),
    /&lt;script&gt;/,
  );
});
