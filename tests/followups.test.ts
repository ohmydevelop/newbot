import { test } from "node:test";
import assert from "node:assert/strict";
import { followupService } from "../server/followups.js";
import type { Thread } from "../shared/types.js";
const questions = ["薄荷夏季用多大的储水盆？", "怎么区分薄荷缺水和烂根？"];
function fixture() {
  const db = new Map<string, string>();
  let thread: Thread = {
    id: "one",
    turns: [
      {
        id: "turn",
        status: "completed",
        items: [
          {
            id: "u",
            type: "userMessage",
            content: [{ type: "text", text: "北向阳台改种薄荷，每周两次打理" }],
          },
          { id: "a", type: "agentMessage", text: "建议用自吸水盆。" },
          {
            id: "tool",
            type: "commandExecution",
            aggregatedOutput: "PRIVATE_TOOL_OUTPUT",
          },
        ],
      },
    ],
  };
  let revision = "1",
    calls = 0;
  let generate = async (...args: string[]) => {
    assert.ok(args[3].includes("薄荷"));
    assert.ok(!args[3].includes("PRIVATE_TOOL_OUTPUT"));
    calls++;
    return questions as unknown;
  };
  const options = {
    db: {
      get: (k: string) => db.get(k),
      set: (k: string, v: string) => {
        db.set(k, v);
      },
    },
    read: async () => structuredClone(thread),
    route: () => ({ provider: "p", model: "m", revision }),
    generate: (...args: string[]) => generate(...args),
  };
  return {
    options,
    db,
    get calls() {
      return calls;
    },
    get thread() {
      return thread;
    },
    set revision(v: string) {
      revision = v;
    },
    set generate(fn: typeof generate) {
      generate = fn;
    },
  };
}
test("missing inline recommendations are model generated once and survive a service recreation", async () => {
  const f = fixture(),
    request = followupService(f.options);
  assert.deepEqual(await request("one", "turn"), questions);
  assert.deepEqual(await followupService(f.options)("one", "turn"), questions);
  assert.equal(f.calls, 1);
});
test("concurrent tabs share one generation without creating native user turns", async () => {
  const f = fixture();
  let resolve!: (x: unknown) => void,
    calls = 0;
  f.generate = async () => {
    calls++;
    return new Promise((r) => {
      resolve = r;
    });
  };
  const request = followupService(f.options),
    a = request("one", "turn"),
    b = request("one", "turn");
  await new Promise((r) => setImmediate(r));
  assert.equal(calls, 1);
  resolve(questions);
  assert.deepEqual(await Promise.all([a, b]), [questions, questions]);
  assert.equal(f.thread.turns.length, 1);
});
test("new turn or changed model configuration discards a late completion", async () => {
  for (const changed of ["turn", "route", "body"]) {
    const f = fixture();
    let resolve!: (x: unknown) => void;
    f.generate = async () =>
      new Promise((r) => {
        resolve = r;
      });
    const request = followupService(f.options)("one", "turn");
    await new Promise((r) => setImmediate(r));
    if (changed === "turn")
      f.thread.turns.push({ id: "next", status: "inProgress", items: [] });
    else if (changed === "body") f.thread.turns[0].items[1].text = "内容已改变";
    else f.revision = "2";
    resolve(questions);
    await assert.rejects(request, /已更新|配置已变化/);
    assert.equal(f.db.size, 0);
  }
});
test("failures and invalid model output are not cached or replaced with generic prompts", async () => {
  const f = fixture();
  f.generate = async () => ["继续展开", "给一个具体例子"];
  const request = followupService(f.options);
  await assert.rejects(request("one", "turn"), /有效追问/);
  assert.equal(f.db.size, 0);
  f.generate = async () => {
    throw new Error("upstream unavailable");
  };
  await assert.rejects(request("one", "turn"), /upstream/);
  f.generate = async () => questions;
  assert.deepEqual(await request("one", "turn"), questions);
});
test("uncompleted and obsolete turns never trigger supplemental generation", async () => {
  const f = fixture(),
    request = followupService(f.options);
  for (const status of ["inProgress", "failed", "interrupted"]) {
    f.thread.turns[0].status = status;
    await assert.rejects(request("one", "turn"));
  }
  f.thread.turns[0].status = "completed";
  await assert.rejects(request("one", "other"));
  assert.equal(f.calls, 0);
});
test("valid inline recommendations are reused without a second inference", async () => {
  const f = fixture();
  f.thread.turns[0].items[1].text +=
    "\n```suggestions\n" + JSON.stringify(questions) + "\n```";
  assert.deepEqual(await followupService(f.options)("one", "turn"), questions);
  assert.equal(f.calls, 0);
});
