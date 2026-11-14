import { test } from "node:test";
import assert from "node:assert/strict";
import { submissionPreviewVisible } from "../web/submission-preview.js";
import { activityLabel, toolStatus } from "../web/chat-presentation.js";
const preview = { text: "same text", files: [], beforeTurns: ["old"] };
const turn = (id: string, text: string) =>
  ({
    id,
    status: "inProgress",
    items: [
      {
        id: `${id}-user`,
        type: "userMessage",
        content: [{ type: "text", text }],
      },
    ],
  }) as any;
test("submission remains visible until its new native echo arrives, including repeated prompts", () => {
  assert.equal(submissionPreviewVisible(preview, []), true);
  assert.equal(
    submissionPreviewVisible(preview, [turn("old", "same text")]),
    true,
  );
  assert.equal(
    submissionPreviewVisible(preview, [turn("other", "unrelated")]),
    true,
  );
  assert.equal(
    submissionPreviewVisible(preview, [turn("new", "same text")]),
    false,
  );
  assert.equal(
    submissionPreviewVisible({ ...preview, turnId: "accepted" }, [
      turn("accepted", "normalized by server"),
    ]),
    false,
  );
});
test("chat activity describes work without exposing protocol tool names", () => {
  assert.equal(activityLabel([]), "正在思考");
  assert.equal(
    activityLabel([{ type: "reasoning", status: "inProgress" } as any]),
    "正在思考",
  );
  assert.equal(
    activityLabel([
      {
        type: "mcpToolCall",
        tool: "vendor__internal__query",
        status: "inProgress",
      } as any,
    ]),
    "正在使用工具",
  );
  assert.equal(
    activityLabel([{ type: "webSearch", status: "inProgress" } as any]),
    "正在搜索",
  );
});

test("settled turns never animate unfinished tool items as still running", () => {
  const item = { type: "mcpToolCall", status: "inProgress" } as any;
  assert.equal(toolStatus(item, true).running, true);
  assert.deepEqual(toolStatus(item, false), {
    running: false,
    failed: false,
    label: "未完成",
  });
});
