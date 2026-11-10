import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { SkillsCodex, skillSource } from "./skill-fixture.js";
const port = Number(process.env.SKILLS_TEST_PORT || 3108);
const directory = mkdtempSync(join(tmpdir(), "newbot-skills-ui-"));
const codex = new SkillsCodex(directory);
const first = codex.skills[0];
const call = codex.call.bind(codex);
codex.call = (async (method: any, params: any) => {
  const result: any = await call(method, params);
  if (method === "turn/start")
    setTimeout(() => {
      codex.item(
        params.threadId,
        result.turn.id,
        {
          id: `answer-${result.turn.id}`,
          type: "agentMessage",
          text: "测试任务已接收原生技能输入。",
        },
        true,
      );
      codex.finish(params.threadId);
    }, 300);
  return result;
}) as typeof codex.call;
const { app } = await createServer({
    providerRuntime: null,
  directory: join(directory, "app"),
  cwd: join(directory, "workspace"),
  codex,
  password: "skills-ui-test-password",
  origins: [`http://127.0.0.1:${port}`],
});
app.get("/api/test/skill-inputs", async () => ({
  turns: codex.calls
    .filter((c) => c.method === "turn/start")
    .map((c) => c.params.input),
}));
// Test-only controls; this file is never bundled by the product server.
app.post("/api/test/skills", async (req) => {
  const action = (req.body as { action: string }).action;
  if (action === "update")
    writeFileSync(
      first.path,
      "---\nname: code-review\n---\n# 已更新的技能说明\n\n当前文件内容已改变。",
    );
  else if (action === "disable") first.enabled = false;
  else if (action === "enable") first.enabled = true;
  else if (action === "delete-file") unlinkSync(first.path);
  else if (action === "restore") writeFileSync(first.path, skillSource);
  else if (action === "remove")
    codex.skills = codex.skills.filter((s) => s.path !== first.path);
  else if (action === "readd") {
    if (!codex.skills.some((s) => s.path === first.path))
      codex.skills.unshift(first);
  } else if (action === "fail-list") codex.discoveryFailure = true;
  else if (action === "recover-list") codex.discoveryFailure = false;
  else if (action === "warnings") codex.warnings = true;
  else if (action === "clear-warnings") codex.warnings = false;
  else throw new Error("未知的测试操作");
  return { ok: true };
});
await app.listen({ host: "127.0.0.1", port });
console.log(`Skills UI fixture ready: http://127.0.0.1:${port}`);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
