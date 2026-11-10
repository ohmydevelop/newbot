import { test } from "node:test";
import assert from "node:assert/strict";
import { mentionAt, removeMention } from "../web/composer-selection.js";

test("mention completion follows the caret and preserves surrounding Unicode text", () => {
  for (const [value, caret, expected, query] of [
    ["前文 @test 后文", 8, "前文  后文", "test"],
    ["$code suffix", 5, " suffix", "code"],
    ["hello @testing suffix", 9, "hello  suffix", "te"],
    ["🧭 @test 文字", 8, "🧭  文字", "test"],
  ] as const) {
    const token = mentionAt(value, caret);
    assert.ok(token);
    assert.equal(token.query, query);
    assert.equal(removeMention(value, token), expected);
  }
});
test("literal emails, adjacent markers and text selections do not open completion", () => {
  for (const value of ["name@example", "@@test", "hello$code", "plain words"])
    assert.equal(mentionAt(value, value.length), null);
  assert.equal(mentionAt("$code", 0, 5), null);
  assert.equal(mentionAt("$code", -1), null);
});
