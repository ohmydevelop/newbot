import { test } from "node:test";
import assert from "node:assert/strict";
import { presentationBlocks, toolTitle } from "../web/chat-presentation.js";
test("process grouping preserves order, visible forms and stable app identity", () => {
  const items = [
    { id: "u", type: "userMessage" },
    { id: "c", type: "agentMessage", phase: "commentary" },
    { id: "t", type: "mcpToolCall" },
    { id: "a", type: "dynamicToolCall", a2ui: {} as any },
    { id: "x", type: "commandExecution" },
    { id: "f", type: "agentMessage", phase: "final_answer" },
  ];
  const blocks = presentationBlocks(items, new Set(["t"]));
  assert.deepEqual(
    blocks.map((b) => b.id),
    [
      "message:u",
      "process:c",
      "output:t",
      "message:a",
      "process:x",
      "message:f",
    ],
  );
  assert.deepEqual(
    blocks.flatMap((b) =>
      b.kind === "process"
        ? b.items.map((i) => i.id)
        : b.kind === "message"
          ? [b.item.id]
          : [],
    ),
    items.map((i) => i.id),
  );
  assert.equal(
    presentationBlocks(
      [...items, { id: "new", type: "sleep" }],
      new Set(["t"]),
    )[2].id,
    "output:t",
  );
});
test("tool summaries use published labels and leave protocol identifiers to details", () => {
  assert.equal(
    toolTitle({ id: "1", type: "mcpToolCall", tool: "opaque_tool" }),
    "使用工具",
  );
  assert.equal(
    toolTitle(
      { id: "1", type: "mcpToolCall", tool: "opaque_tool" },
      "查询账单",
    ),
    "查询账单",
  );
  assert.equal(toolTitle({ id: "1", type: "imageGeneration" }), "生成图片");
  assert.equal(toolTitle({ id: "1", type: "futureActivity" }), "执行活动");
});
test("unlabelled intermediate replies group consistently across streaming and history without moving final answers or Apps", () => {
  const items = [
    { id: "u", type: "userMessage" },
    { id: "intro", type: "agentMessage", text: "I will inspect it" },
    { id: "tool", type: "mcpToolCall", status: "completed" },
    { id: "mid", type: "agentMessage", text: "Now verify it" },
    { id: "verify", type: "commandExecution" },
    { id: "answer", type: "agentMessage", text: "Verified" },
  ];
  const running = presentationBlocks(items, new Set(["tool"]), "inProgress");
  const history = presentationBlocks(
    structuredClone(items),
    new Set(["tool"]),
    "completed",
  );
  assert.deepEqual(
    running.map((b) => b.id),
    history.map((b) => b.id),
  );
  assert.deepEqual(
    history.map((b) => b.id),
    [
      "message:u",
      "process:intro",
      "output:tool",
      "process:mid",
      "message:answer",
    ],
  );
  assert.equal(
    Object.hasOwn(items[1], "phase"),
    false,
    "native evidence remains unchanged",
  );
  const explicit = presentationBlocks(
    [
      { id: "f", type: "agentMessage", phase: "final_answer" },
      { id: "late", type: "sleep" },
    ],
    new Set(),
    "completed",
  );
  assert.equal(
    explicit[0].kind,
    "message",
    "an explicit final answer is authoritative",
  );
  assert.equal(
    presentationBlocks([items[5]], new Set(), "failed")[0].kind,
    "message",
  );
});


test("native reasoning lifecycle carries truthful step states and cancellation never completes unfinished work", async () => {
  const {AgentEvents}=await import("../server/ag-ui.js");
  const {toolStatus}=await import("../web/chat-presentation.js");
  const events=new AgentEvents(), output:any[]=[];
  events.on("event",e=>output.push(e));
  const item={id:"r",type:"reasoning",summary:["Inspect records"],content:[]};
  events.notification({method:"item/started",params:{threadId:"t",turnId:"u",item}} as any);
  const started=output.find(e=>e.content?.item)?.content.item;
  assert.equal(toolStatus(started,true).label,"执行中");
  assert.equal(toolStatus(started,false).label,"未完成");
  events.notification({method:"item/completed",params:{threadId:"t",turnId:"u",item}} as any);
  const completed=output.filter(e=>e.content?.item).at(-1).content.item;
  assert.equal(toolStatus(completed,false).label,"已完成");
  assert.equal(toolStatus({...item,status:"failed"},false).label,"失败");
});
