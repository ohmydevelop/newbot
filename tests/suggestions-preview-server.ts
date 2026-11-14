// Synthetic browser acceptance fixture; never connects to a model provider.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { followupService } from "../server/followups.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-suggestions-"));
const codex = new FakeCodex();
let starts = 0;
const call = codex.call.bind(codex);
codex.call = (async (method: any, p: any) => {
  const result = await call(method, p);
  if (method === "turn/start") {
    starts++;
    const prompt = p.input.find((i: any) => i.type === "text")?.text || "";
    const text =
      prompt === "无建议"
        ? "这是没有推荐数据的测试回复。"
        : prompt === "坏建议"
          ? "这是坏格式测试回复。\n```suggestions\nnot json\n```"
          : '这是上下文推荐测试回复。\n```suggestions\n["如何降低阳台番茄的浇水频率？","北向阳台适合哪种番茄？"]\n```';
    const id = (result as any).turn.id;
    setTimeout(() => {
      codex.item(
        p.threadId,
        id,
        {
          id: id + "-answer",
          type: "agentMessage",
          phase: "final_answer",
          text,
        },
        true,
      );
      codex.finish(p.threadId);
    }, 200);
  }
  return result;
}) as typeof codex.call;
const cwd = join(directory, "work");
mkdirSync(cwd);
const ctx = await createServer({
  providerRuntime: null,
  directory,
  cwd,
  codex,
  password: "suggestions-fixture-login",
  origins: ["http://127.0.0.1:3148"],
});
let generations = 0;
ctx.service.followups = followupService({
  db: ctx.db, read: ctx.service.read,
  route: () => ({ provider: "fixture", model: "fixture-model", revision: "1" }),
  generate: async (_thread, _provider, _model, context) => {
    generations++;
    const messages = JSON.parse(context);
    const lastUser = messages.filter((m: any) => m.role === "user").at(-1)?.text;
    if (lastUser === "坏建议" && generations === 1) throw new Error("Synthetic generation failure");
    await new Promise(r => setTimeout(r, 2000));
    return ["自吸水盆怎样给薄荷补水？", "每周两次如何修剪薄荷？"];
  },
});
ctx.app.get("/api/test/suggestions", async () => ({ starts, generations }));
await ctx.app.listen({ host: "127.0.0.1", port: 3148 });
console.log("Suggestions fixture ready");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(
    signal,
    () =>
      void ctx.app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
