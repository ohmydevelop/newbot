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
  core = new ConfigCodex();
  installed = true;
  enabled = true;
  unloads: string[] = [];
  restarts = 0;
  constructor() {
    super(directory);
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
              text: "正在检查测试数据。",
            },
            true,
          ),
        20,
      );
      setTimeout(() => {
        this.item(
          threadId,
          turnId,
          {
            id: turnId + "-command",
            type: "commandExecution",
            command: "echo test",
            status: "completed",
            aggregatedOutput: "ok",
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
            text: "测试回复完成。",
          },
          true,
        );
        turn.completedAt = Date.now() / 1000;
        turn.durationMs = turn.completedAt * 1000 - turn.startedAt * 1000;
        this.finish(threadId);
      }, 1800);
    }
    return result;
  }
}
const codex = new IssueCodex(),
  ctx = await createServer({
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
