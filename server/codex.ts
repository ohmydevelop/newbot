import { runtimeLocations } from "./runner/locations.js";
import { LocalRunnerTransport } from "./runner/local-transport.js";
import type { RunnerTransport } from "./runner/transport.js";
import { publicFailure } from "./failure.js";
import type { ExtensionRuntime } from "./extension-runtime.js";
import { resolve } from "node:path";
import {
  approvalParameters,
  type ApprovalPreset,
} from "../shared/runtime-settings.js";
import { PublicError } from "./public-error.js";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { testMcpArgs } from "./test-mcp.js";
import { CODEX_VERSION } from "../generated/version.js";
import { prepareRuntimeIsolation } from "./runtime-isolation.js";
import type { ProviderRuntime } from "./provider-runtime.js";
import { volatileRuntimeLogs } from "./runtime-logs.js";
import type { Rpc, Json } from "../shared/types.js";
import type { ServerRequest } from "../generated/codex/ServerRequest.js";
import type { Method, Params, Result } from "./protocol.js";
import type { DynamicToolCallResponse } from "../generated/codex/v2/DynamicToolCallResponse.js";
export type ToolRequest = Extract<ServerRequest, { method: "item/tool/call" }>;
export class Codex extends EventEmitter {
  discoveryMarketplaces?: string[];
  discoveryPlugins?: Record<string, { enabled: boolean }>;
  get child(): ChildProcessWithoutNullStreams | undefined {
    return this.transport.child;
  }
  set child(child: ChildProcessWithoutNullStreams | undefined) {
    this.transport.child = child;
  }
  home?: string;
  userHome?: string;
  credentialSource?: () => Promise<NodeJS.ProcessEnv>;
  credentialRefs = new Set<string>();
  privateConfiguration?: (params: Json) => Promise<Json>;
  privateVersion?: (threadId?: string) => string;
  privateFieldInfo?: (
    scope: "provider" | "mcp",
    target: string,
    config: Json,
  ) => import("../shared/credentials.js").PrivateFieldView;
  privateRevisions = new Map<string, string>();
  providerRuntime?: ProviderRuntime;
  extensionRuntime?: ExtensionRuntime;
  pluginConfiguration?: (
    raw: import("../generated/codex/v2/ConfigReadResponse.js").ConfigReadResponse,
  ) => Promise<
    import("../generated/codex/v2/ConfigReadResponse.js").ConfigReadResponse
  >;
  executionContext?: (threadId: string) => {
    developerInstructions?: string;
    cwd: string;
    revision: string;
    config: Json;
  };
  threadExecutionRevisions = new Map<string, string>();
  threadConfigRevisions = new Map<string, string>();
  runtimeLogHome?: string;
  private logCleanup?: Promise<void>;
  pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
      method: string;
    }
  >();
  approvals = new Map<string | number, ServerRequest>();
  toolRequests = new Map<string | number, ToolRequest>();
  loaded = new Set<string>();
  active = new Set<string>();
  activeTurns = new Map<string, string>();
  runtimeCapabilities: Record<string, boolean> = {};
  state: "starting" | "ready" | "offline" = "offline";
  reason = "";
  private next = 0;
  private restarting?: Promise<void>;
  private extensionInspection: Promise<void> = Promise.resolve();
  constructor(
    readonly cwd: string,
    readonly extraEnv: () => NodeJS.ProcessEnv = () => ({}),
    readonly transport: RunnerTransport = new LocalRunnerTransport(),
  ) {
    super();
  }
  async start() {
    if (this.state === "starting" || this.state === "ready") return;
    this.state = "starting";
    this.reason = "";
    let testArgs: string[] = [];
    const extra = this.extraEnv();
    let isolated: Awaited<ReturnType<typeof prepareRuntimeIsolation>>;
    try {
      isolated = await prepareRuntimeIsolation(
        extra.CODEX_HOME ||
          process.env.NEWBOT_CODEX_HOME ||
          runtimeLocations().codex,
      );
      this.home = isolated.codexHome;
      this.userHome = isolated.userHome;
      testArgs = testMcpArgs();
      const version = await this.transport.version({
        binary: process.env.CODEX_BIN || resolve("node_modules/.bin/codex"),
        cwd: this.cwd,
        env: { ...codexEnvironment(process.env), ...extra, ...isolated.env },
      });
      if (version !== CODEX_VERSION)
        throw new Error(
          `Codex 版本与生成协议不一致，需使用 ${CODEX_VERSION}，或重新生成并测试协议`,
        );
    } catch (error) {
      this.offline(
        error instanceof PublicError
          ? error.message
          : "Codex 启动检查失败，请核对二进制版本与独立运行目录",
      );
      return;
    }
    let credentials: NodeJS.ProcessEnv;
    try {
      credentials = (await this.credentialSource?.()) || {};
    } catch {
      this.offline("凭证配置核对失败，请检查后重新连接");
      return;
    }
    const agentEnv = codexEnvironment(process.env);
    let logs: Awaited<ReturnType<typeof volatileRuntimeLogs>> | undefined;
    try {
      if (this.providerRuntime) logs = await volatileRuntimeLogs();
    } catch (error) {
      this.offline(
        error instanceof PublicError ? error.message : "原生诊断目录不可用",
      );
      return;
    }
    this.runtimeLogHome = logs?.path;
    this.transport.start(
      {
        binary: process.env.CODEX_BIN || resolve("node_modules/.bin/codex"),
        args: [
          "app-server",
          "--listen",
          "stdio://",
          "-c",
          "thread_unload_delay_secs=1",
          "-c",
          "project_root_markers=[]",
          "-c",
          "features.step_model_switching=true",
          "-c",
          'shell_environment_policy.inherit="core"',
          "-c",
          "shell_environment_policy.ignore_default_excludes=false",
          "-c",
          'cli_auth_credentials_store="file"',
          "-c",
          'mcp_oauth_credentials_store="file"',
          "-c",
          `sqlite_home=${JSON.stringify(isolated.codexHome)}`,
          ...(this.providerRuntime ? ["-c", 'model_provider="openai"'] : []),
          ...(logs ? ["-c", `log_dir=${JSON.stringify(logs.path)}`] : []),
          ...(process.env.MCP_OAUTH_CALLBACK_PORT &&
          process.env.MCP_OAUTH_CALLBACK_URL
            ? [
                "-c",
                `mcp_oauth_callback_port=${Number(process.env.MCP_OAUTH_CALLBACK_PORT)}`,
                "-c",
                `mcp_oauth_callback_url=${JSON.stringify(process.env.MCP_OAUTH_CALLBACK_URL)}`,
              ]
            : []),
          ...(this.discoveryMarketplaces || []).flatMap((path) => [
            "-c",
            'marketplaces.newbot-imports.source_type="local"',
            "-c",
            `marketplaces.newbot-imports.source=${JSON.stringify(path)}`,
          ]),
          ...(this.discoveryPlugins
            ? [
                "-c",
                `plugins={${Object.entries(this.discoveryPlugins)
                  .map(
                    ([id, value]) =>
                      `${JSON.stringify(id)} = { enabled = ${value.enabled}${(value as { local_root?: string }).local_root ? `, local_root = ${JSON.stringify((value as { local_root?: string }).local_root)}` : ""} }`,
                  )
                  .join(",")}}`,
              ]
            : []),
          ...testArgs,
        ],
        cwd: this.cwd,
        env: { ...agentEnv, ...extra, ...credentials, ...isolated.env },
      },
      {
        message: (message) => this.receive(message),
        offline: (reason) => this.offline(reason),
        closed: () => {
          if (logs) this.logCleanup = logs.close().catch(() => {});
        },
      },
    );
    this.credentialRefs = new Set(Object.keys(credentials));
    credentials = {};
    try {
      const initialized = await this.call("initialize", {
        clientInfo: {
          name: "newbot",
          title: "newbot",
          version: "0.2.0",
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      if (resolve(initialized.codexHome) !== isolated.codexHome)
        throw new PublicError("Codex 返回的运行目录与隔离目录不一致");
      this.runtimeCapabilities =
        (
          initialized as typeof initialized & {
            runtimeCapabilities?: Record<string, boolean>;
          }
        ).runtimeCapabilities || {};
      this.send({ method: "initialized" });
      this.state = "ready";
      this.emit("status");
    } catch {
      this.offline("Codex 初始化失败，请检查 Provider、配置和权限");
      this.transport.stop();
    }
  }
  offline(reason: string) {
    this.state = "offline";
    this.reason = reason;
    this.credentialRefs.clear();
    this.loaded.clear();
    this.threadConfigRevisions.clear();
    this.threadExecutionRevisions.clear();
    this.privateRevisions.clear();
    this.active.clear();
    this.activeTurns.clear();
    this.approvals.clear();
    this.toolRequests.clear();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new PublicError("Codex 连接中断"));
    }
    this.pending.clear();
    this.emit("status");
  }
  private receive(message: Rpc) {
    if (message.method && message.id !== undefined) {
      if (
        message.method === "item/tool/call" &&
        this.listenerCount("tool") > 0
      ) {
        this.toolRequests.set(message.id, message as ToolRequest);
        this.emit("tool", message);
        return;
      }
      if (
        /requestApproval$|requestUserInput$|elicitation\/request$/.test(
          message.method,
        )
      ) {
        this.approvals.set(message.id, message as ServerRequest);
        this.emit("approval", message);
      } else
        this.send({
          id: message.id,
          error: {
            code: -32601,
            message: "This client does not support this server request",
          },
        });
      return;
    }
    if (message.id !== undefined) {
      const p = this.pending.get(Number(message.id));
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(Number(message.id));
      message.error
        ? p.reject(
            p.method === "turn/settings/update"
              ? new PublicError(liveSettingsError(message.error.message))
              : new PublicError(
                  (() => {
                    return nativeRequestError(p.method, message.error);
                  })(),
                ),
          )
        : p.resolve(message.result);
      return;
    }
    if (!message.method) return;
    const params = message.params || {};
    if (message.method === "thread/closed") this.loaded.delete(params.threadId);
    if (message.method === "turn/started") {
      this.active.add(params.threadId);
      this.activeTurns.set(params.threadId, params.turn.id);
    }
    if (
      message.method === "turn/completed" &&
      (!this.activeTurns.has(params.threadId) ||
        this.activeTurns.get(params.threadId) === params.turn.id)
    ) {
      this.active.delete(params.threadId);
      this.activeTurns.delete(params.threadId);
    }
    if (message.method === "serverRequest/resolved") {
      this.approvals.delete(params.requestId);
      this.toolRequests.delete(params.requestId);
      this.emit("toolResolved", params.requestId);
    }
    if (
      /^(thread\/|turn\/|item\/|error$|serverRequest\/resolved$|mcpServer\/oauth\/login\/completed$)/.test(
        message.method,
      )
    )
      this.emit("event", message);
  }
  private send(message: Rpc) {
    this.transport.send(message);
  }
  async inspectExtensions<M extends Method>(
    method: M,
    params: Params<M>,
    overrides: Record<string, { enabled: boolean }> = {},
  ): Promise<Result<M>> {
    const previous = this.extensionInspection;
    let release!: () => void;
    this.extensionInspection = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await this.inspectExtensionsSerial(method, params, overrides);
    } finally {
      release();
    }
  }
  private async inspectExtensionsSerial<M extends Method>(
    method: M,
    params: Params<M>,
    overrides: Record<string, { enabled: boolean }>,
  ): Promise<Result<M>> {
    if (!this.home || this.state !== "ready")
      throw new PublicError("原生扩展目录未就绪");
    const probe = new Codex(this.cwd, () => ({ CODEX_HOME: this.home }));
    probe.discoveryMarketplaces = this.extensionRuntime?.marketplaceRoots();
    probe.discoveryPlugins = {
      ...Object.fromEntries(
        Object.entries(this.extensionRuntime?.nativePlugins() || {}).filter(
          ([, p]) => p.installed !== false,
        ),
      ),
      ...overrides,
    };
    for (const [id, pin] of Object.entries(
      this.extensionRuntime?.resources.pins() || {},
    ))
      if (probe.discoveryPlugins[id])
        Object.assign(probe.discoveryPlugins[id], pin);
    if (Buffer.byteLength(JSON.stringify(probe.discoveryPlugins)) > 96 * 1024)
      throw new PublicError("插件发现配置超过 96 KiB 预算");
    try {
      await probe.start();
      if (probe.state !== "ready") throw new PublicError("原生扩展检查未就绪");
      const roots = this.extensionRuntime?.resources.skillRoots() || [];
      if (roots.length)
        await probe.call("skills/extraRoots/set", { extraRoots: roots });
      return await probe.call(method, params);
    } finally {
      await probe.stopAndWait();
    }
  }
  async call<M extends Method>(
    method: M,
    params: Params<M>,
    timeout = 45000,
  ): Promise<Result<M>> {
    if (
      this.extensionRuntime &&
      ["skills/list", "plugin/list", "plugin/read"].includes(method)
    ) {
      this.extensionRuntime.overlay(
        await this.call("config/read", { cwd: this.cwd, includeLayers: true }),
      );
      return this.inspectExtensions(method, params);
    }
    let executionRevision: string | undefined;
    if (method === "thread/resume" && this.executionContext) {
      const p = params as Json,
        context = this.executionContext(p.threadId);
      params = {
        ...p,
        cwd: context.cwd,
        runtimeWorkspaceRoots: [context.cwd],
        ...(context.developerInstructions
          ? { developerInstructions: context.developerInstructions }
          : {}),
        config: { ...context.config, ...(p.config || {}) },
      } as Params<M>;
      executionRevision = context.revision;
    }
    let runtimeRevision: string | undefined;
    if (
      this.providerRuntime &&
      (method === "thread/start" || method === "thread/resume")
    ) {
      const p = params as Json;
      const provider =
        p.modelProvider ||
        this.providerRuntime.snapshot().values.model_provider ||
        "openai";
      const snapshot = this.providerRuntime.threadConfig(
        provider,
        p.providerConfigRevision,
      );
      const native = await this.call("config/read", {
        cwd: (params as Json).cwd || this.cwd,
        includeLayers: true,
      });
      if (
        provider !== "openai" &&
        (native.config.model_providers as any)?.[provider]
      )
        throw new PublicError(
          "此网关标识仍存在原生文件配置，请先迁移到内存模式",
        );
      const { providerConfigRevision: _, ...fields } = p;
      params = {
        ...fields,
        modelProvider: provider,
        config: { ...(p.config || {}), ...snapshot.config },
      } as Params<M>;
      runtimeRevision = snapshot.revision;
    }
    const privateRevision = this.privateVersion?.((params as Json)?.threadId);
    if (
      this.privateConfiguration &&
      ["thread/start", "thread/resume"].includes(method)
    )
      params = (await this.privateConfiguration(params as Json)) as Params<M>;
    if (
      runtimeRevision &&
      (runtimeRevision !== this.providerRuntime?.revision ||
        privateRevision !== this.privateVersion?.((params as Json)?.threadId))
    )
      throw new PublicError("运行配置已变化，请重试");
    if (
      this.home &&
      this.userHome &&
      [
        "config/value/write",
        "config/batchWrite",
        "skills/config/write",
        "plugin/install",
        "plugin/uninstall",
      ].includes(method)
    )
      await prepareRuntimeIsolation(this.home);
    return new Promise((resolve, reject) => {
      const id = ++this.next;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex 请求超时：${method}`));
      }, timeout);
      this.pending.set(id, {
        method,
        resolve: (result: any) => {
          if (privateRevision && result?.thread?.id)
            this.privateRevisions.set(result.thread.id, privateRevision);
          if (executionRevision !== undefined && result?.thread?.id)
            this.threadExecutionRevisions.set(
              result.thread.id,
              executionRevision,
            );
          if (runtimeRevision && result?.thread?.id) {
            this.threadConfigRevisions.set(result.thread.id, runtimeRevision);
            this.loaded.add(result.thread.id);
          }
          resolve(result);
        },
        reject,
        timer,
      });
      try {
        this.send({ id, method, params: params as Json });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  respond(id: string | number, result: Json) {
    if (!this.approvals.has(id)) throw new PublicError("审批已失效或已处理");
    this.send({ id, result });
    this.approvals.delete(id);
    this.emit("resolved", id);
  }
  respondTool(id: string | number, result: DynamicToolCallResponse) {
    if (!this.toolRequests.has(id))
      throw new PublicError("表单请求已失效或已处理");
    this.send({ id, result });
    this.toolRequests.delete(id);
  }
  async unload(id: string) {
    if (!this.loaded.has(id)) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new PublicError("线程卸载超时，请重新读取当前状态"));
      }, 10000);
      const listener = (message: Rpc) => {
        if (
          message.method === "thread/closed" &&
          message.params?.threadId === id
        ) {
          this.loaded.delete(id);
          cleanup();
          resolve();
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.off("event", listener);
      };
      this.on("event", listener);
      void this.call("thread/unsubscribe", { threadId: id })
        .then((result) => {
          if (result.status === "notLoaded") {
            this.loaded.delete(id);
            cleanup();
            resolve();
          }
        })
        .catch((error) => {
          cleanup();
          reject(error);
        });
    });
  }
  async resume(
    id: string,
    provider?: string,
    approval: ApprovalPreset = "ask",
    model?: string,
    providerConfigRevision?: string,
  ) {
    const context = this.executionContext?.(id);
    if (
      this.privateVersion &&
      this.loaded.has(id) &&
      !this.active.has(id) &&
      this.privateRevisions.get(id) !== this.privateVersion(id)
    )
      await this.unload(id);
    if (
      context &&
      this.loaded.has(id) &&
      !this.active.has(id) &&
      this.threadExecutionRevisions.get(id) !== context.revision
    )
      await this.unload(id);
    if (
      this.providerRuntime &&
      this.loaded.has(id) &&
      !this.active.has(id) &&
      this.threadConfigRevisions.get(id) !==
        (providerConfigRevision || this.providerRuntime.revision)
    )
      await this.unload(id);
    if (!this.loaded.has(id)) {
      const result = await this.call("thread/resume", {
        threadId: id,
        ...(context ? { cwd: context.cwd, config: context.config } : {}),
        modelProvider: provider,
        excludeTurns: true,
        model,
        approvalPolicy: approvalParameters(approval, context?.cwd || this.cwd)
          .approvalPolicy,
        approvalsReviewer: approvalParameters(
          approval,
          context?.cwd || this.cwd,
        ).approvalsReviewer,
        sandbox: approvalParameters(approval, context?.cwd || this.cwd).sandbox,
        ...(providerConfigRevision ? { providerConfigRevision } : {}),
      } as any);
      this.loaded.add(id);
      if (context) this.threadExecutionRevisions.set(id, context.revision);
      return result;
    }
  }
  async stopAndWait() {
    await this.transport.stopAndWait();
    await this.logCleanup;
  }
  restart(): Promise<void> {
    if (this.restarting) return this.restarting;
    this.restarting = (async () => {
      await this.stopAndWait();
      this.offline("Codex 正在重新连接");
      await this.start();
      if (this.state !== "ready")
        throw new PublicError("Codex 重启失败，请检查服务端配置");
    })().finally(() => {
      this.restarting = undefined;
    });
    return this.restarting;
  }
  stop() {
    this.transport.stop();
  }
}

export function nativeRequestError(method: string, error: unknown) {
  if (!["thread/start", "thread/resume", "turn/start"].includes(method))
    return "Codex 操作未完成，请检查该操作的配置与权限。";
  const failure = publicFailure(error);
  return failure.category === "unknown"
    ? "模型请求失败，未取得可识别的上游原因。请检查网关与服务端记录。"
    : `${failure.message}${failure.action}`;
}

export function liveSettingsError(message: string) {
  if (/verified route.*reasoning effort/.test(message))
    return "目标模型尚未通过所选推理强度的验证，原设置继续生效";
  if (/capabilities do not match/.test(message))
    return "模型能力记录与当前网关或模型不一致，请重新选择；原设置继续生效";
  if (/context budget|history size/.test(message))
    return "现有上下文超出目标模型的已确认容量，原设置继续生效";
  if (/input modality|history format/.test(message))
    return "目标模型不能完整接收现有对话内容，原设置继续生效";
  if (/active model.*fallback metadata/.test(message))
    return "当前任务使用的模型缺少可靠的能力资料，无法在任务中切换。请等待任务结束，或停止后再选择模型；原设置未改变。";
  if (/fallback metadata/.test(message))
    return "目标模型缺少可靠的能力资料，无法在任务中切换。请等待任务结束或停止后再选择；目录中存在该模型不代表它支持聊天与工具调用。原设置未改变。";
  if (/opaque compaction|readable history/.test(message))
    return "当前上下文含网关专用的压缩内容，无法安全地切换网关";
  if (/stale model route/.test(message)) return "此设置已被更新的选择替代";
  if (/managed policy|Guardian|review|authority|restriction/.test(message))
    return "目标模型与当前任务的权限约束不兼容，原设置继续生效";
  if (/feature/.test(message)) return "当前运行内核未启用任务内模型更新";
  if (/provider/.test(message))
    return "目标网关配置未通过原生验证，原设置继续生效";
  return "运行中设置未被接受，原设置继续生效";
}

// This App Server is an independent client, including when newbot is launched by a coding agent.
export function codexEnvironment(environment: NodeJS.ProcessEnv) {
  const hosted = new Set([
    "CODEX_ACCESS_TOKEN",
    "NEWBOT_RUNTIME_CONFIG_TOKEN",
    "NEWBOT_RUNTIME_CONFIG_URL",
    "CODEX_AUTH_JSON",
    "CODEX_APP_TOOLS_PIPE_PATH",
    "CODEX_THREAD_ID",
    "CODEX_SESSION_ID",
    "CODEX_TOOL_CALL_ID",
    "CODEX_TECTONIC_PATH",
    "CODEX_APP_RUNTIME_CLI_PATH",
    "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
    "CODEX_TASK_WORKSPACE_VERIFYING_IDENTITY",
    "CODEX_SAGE_BACKFILL_TRACKER_TAB_REUSE",
  ]);
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) =>
        key !== "ADMIN_PASSWORD" &&
        !key.startsWith("NEWBOT_CREDENTIAL_KEY_") &&
        !hosted.has(key),
    ),
  );
}
