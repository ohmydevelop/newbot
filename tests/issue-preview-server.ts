import { mediaFixture } from "./media-fixture.js";
// Issue acceptance fixture: all models, files and plugins are local/synthetic.
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { SkillsCodex } from "./skill-fixture.js";
import { ConfigCodex } from "./config-fixture.js";
import { ProviderRuntime } from "../server/provider-runtime.js";
import { providerParameter } from "../server/provider-runtime.js";
import type { Method, Params, Result } from "../server/protocol.js";
const port = Number(process.env.ISSUE_TEST_PORT || 3140),
  origin = `http://127.0.0.1:${port}`,
  directory = mkdtempSync(join(tmpdir(), "newbot-issue-ui-"));
class IssueCodex extends SkillsCodex {
  override respondTool(id: string | number, response: any) {
    const request = this.toolRequests.get(id)!;
    this.toolRequests.delete(id);
    this.item(
      request.params.threadId,
      request.params.turnId,
      {
        id: request.params.callId,
        type: "dynamicToolCall",
        tool: request.params.tool,
        arguments: request.params.arguments,
        status: response.success ? "completed" : "failed",
        contentItems: response.contentItems,
        success: response.success,
      },
      true,
    );
  }
  core = new ConfigCodex();
  installed = true;
  enabled = true;
  unloads: string[] = [];
  restarts = 0;
  failResume = false;
  constructor() {
    super(directory);
    // The browser fixture lists malformed documents for read-error cases; they are not executable extensions.
    for (const skill of this.skills)
      if (
        ["invalid-skill", "oversized-skill", "linked-skill"].includes(
          skill.name,
        )
      )
        skill.enabled = false;
    this.home = join(directory, "codex");
    mkdirSync(this.home, { recursive: true });
    const personal = join(this.home, "skills", "personal-note", "SKILL.md");
    mkdirSync(join(this.home, "skills", "personal-note"), { recursive: true });
    writeFileSync(
      personal,
      "# Personal note\n\nA removable standalone fixture skill.\n",
    );
    this.skills.push({
      name: "personal-note",
      description: "可卸载的独立个人技能",
      path: personal,
      scope: "user",
      enabled: true,
      pluginId: null,
    });
    this.core.config = {
      model: "fixture-model",
      model_provider: "fixture",
      model_reasoning_effort: "medium",
      model_providers: {
        fixture: {
          name: "测试网关",
          base_url: origin + "/fixture/provider-a",
          wire_api: "responses",
          requires_openai_auth: false,
        },
        secondary: {
          name: process.env.ISSUE_RICH_UI
            ? "第二网关 · 用于验证长名称在窄列中保持对齐"
            : "第二网关",
          base_url: origin + "/fixture/provider-b",
          wire_api: "responses",
          requires_openai_auth: false,
        },
      },
      mcp_servers: {
        "test-server": { command: "node", enabled: true },
        offline: { command: "node", enabled: false },
      },
    };
    this.on("event", (m) => {
      if (m.method === "turn/started")
        m.params.turn.startedAt = Date.now() / 1000;
    });
    this.skills[0].description = "超长摘要。".repeat(100);
  }
  override async restart() {
    this.restarts++;
    this.state = "ready";
    if (this.credentialSource)
      this.credentialRefs = new Set(Object.keys(await this.credentialSource()));
  }
  override async unload(id: string) {
    this.unloads.push(id);
    this.loaded.delete(id);
  }
  override async call<M extends Method>(
    method: M,
    params: Params<M>,
  ): Promise<Result<M>> {
    const p = params as any;
    if (method === "thread/resume" && this.failResume)
      throw new Error("Synthetic settings failure");
    if (method === "config/read" || method === "config/batchWrite") {
      const r = await this.core.call(method, params);
      if (method === "config/batchWrite")
        for (const e of p.edits)
          if (e.keyPath.startsWith("plugins.")) this.enabled = e.value;
      return r;
    }
    const summary = () => ({
      id: "test-plugin@local",
      name: "test-plugin",
      installed: this.installed,
      enabled: this.enabled,
      availability: "AVAILABLE",
      installPolicy: "AVAILABLE",
      interface: { displayName: "测试插件", shortDescription: "原生插件夹具" },
    });
    if (method === "plugin/list")
      return {
        marketplaces: [
          {
            name: "local",
            path: "/fixture/marketplace.json",
            plugins: [
              summary(),
              ...(process.env.ISSUE_RICH_UI
                ? Array.from({ length: 12 }, (_, i) => ({
                    ...summary(),
                    id: `extra-${i}@local`,
                    name: `extra-${i}`,
                    interface: {
                      displayName: `测试扩展 ${i}`,
                      shortDescription: "搜索与滚动测试",
                    },
                  }))
                : []),
            ],
          },
        ],
        marketplaceLoadErrors: [],
      } as any;
    if (method === "plugin/read")
      return {
        plugin: {
          summary: summary(),
          description: "插件详细说明",
          skills: [
            {
              name: this.skills[0].name,
              path: this.skills[0].path,
              enabled: true,
              description: "审查技能",
            },
          ],
          mcpServers: ["test-server"],
        },
      } as any;
    if (method === "plugin/install") this.installed = true;
    if (method === "plugin/uninstall") this.installed = false;
    if (method === "configRequirements/read")
      return { requirements: null } as any;
    const result = (await super.call(method, params)) as any;
    if (method === "model/list" && process.env.ISSUE_RICH_UI) {
      result.data[0].supportedReasoningEfforts = [
        "low",
        "medium",
        "high",
        "xhigh",
        "max",
        "ultra",
      ].map((reasoningEffort) => ({
        reasoningEffort,
        description: reasoningEffort,
      }));
    }
    if (method === "skills/list")
      for (const entry of result.data)
        entry.skills = entry.skills.filter((s: { path: string }) =>
          existsSync(s.path),
        );
    if (method === "mcpServerStatus/list")
      for (const server of result.data)
        if (server.name === "test-server")
          server.pluginId = "test-plugin@local";
    if (method === "thread/start") {
      result.thread.modelProvider = p.modelProvider || "fixture";
      result.modelProvider = result.thread.modelProvider;
    }
    if (method === "thread/resume") {
      result.thread.modelProvider =
        p.modelProvider || result.thread.modelProvider;
      result.modelProvider = result.thread.modelProvider;
    }
    if (method === "turn/start") {
      const threadId = p.threadId,
        turnId = result.turn.id;
      const turn = this.threads.get(threadId)!.turns.at(-1);
      turn.startedAt = Date.now() / 1000;
      turn.completedAt = null;
      setTimeout(
        () =>
          this.item(
            threadId,
            turnId,
            {
              id: turnId + "-process",
              type: "agentMessage",
              phase: "commentary",
              text: process.env.ISSUE_FEEDBACK_HISTORY
                ? "正在检查测试数据。\n\n".repeat(20)
                : "正在检查测试数据。",
            },
            true,
          ),
        20,
      );
      setTimeout(
        () => {
          this.item(
            threadId,
            turnId,
            {
              id: turnId + "-command",
              type: "commandExecution",
              command: "echo test",
              status: "completed",
              aggregatedOutput: process.env.ISSUE_FEEDBACK_HISTORY
                ? "fixture output\n".repeat(2000)
                : "ok",
            },
            true,
          );
          this.item(
            threadId,
            turnId,
            {
              id: turnId + "-answer",
              type: "agentMessage",
              phase: "final_answer",
              text: process.env.ISSUE_FEEDBACK_HISTORY
                ? "测试回复完成。\n\n".repeat(30)
                : "测试回复完成。",
            },
            true,
          );
          turn.completedAt = Date.now() / 1000;
          turn.durationMs = turn.completedAt * 1000 - turn.startedAt * 1000;
          this.finish(threadId);
        },
        Number(process.env.ISSUE_TURN_MS) ||
          (process.env.ISSUE_ACTIVITY_UI ? 6000 : 1800),
      );
    }
    return result;
  }
}
const codex = new IssueCodex(),
  ctx = await createServer({
    webDirectory: process.env.UI_TEST_CANDIDATE,
    providerRuntime: process.env.ISSUE_MEMORY_PROVIDERS
      ? new ProviderRuntime(codex.core.config)
      : null,
    directory,
    cwd: join(directory, "work"),
    codex,
    password: "issue-fixture-login",
    origins: [origin],
  });
