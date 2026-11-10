import { resolve } from "node:path";
import {
  approvalParameters,
  type ApprovalPreset,
} from "../shared/runtime-settings.js";
import { PublicError } from "./public-error.js";
import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createInterface } from "node:readline";
import { EventEmitter } from "node:events";
import { promisify } from "node:util";
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
  child?: ChildProcessWithoutNullStreams;
  home?: string;
  userHome?: string;
  credentialSource?: () => Promise<NodeJS.ProcessEnv>;
  credentialRefs = new Set<string>();
  providerRuntime?: ProviderRuntime;
  threadConfigRevisions = new Map<string, string>();
  runtimeLogHome?: string;
  private logCleanup?: Promise<void>;
  pending = new Map<
    number,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  approvals = new Map<string | number, ServerRequest>();
  toolRequests = new Map<string | number, ToolRequest>();
  loaded = new Set<string>();
  active = new Set<string>();
  state: "starting" | "ready" | "offline" = "offline";
  reason = "";
  private next = 0;
  private restarting?: Promise<void>;
  constructor(
    readonly cwd: string,
    readonly extraEnv: () => NodeJS.ProcessEnv = () => ({}),
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
          resolve(process.env.DATA_DIR || ".data", "codex"),
      );
      this.home = isolated.codexHome;
      this.userHome = isolated.userHome;
      testArgs = testMcpArgs();
      const { stdout } = await promisify(execFile)(
        process.env.CODEX_BIN || resolve("node_modules/.bin/codex"),
        ["--version"],
        {
          timeout: 5000,
          env: { ...codexEnvironment(process.env), ...extra, ...isolated.env },
        },
      );
      if (stdout.trim() !== CODEX_VERSION)
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
    const child = spawn(
      process.env.CODEX_BIN || resolve("node_modules/.bin/codex"),
      [
        "app-server",
        "--listen",
        "stdio://",
        "-c",
        "thread_unload_delay_secs=1",
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
        ...testArgs,
      ],
      {
        cwd: this.cwd,
        env: { ...agentEnv, ...extra, ...credentials, ...isolated.env },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.credentialRefs = new Set(Object.keys(credentials));
    credentials = {};
    this.child = child;
    child.stdin.on("error", () => {
      if (this.child === child) this.offline("Codex 输入管道已关闭");
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      try {
        if (this.child === child) this.receive(JSON.parse(line));
      } catch {
        /* A malformed subprocess line is never forwarded. */
      }
    });
    child.stderr.on("data", () => {}); // Never forward environment, auth diagnostics, or credentials to the browser.
    child.on("error", () => {
      if (logs) this.logCleanup = logs.close().catch(() => {});
      if (this.child === child)
        this.offline("Codex 子进程启动失败，请检查服务端配置");
    });
    child.on("exit", () => {
      if (logs) this.logCleanup = logs.close().catch(() => {});
      if (this.child === child)
        this.offline("Codex 进程已退出；任务状态需要重新读取");
    });
    try {
      const initialized = await this.call("initialize", {
        clientInfo: {
          name: "minimal_agent",
          title: "Minimal Agent",
          version: "0.2.0",
        },
        capabilities: { experimentalApi: true, requestAttestation: false },
      });
      if (resolve(initialized.codexHome) !== isolated.codexHome)
        throw new PublicError("Codex 返回的运行目录与隔离目录不一致");
      this.send({ method: "initialized" });
      this.state = "ready";
      this.emit("status");
    } catch {
      this.offline("Codex 初始化失败，请检查 Provider、配置和权限");
      child.kill();
    }
  }
  offline(reason: string) {
    this.state = "offline";
    this.reason = reason;
    this.credentialRefs.clear();
    this.loaded.clear();
    this.threadConfigRevisions.clear();
    this.active.clear();
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
            new Error(
              `Codex 操作失败：请求 ${message.id}，请检查 Provider、配置和权限`,
            ),
          )
        : p.resolve(message.result);
      return;
    }
    if (!message.method) return;
    const params = message.params || {};
    if (message.method === "thread/closed") this.loaded.delete(params.threadId);
    if (message.method === "turn/started") this.active.add(params.threadId);
    if (message.method === "turn/completed")
      this.active.delete(params.threadId);
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
    if (!this.child?.stdin.writable) throw new PublicError("Codex 未连接");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }
  async call<M extends Method>(
    method: M,
    params: Params<M>,
    timeout = 45000,
  ): Promise<Result<M>> {
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
        cwd: this.cwd,
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
        resolve: (result: any) => {
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
        modelProvider: provider,
        excludeTurns: true,
        model,
        approvalPolicy: approvalParameters(approval, this.cwd).approvalPolicy,
        approvalsReviewer: approvalParameters(approval, this.cwd)
          .approvalsReviewer,
        sandbox: approvalParameters(approval, this.cwd).sandbox,
        ...(providerConfigRevision ? { providerConfigRevision } : {}),
      } as any);
      this.loaded.add(id);
      return result;
    }
  }
  async stopAndWait() {
    const child = this.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
        const deadline = setTimeout(
          () => reject(new PublicError("Codex 进程未能停止")),
          10000,
        );
        child.once("exit", () => {
          clearTimeout(timer);
          clearTimeout(deadline);
          resolve();
        });
        child.kill("SIGTERM");
      });
    }
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
    this.child?.kill("SIGTERM");
  }
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
