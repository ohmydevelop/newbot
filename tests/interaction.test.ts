import { test } from "node:test";
import assert from "node:assert/strict";
import {
  chatShortcut,
  composerEnter,
  resolveTheme,
} from "../web/interaction.js";
test("only a plain non-repeating Enter submits the composer", () => {
  assert.equal(composerEnter({ key: "Enter" }), true);
  for (const key of [
    "shiftKey",
    "ctrlKey",
    "metaKey",
    "altKey",
    "repeat",
    "defaultPrevented",
  ] as const)
    assert.equal(composerEnter({ key: "Enter", [key]: true }), false, key);
  assert.equal(composerEnter({ key: "a" }), false);
});
test("IME composition and the legacy 229 key never submit or trigger navigation", () => {
  for (const input of [{ isComposing: true }, { keyCode: 229 }]) {
    assert.equal(composerEnter({ key: "Enter", ...input }), false);
    assert.equal(
      chatShortcut({ key: "k", ctrlKey: true, ...input }, true, false),
      null,
    );
  }
});
test("chat shortcuts work for Control and Command with exact modifiers", () => {
  for (const input of [{ ctrlKey: true }, { metaKey: true }]) {
    assert.equal(chatShortcut({ key: "K", ...input }, true, false), "search");
    assert.equal(
      chatShortcut({ key: "O", shiftKey: true, ...input }, true, false),
      "new",
    );
    assert.equal(
      chatShortcut({ key: "k", shiftKey: true, ...input }, true, false),
      null,
    );
    assert.equal(chatShortcut({ key: "o", ...input }, true, false), null);
  }
});
test("login, modal, menu and handled keys never trigger chat navigation", () => {
  const key = { key: "o", ctrlKey: true, shiftKey: true };
  assert.equal(chatShortcut(key, false, false), null);
  assert.equal(chatShortcut(key, true, true), null);
  for (const field of ["repeat", "defaultPrevented", "altKey"] as const)
    assert.equal(chatShortcut({ ...key, [field]: true }, true, false), null);
});
test("explicit appearance stays fixed while system and unknown preferences track the OS", () => {
  for (const dark of [true, false]) {
    assert.equal(resolveTheme("light", dark), "light");
    assert.equal(resolveTheme("dark", dark), "dark");
    assert.equal(resolveTheme("system", dark), dark ? "dark" : "light");
    assert.equal(resolveTheme("invalid", dark), dark ? "dark" : "light");
  }
});