for (const path of ["/fixture/provider-a/models", "/fixture/provider-b/models"])
  ctx.app.get(path, async () => ({
    data: [
      { id: "fixture-model" },
      { id: "secondary-model" },
      ...(process.env.ISSUE_RICH_UI
        ? Array.from({ length: 20 }, (_, i) => ({
            id: `fixture-large-model-${i}-long-context`,
          }))
        : []),
    ],
  }));
ctx.app.get("/api/test/issue", async () => ({
  providerStorage: ctx.runtime.providerRuntime?.storage || "native",
  persistedProviderNames: Object.values(
    JSON.parse(
      (
        ctx.db.raw
          .prepare("SELECT content FROM provider_configuration WHERE id=1")
          .get() as { content: string } | undefined
      )?.content || "{}",
    ).model_providers || {},
  ).map((p: any) => p.name),
  providerWrites: codex.core.calls.filter(
    (c) =>
      c.method === "config/batchWrite" &&
      c.params.edits.some((e: any) => providerParameter(e.keyPath)),
  ).length,
  restarts: codex.restarts,
  unloads: codex.unloads,
  calls: codex.calls
    .filter((c) => c.method === "turn/start")
    .map((c) => c.params),
}));
if (process.env.ISSUE_WORKSPACE_UI)
  ctx.app.post("/api/test/workspace", async (req) => {
    const { threadId, label } = req.body as { threadId: string; label: string };
    const root = ctx.workspaces.root(threadId);
    writeFileSync(join(root, "same.txt"), `Workspace ${label}`);
    writeFileSync(
      join(root, label === "A" ? "only-a.txt" : "only-b.txt"),
      label,
    );
    return {};
  });
