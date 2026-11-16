import test from "node:test";
import assert from "node:assert/strict";
import { panelKeyboard, panelLayout, clampPanel } from "../web/panel-sizing";
test("空间不足先收右栏，保留聊天可用宽度，不写坏偏好", () => {
  assert.deepEqual(panelLayout(1280, true, true, 400, 520), {
    left: 400,
    right: 400,
    overlay: false,
  });
  assert.deepEqual(panelLayout(1100, true, true, 400, 520), {
    left: 360,
    right: 260,
    overlay: false,
  });
  assert.equal(panelLayout(768, true, true, 400, 520).overlay, true);
  assert.equal(panelLayout(1440, false, true, 400, 520).left, 57);
});
test("两侧键盘物理方向相同，10px步长和边界", () => {
  assert.equal(panelKeyboard("left", 256, "ArrowRight"), 266);
  assert.equal(panelKeyboard("right", 300, "ArrowRight"), 290);
  assert.equal(panelKeyboard("left", 256, "Home"), 220);
  assert.equal(panelKeyboard("right", 300, "End"), 520);
  assert.equal(panelKeyboard("right", 260, "ArrowRight"), 260);
  assert.equal(panelKeyboard("left", 256, "Escape"), null);
  assert.equal(clampPanel("left", NaN), 256);
});
