// Isolated UI fixture: synthetic history, no upstream models or actual sudo.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { SkillsCodex } from "./skill-fixture.js";
import { testSudo } from "./sudo-fixture.js";
const port = Number(process.env.INTERACTION_TEST_PORT || 3138),
  origin = `http://127.0.0.1:${port}`,
  directory = mkdtempSync(join(tmpdir(), "newbot-interaction-ui-"));
const codex = new SkillsCodex(directory);
const rich = `# 主题与键盘检查

普通文字、[外部说明](https://example.com) 与 $E=mc^2$。

| 指标 | 数值 |
| --- | --- |
| CPU | 42% |

\`\`\`ts
const ready = true;
\`\`\`

\`\`\`mermaid
flowchart LR
A[开始] --> B[确认]
\`\`\`

\`\`\`echarts
{"title":{"text":"资源占用"},"xAxis":{"type":"category","data":["CPU","内存"]},"yAxis":{"type":"value"},"series":[{"type":"bar","data":[42,65]}]}
\`\`\`
`;
for (let i = 0; i < 18; i++) {
  const id = i ? `history-${i}` : "rich";
  codex.threads.set(id, {
    id,
    name: i ? `历史对话 ${i}：检查窄屏与键盘操作` : "富文本主题检查",
    modelProvider: "fixture",
    status: { type: "idle" },
    updatedAt: Date.now() / 1000,
    preview: "UI test",
    turns: [
      {
        id: id + "-turn",
        status: "completed",
        error: null,
        items: [
          {
            id: id + "-answer",
            type: "agentMessage",
            text: i ? "历史内容。" : rich,
          },
        ],
      },
    ],
  });
}
let turns = 0,
  launched = 0;
const original = codex.call.bind(codex);
codex.call = (async (method: any, params: any) => {
  const result: any = await original(method, params);
  if (method === "turn/start") {
    turns++;
    const text = params.input.find((v: any) => v.type === "text")?.text || "";
    setTimeout(() => {
      codex.item(
        params.threadId,
        result.turn.id,
        {
          id: result.turn.id + "-answer",
          type: "agentMessage",
          text: `收到：${text}`,
        },
        true,
      );
      codex.finish(params.threadId);
    }, 80);
  }
  return result;
}) as typeof codex.call;
const ctx = await createServer({
    providerRuntime: null,
  directory,
  cwd: join(directory, "workspace"),
  codex,
  password: "interaction-ui-fixture-login",
  origins: [origin],
  sudoIdentity: testSudo({ mode: "success", launched: () => launched++ }),
});
for (const [id, t] of codex.threads) {
  ctx.db.addThread(id, "fixture");
  ctx.db.rename(id, t.name);
}
ctx.app.get("/api/test/interaction", async () => ({
  turns,
  launched,
  pendingPrivateInputs: ctx.credentials.pending,
}));
await ctx.app.listen({ host: "127.0.0.1", port });
console.log("Interaction UI fixture ready");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(
    signal,
    () =>
      void ctx.app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