// Only this isolated fixture exposes deterministic native lifecycle transitions.
if (process.env.ISSUE05_UI)
  ctx.app.post("/api/test/media", async (req) => {
    const { threadId } = req.body as any;
    const turn = codex.threads.get(threadId)!.turns.at(-1)!;
    const png = mediaFixture();
    writeFileSync(join(ctx.workspaces.root(threadId), "sample.png"), png);
    codex.item(
      threadId,
      turn.id,
      {
        id: "native-image",
        type: "imageGeneration",
        status: "completed",
        result: png.toString("base64"),
      },
      true,
    );
    codex.item(
      threadId,
      turn.id,
      {
        id: "mcp-image",
        type: "mcpToolCall",
        status: "completed",
        server: "fixture",
        tool: "image",
        result: {
          content: [
            {
              type: "image",
              data: png.toString("base64"),
              mimeType: "image/png",
            },
          ],
        },
      },
      true,
    );
    codex.item(
      threadId,
      turn.id,
      {
        id: "image-answer",
        type: "agentMessage",
        phase: "final",
        text: '图片快照示例。\n\n![工作区图片](sample.png)\n\n![缺失图片](missing.png)\n\n```echarts\n{"xAxis":{"type":"category","data":["A","B"]},"yAxis":{},"series":[{"type":"bar","data":[12,24]}]}\n```',
      },
      true,
    );
    const request: any = {
      id: "rich-ui",
      method: "item/tool/call",
      params: {
        threadId,
        turnId: turn.id,
        callId: "rich-ui",
        namespace: null,
        tool: "newbot_ui",
        arguments: {
          waitForAction: false,
          messages: [
            {
              version: "v0.9",
              createSurface: { surfaceId: "rich", catalogId: "newbot:ui/v2" },
            },
            {
              version: "v0.9",
              updateComponents: {
                surfaceId: "rich",
                components: [
                  {
                    id: "root",
                    component: "Column",
                    children: ["metric", "image", "source"],
                  },
                  {
                    id: "metric",
                    component: "Metric",
                    label: "CPU 使用率",
                    value: "12%",
                    detail: "示例测量数据",
                  },
                  {
                    id: "image",
                    component: "Image",
                    source: "sample.png",
                    alt: "卡片图片",
                  },
                  {
                    id: "source",
                    component: "SourceLink",
                    label: "数据来源",
                    url: "https://example.com",
                  },
                ],
              },
            },
          ],
        },
      },
    };
    codex.item(threadId, turn.id, {
      id: "rich-ui",
      type: "dynamicToolCall",
      tool: "newbot_ui",
      status: "inProgress",
    });
    codex.toolRequests.set(request.id, request);
    await ctx.service.ui.handle(request);
    return {};
  });
if (process.env.ISSUE05_UI)
  ctx.app.post("/api/test/process", async (req) => {
    const { threadId, count = 1, offset = 0 } = req.body as any;
    const turn = codex.threads.get(threadId)?.turns.at(-1);
    if (!turn) throw new Error("Unknown fixture turn");
    for (let n = offset; n < offset + count; n++)
      codex.item(
        threadId,
        turn.id,
        {
          id: `${turn.id}-step-${n}`,
          type: n % 2 ? "commandExecution" : "mcpToolCall",
          status: "completed",
          command: `echo step-${n}`,
          aggregatedOutput: "fixture output\n".repeat(12),
          server: "fixture",
          tool: `inspect_${n}`,
          arguments: { step: n },
          result: { content: [{ type: "text", text: "Synthetic step" }] },
        },
        true,
      );
    return {};
  });
if (process.env.ISSUE_ACTIVITY_UI)
  ctx.app.post("/api/test/runtime", async (req) => {
    codex.failResume = (req.body as any).failResume === true;
    return {};
  });
if (process.env.ISSUE_ACTIVITY_UI)
  ctx.app.post("/api/test/activity", async (req) => {
    const { threadId, state } = req.body as any;
    const turn = codex.threads.get(threadId)?.turns.at(-1);
    if (!turn) throw new Error("Unknown fixture turn");
    if (state === "waiting")
      codex.emit("approval", {
        id: 900,
        method: "item/commandExecution/requestApproval",
        params: { threadId, turnId: turn.id, command: "fixture" },
      });
    else if (state === "running") codex.emit("resolved", 900);
    else if (state === "unknown") ctx.service.activity.offline();
    else if (["completed", "failed", "interrupted"].includes(state))
      codex.finish(threadId, state);
    return {};
  });
await ctx.app.listen({ host: "127.0.0.1", port });
console.log("Issue UI fixture ready");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void ctx.app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
