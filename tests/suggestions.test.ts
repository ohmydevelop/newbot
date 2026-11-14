import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSuggestions, turnSuggestions } from "../shared/suggestions.js";
import type { Item } from "../shared/types.js";
const questions = ["如何降低阳台番茄的浇水频率？", "北向阳台适合哪种番茄？"];
const block = (items: unknown = questions) =>
  `\`\`\`suggestions\n${JSON.stringify(items)}\n\`\`\``;
const answer = (text: string, phase?: string): Item => ({
  id: "a",
  type: "agentMessage",
  text,
  ...(phase ? { phase } : {}),
});

test("model questions are extracted while the display/copy body excludes metadata", () => {
  assert.deepEqual(extractSuggestions(`回答正文。\n\n${block()}\n`), {
    text: "回答正文。",
    suggestions: questions,
  });
  assert.deepEqual(
    extractSuggestions(
      `正文\r\n~~~Suggestions\r\n${JSON.stringify(questions)}\r\n~~~\r\n`,
    ),
    { text: "正文", suggestions: questions },
  );
});

test("absent, empty or malformed suggestions never manufacture fixed questions", () => {
  for (const text of [
    "普通回答",
    "回答\n```js\nconsole.log(1)\n```",
    `回答\n${block([])}`,
    "回答\n```suggestions\nnot json\n```",
    `回答\n${block({ question: "x" })}`,
  ])
    assert.deepEqual(extractSuggestions(text).suggestions, []);
  assert.equal(extractSuggestions("普通回答").text, "普通回答");
});

test("oversized, duplicate and old generic templates are excluded before the three-item limit", () => {
  const result = extractSuggestions(
    block([
      "长".repeat(80),
      4,
      " ",
      "继续展开",
      "给一个具体例子",
      "还有别的方案吗？",
      questions[0],
      questions[0].replace("？", "?"),
      questions[1],
      "如何判断番茄盆土是否缺水？",
      "怎么判断番茄结果了？",
    ]),
  );
  assert.deepEqual(result.suggestions, [
    ...questions,
    "如何判断番茄盆土是否缺水？",
  ]);
});

test("streaming metadata never appears in the answer and becomes clickable only when closed", () => {
  const complete = `正文\n${block()}`;
  const begin = complete.indexOf("\n", complete.indexOf("```suggestions"));
  for (let n = begin; n < complete.length; n++) {
    assert.equal(extractSuggestions(complete.slice(0, n)).text, "正文");
    assert.deepEqual(extractSuggestions(complete.slice(0, n)).suggestions, []);
  }
  assert.deepEqual(extractSuggestions(complete).suggestions, questions);
});

test("protocol examples inside ordinary fences or followed by prose stay visible", () => {
  for (const text of [
    `\`\`\`\`markdown\n${block()}\n\`\`\`\``,
    `${block()}\n这是协议示例。`,
    "```suggestions-example\n[1]\n```",
    "```js\nconst code = `\n```suggestions\n[]\n`;\n```",
  ])
    assert.deepEqual(extractSuggestions(text), { text, suggestions: [] });
  const example = `\`\`\`\`markdown\n${block(["示例"])}\n\`\`\`\``;
  assert.deepEqual(extractSuggestions(`${example}\n正文\n${block()}`), {
    text: `${example}\n正文`,
    suggestions: questions,
  });
});

test("only the current completed final answer supplies recommendations", () => {
  const final = answer(`答复\n${block()}`, "final_answer");
  const interim = answer(block(["这个过期追问不该展示"]), "commentary");
  assert.deepEqual(
    turnSuggestions({ status: "completed", items: [final, interim] }),
    questions,
  );
  assert.deepEqual(
    turnSuggestions({ status: "completed", items: [interim] }),
    [],
  );
  assert.deepEqual(
    turnSuggestions({ status: "completed", items: [answer(block())] }),
    questions,
  );
  assert.deepEqual(
    turnSuggestions({
      status: "completed",
      items: [final, answer("新的最终答案没有追问", "final_answer")],
    }),
    [],
  );
  assert.deepEqual(
    turnSuggestions({
      status: "completed",
      items: [
        final,
        { id: "empty", type: "agentMessage", phase: "final_answer" },
      ],
    }),
    [],
  );
  for (const status of ["inProgress", "failed", "interrupted", "unknown"])
    assert.deepEqual(turnSuggestions({ status, items: [final] }), []);
  assert.deepEqual(turnSuggestions({ status: "completed", items: [] }), []);
});

test("restored turns retain their own questions without cross-conversation state", () => {
  const first = { status: "completed", items: [answer(block())] };
  const secondQuestions = [
    "怎么定位SQL连接池的等待时间？",
    "连接泄漏会有哪些日志特征？",
  ];
  const second = {
    status: "completed",
    items: [answer(block(secondQuestions))],
  };
  assert.deepEqual(
    turnSuggestions(JSON.parse(JSON.stringify(first))),
    questions,
  );
  assert.deepEqual(turnSuggestions(second), secondQuestions);
  assert.deepEqual(turnSuggestions(first), questions);
});
