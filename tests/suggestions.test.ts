import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSuggestions } from "../shared/suggestions.js";

test("a suggestions block is removed from the answer and parsed", () => {
  const value = extractSuggestions(
    '回答正文。\n\n```suggestions\n["继续展开", "给一个具体例子"]\n```\n',
  );
  assert.equal(value.text, "回答正文。");
  assert.deepEqual(value.suggestions, ["继续展开", "给一个具体例子"]);
});

test("answers without a block stay untouched", () => {
  const text = "普通回答\n\n```js\nconsole.log(1)\n```";
  assert.deepEqual(extractSuggestions(text), { text, suggestions: [] });
});

test("malformed, oversized or excessive items are dropped", () => {
  assert.deepEqual(extractSuggestions("x\n```suggestions\nnot json\n```").suggestions, []);
  const long = "长".repeat(80);
  const value = extractSuggestions(
    `x\n\`\`\`suggestions\n["${long}", "ok", "a", "b", "c"]\n\`\`\``,
  );
  assert.deepEqual(value.suggestions, ["ok", "a", "b"]);
  assert.equal(value.text, "x");
});
