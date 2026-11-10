import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { createServer } from "../server/index.js";
import { A2uiFixtureCodex, formMessages } from "./a2ui-fixture.js";
import { SkillsCodex } from "./skill-fixture.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-chat-ui-")),
  cwd = join(directory, "workspace"),
  port = Number(process.env.CHAT_PRESENTATION_TEST_PORT || 3134),
  origin = `http://127.0.0.1:${port}`;
mkdirSync(cwd);
writeFileSync(join(cwd, "notes.md"), "# 对话产物\n\n文件内容保持可读。\n");
const codex = new A2uiFixtureCodex(),
  skills = new SkillsCodex(directory);
const bundle = await build({
  entryPoints: ["tests/app-lifecycle-view.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  minify: true,
});
const html = `<!doctype html><html><body><script type="module">${bundle.outputFiles![0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
let turns = 0,
  resources = 0,
  tools = 0,
  failReads = false;
const original = codex.call.bind(codex);
codex.call = (async (method: any, params: any) => {
  if (failReads && ["thread/read", "thread/resume"].includes(method))
    throw new Error("synthetic read failure");
  if (method === "skills/list" || method === "skills/config/write")
    return skills.call(method, params);
  if (method === "mcpServer/resource/read") {
    resources++;
    return {
      contents: [
        { uri: params.uri, mimeType: "text/html;profile=mcp-app", text: html },
      ],
    };
  }
  if (method === "mcpServer/tool/call") {
    tools++;
    return {
      content: [],
      structuredContent: { cpu: 42, source: params.arguments.source },
    };
  }
  const result: any = await original(method, params);
  if (method === "turn/start") {
    turns++;
    const text = params.input.find((v: any) => v.type === "text")?.text || "";
    setTimeout(() => {
      const t = params.threadId,
        r = result.turn.id;
      if (text.includes("background")) {
        codex.finish(t, "failed");
        return;
      }
      if (text.includes("broken")) {
        codex.item(
          t,
          r,
          {
            id: "broken-content",
            type: "agentMessage",
            text: { invalid: true },
          } as any,
          true,
        );
        codex.finish(t);
        return;
      }
      codex.item(
        t,
        r,
        {
          id: "answer",
          type: "agentMessage",
          text: "# 混合回复\n\n普通内容与交互结果保持关联。",
        },
        true,
      );
      if (text.includes("fail")) {
        codex.emit("event", {
          method: "error",
          params: {
            threadId: t,
            turnId: r,
            error: { message: "synthetic native diagnostic" },
            willRetry: false,
          },
        });
        setTimeout(() => codex.finish(t, "failed"), 80);
        return;
      }
      codex.item(
        t,
        r,
        {
          id: "declined",
          type: "commandExecution",
          command: "echo skipped",
          status: "declined",
          aggregatedOutput: null,
          exitCode: null,
        },
        true,
      );
      codex.item(
        t,
        r,
        {
          id: "files",
          type: "fileChange",
          status: "completed",
          changes: [
            { path: join(cwd, "notes.md"), kind: { type: "add" }, diff: "" },
          ],
        },
        true,
      );
      codex.item(
        t,
        r,
        {
          id: "app",
          type: "mcpToolCall",
          server: "test-server",
          tool: "metrics",
          status: "completed",
          arguments: { source: "mixed" },
          result: {
            content: [],
            structuredContent: { cpu: 25, source: "mixed" },
          },
          error: null,
        },
        true,
      );
      codex.tool(t, r, { messages: formMessages(), waitForAction: true });
    }, 100);
  }
  return result;
}) as typeof codex.call;
const respond = codex.respondTool.bind(codex);
codex.respondTool = (id, result) => {
  const req = codex.toolRequests.get(id)!;
  respond(id, result);
  const value = result.contentItems.find((v) => v.type === "inputText");
  if (value?.type !== "inputText") return;
  const payload = JSON.parse(value.text);
  if (!payload.action) return;
  setTimeout(() => {
    codex.item(
      req.params.threadId,
      req.params.turnId,
      { id: "form-answer", type: "agentMessage", text: "混合表单已提交。" },
      true,
    );
    codex.finish(req.params.threadId);
  }, 50);
};
const ctx = await createServer({
    providerRuntime: null,
  directory,
  cwd,
  codex,
  password: "chat-ui-fixture-login",
  origins: [origin],
});
ctx.app.post("/api/test/chat", async (req) => {
  const action = (req.body as any)?.action;
  if (action === "fail-reads") failReads = true;
  if (action === "restore-reads") failReads = false;
  if (action === "update") {
    const thread = [...codex.threads.values()][0];
    if (thread)
      codex.item(
        thread.id,
        thread.turns[0].id,
        { id: "extra", type: "agentMessage", text: "额外消息已到达。" },
        true,
      );
  }
  return { turns, resources, tools };
});
await ctx.app.listen({ host: "127.0.0.1", port });
console.log("Chat presentation UI fixture ready");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(
    signal,
    () =>
      void ctx.app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
