// Synthetic, isolated browser acceptance server. No real model/tools or user data.
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "../server/index.js";
import { SkillsCodex } from "./skill-fixture.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-flow-"));
const codex = new SkillsCodex(directory);
for (const skill of codex.skills)
  if (!["code-review", "empty-skill"].includes(skill.name))
    skill.enabled = false;
const call = codex.call.bind(codex);
let starts = 0;
const plugin = {
  id: "flow-tools@local",
  name: "flow-tools",
  installed: true,
  enabled: true,
  availability: "AVAILABLE",
  installPolicy: "AVAILABLE",
  interface: { displayName: "资料检索与整理" },
};
codex.call = (async (method: any, p: any) => {
  if (method === "plugin/list")
    return {
      marketplaces: [
        { name: "local", path: "/fixture/marketplace.json", plugins: [plugin] },
      ],
      marketplaceLoadErrors: [],
    };
  if (method === "plugin/read")
    return { plugin: { summary: plugin, skills: [], mcpServers: [] } };
  if (method === "turn/start") {
    await new Promise((r) => setTimeout(r, 4500));
    if (
      p.input.some((i: any) => i.type === "text" && i.text === "测试发送失败")
    )
      throw new Error("测试服务暂时不可用，请重试");
  }
  const result: any = await call(method, p);
  if (method === "turn/start") {
    starts++;
    const id = result.turn.id;
    codex.item(
      p.threadId,
      id,
      {
        id: id + "-think",
        type: "reasoning",
        summary: [
          "先确认请求范围，再查看相关资料。这里是用于验收的合成思考摘要。",
        ],
        status: "completed",
      },
      true,
    );
    codex.item(p.threadId, id, {
      id: id + "-tool",
      type: "mcpToolCall",
      server: "test-server",
      tool: "search_notes",
      display: { toolTitle: "查找相关资料" },
      status: "inProgress",
    });
    codex.item(
      p.threadId,
      id,
      {
        id: id + "-commentary",
        type: "agentMessage",
        phase: "commentary",
        text: "合成进度说明：已开始核对工具结果。",
      },
      true,
    );
    // Lifecycle variety for icon/disclosure acceptance; none execute actual tools.
    for (const [type, status, extra] of [
      ["webSearch", "completed", {}],
      [
        "commandExecution",
        "failed",
        {
          command: "fixture-check",
          error: { message: "合成失败：用于检查错误状态" },
        },
      ],
      ["fileChange", "declined", {}],
      ["plan", "completed", {}],
      ["imageView", "completed", {}],
      ["imageGeneration", "completed", {}],
      ["collabAgentToolCall", "completed", {}],
      ["sleep", "completed", {}],
      ["contextCompaction", "completed", {}],
      ["futureActivity", "completed", {}],
    ] as const)
      codex.item(
        p.threadId,
        id,
        { id: id + "-" + type, type, status, ...extra },
        true,
      );
    let delta = 0;
    const thinking = setInterval(() => {
      if (
        codex.threads.get(p.threadId)?.turns.find((t: any) => t.id === id)
          ?.status !== "inProgress"
      ) {
        clearInterval(thinking);
        return;
      }
      codex.item(p.threadId, id, {
        id: id + "-think",
        type: "reasoning",
        summary: [
          "合成思考摘要：确认请求范围，逐步核对资料。流式更新 " + ++delta,
        ],
        status: "inProgress",
      });
    }, 3000);
    setTimeout(() => {
      if (
        codex.threads.get(p.threadId)?.turns.find((t: any) => t.id === id)
          ?.status !== "inProgress"
      )
        return;
      codex.item(
        p.threadId,
        id,
        {
          id: id + "-tool",
          type: "mcpToolCall",
          server: "test-server",
          tool: "search_notes",
          display: { toolTitle: "查找相关资料" },
          status: "completed",
          result: {
            content: [{ type: "text", text: "已找到相关资料（合成数据）。" }],
          },
        },
        true,
      );
      codex.item(
        p.threadId,
        id,
        {
          id: id + "-answer",
          type: "agentMessage",
          phase: "final_answer",
          text: "已完成这次检查。选中的能力保存在侧栏中，后续消息会继续使用。\n\n这是隔离测试服务的合成回答。",
        },
        true,
      );
      codex.finish(p.threadId);
    }, 8000);
  }
  return result;
}) as typeof codex.call;
const cwd = join(directory, "work");
mkdirSync(cwd);
const ctx = await createServer({
  providerRuntime: null,
  directory: join(directory, "app"),
  cwd,
  codex,
  password: "flow-fixture-login",
  origins: ["http://127.0.0.1:3152", "http://localhost:3152"],
  webDirectory: resolve(".data/grok-deep-web"),
});
await ctx.service.handle("expert/save", {
  name: "资料整理专家",
  description: "仅用于界面测试的合成专家",
  skillIds: [],
  pluginIds: [plugin.id],
  connectorIds: [],
});
ctx.app.get("/api/test/flow", async () => ({ starts }));
await ctx.app.listen({ host: "127.0.0.1", port: 3152 });
console.log("Chat flow fixture ready at http://127.0.0.1:3152");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void ctx.app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
