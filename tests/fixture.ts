import { Codex } from "../server/codex.js";
import type { Method, Params, Result } from "../server/protocol.js";
import type { Json } from "../shared/types.js";
import { randomUUID } from "node:crypto";
export class FakeCodex extends Codex {
  threads = new Map<string, Json>();
  modeConfigs = new Map<string, Json>();
  calls: { method: string; params: any }[] = [];
  constructor() {
    super("/tmp");
    this.state = "ready";
  }
  override async start() {
    this.state = "ready";
    this.emit("status");
  }
  override stop() {}
  override async inspectExtensions<M extends Method>(
    method: M,
    params: Params<M>,
    _overrides: Record<string, { enabled: boolean }> = {},
  ): Promise<Result<M>> {
    return this.call(method, params);
  }
  override async call<M extends Method>(
    method: M,
    params: Params<M>,
  ): Promise<Result<M>> {
    if (this.executionPolicy) params = await this.executionPolicy(method, params as Json) as Params<M>;
    this.calls.push({ method, params });
    const p = params as Json;
    let result: any = {};
    if (method === "model/list")
      result = {
        data: [
          {
            id: "fixture-model",
            model: "fixture-model",
            displayName: "测试模型",
            description: "仅用于自动化测试",
            isDefault: true,
            hidden: false,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [
              { reasoningEffort: "medium", description: "标准" },
            ],
          },
        ],
        nextCursor: null,
      };
    if (method === "config/read")
      result = {
        config: {
          model: "fixture-model",
          model_provider: "fixture",
          model_providers: {
            fixture: {
              env_key: "HIDDEN_KEY",
              api_key: "super-secret-DO-NOT-LEAK",
            },
          },
        },
      };
    if (method === "skills/list")
      result = { data: [{ cwd: "/tmp", skills: [], errors: [] }] };
    if (method === "mcpServerStatus/list")
      result = {
        data: [
          {
            name: "test-server",
            runtimeStatus: "ready",
            authStatus: "notLoggedIn",
            tools: {
              metrics: {
                name: "metrics",
                inputSchema: { type: "object" },
                _meta: {
                  ui: {
                    resourceUri: "ui://metrics",
                    visibility: ["model", "app"],
                  },
                },
              },
              danger: {
                name: "danger",
                inputSchema: { type: "object" },
                _meta: {
                  ui: {
                    resourceUri: "ui://other",
                    visibility: ["model"],
                  },
                },
              },
            },
            resources: [],
            resourceTemplates: [],
          },
        ],
        nextCursor: null,
      };
    if (method === "thread/start") {
      const id = randomUUID();
      const thread = {
        id,
        modelProvider: "fixture",
        status: { type: "idle" },
        name: null,
        preview: "",
        turns: [],
        updatedAt: Date.now() / 1000,
      };
      this.threads.set(id, thread);
      this.modeConfigs.set(id, p.config || {});
      result = { thread };
    }
    if (method === "thread/resume" && p.config) this.modeConfigs.set(p.threadId, p.config);
    if (method === "mcpServerStatus/list" && p.threadId && this.modeConfigs.get(p.threadId)?.sandbox_mode === "read-only") {
      const defs = this.modeConfigs.get(p.threadId)!.mcp_servers || {};
      result.data = result.data.map((s: Json) => ({...s, runtimeStatus: defs[s.name]?.enabled ? s.runtimeStatus : "disabled", tools: Object.fromEntries(Object.entries(s.tools).filter(([name]) => defs[s.name]?.enabled && defs[s.name]?.enabled_tools?.includes(name)))}));
    }
    if (method === "thread/read" || method === "thread/resume")
      result = { thread: this.threads.get(p.threadId) };
    if (
      method === "thread/turns/list" &&
      !this.threads.get(p.threadId)?.turns.length
    )
      throw new Error("not materialized yet");
    if (method === "thread/turns/list")
      result = {
        data: [...(this.threads.get(p.threadId)?.turns || [])].reverse(),
        nextCursor: null,
      };
    if (method === "thread/items/list")
      result = {
        data: (this.threads.get(p.threadId)?.turns || []).flatMap((t: Json) =>
          t.items.map((item: Json) => ({ turnId: t.id, item })),
        ),
        nextCursor: null,
      };
    if (method === "turn/start") {
      const turn = {
        id: randomUUID(),
        status: "inProgress",
        items: [],
        error: null,
      };
      this.threads.get(p.threadId)!.turns.push(turn);
      this.active.add(p.threadId);
      this.emit("event", {
        method: "turn/started",
        params: { threadId: p.threadId, turn },
      });
      this.item(
        p.threadId,
        turn.id,
        {
          id: randomUUID(),
          clientId: p.clientUserMessageId || null,
          type: "userMessage",
          content: p.input,
        },
        true,
      );
      result = { turn };
    }
    if (method === "turn/interrupt") this.finish(p.threadId, "interrupted");
    if (method === "mcpServer/resource/read")
      result = {
        contents: [
          {
            uri: p.uri,
            mimeType: "text/html;profile=mcp-app",
            text: "<html><body>Fixture app</body></html>",
          },
        ],
      };
    if (method === "mcpServer/tool/call")
      result = { content: [{ type: "text", text: "allowed" }] };
    return structuredClone(result) as Result<M>;
  }
  item(threadId: string, turnId: string, item: Json, completed = false) {
    const turn = this.threads
      .get(threadId)!
      .turns.find((t: Json) => t.id === turnId);
    const index = turn.items.findIndex((i: Json) => i.id === item.id);
    if (index < 0) turn.items.push(item);
    else turn.items[index] = item;
    this.emit("event", {
      method: completed ? "item/completed" : "item/started",
      params: { threadId, turnId, item },
    });
  }
  delta(threadId: string, turnId: string, itemId: string, delta: string) {
    const item = this.threads
      .get(threadId)!
      .turns.find((t: Json) => t.id === turnId)
      .items.find((i: Json) => i.id === itemId);
    item.text += delta;
    this.emit("event", {
      method: "item/agentMessage/delta",
      params: { threadId, turnId, itemId, delta },
    });
  }
  finish(threadId: string, status = "completed") {
    const turn = this.threads.get(threadId)!.turns.at(-1);
    turn.status = status;
    this.active.delete(threadId);
    this.emit("event", {
      method: "turn/completed",
      params: { threadId, turn },
    });
  }
}
