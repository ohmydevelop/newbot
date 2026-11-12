import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Codex } from "../codex.js";
import { PublicError } from "../public-error.js";
import { LocalRunnerTransport } from "./local-transport.js";
import { LocalWorkspaceRoots } from "./workspace-roots.js";
import { RunnerLedger } from "./ledger.js";
import { volatileRuntimeLogs } from "../runtime-logs.js";
import {
  canonicalPacket,
  runtimeMethods,
  type RunnerCommand,
} from "../../shared/runner-control.js";
import type { Rpc } from "../../shared/types.js";
import type { RunnerStart } from "./transport.js";
/** Standalone node lane. Resource synchronization must be implemented before enabling plugin/file inputs. */
export class NativeRunnerAgent {
  readonly codex: Codex;
  readonly roots: LocalWorkspaceRoots;
  private early = new Map<string, Rpc[]>();
  private logs?: Awaited<ReturnType<typeof volatileRuntimeLogs>>;
  private failure?: Error;
  private closing = false;
  private stopped?: Promise<void>;
  private starting?: Promise<void>;
  private earlyBytes = 0;
  constructor(
    readonly ledger: RunnerLedger,
    home: string,
    workspaceRoot: string,
    binary: string,
  ) {
    this.roots = new LocalWorkspaceRoots(workspaceRoot);
    const cwd = join(home, "bootstrap");
    mkdirSync(cwd, { recursive: true, mode: 0o700 });
    const owner = this;
    class Transport extends LocalRunnerTransport {
      constructor() {
        super(true);
      }
      override version(spec: Omit<RunnerStart, "args">) {
        return super.version({ ...spec, binary });
      }
      override start(
        spec: RunnerStart,
        handlers: Parameters<LocalRunnerTransport["start"]>[1],
      ) {
        super.start(
          {
            ...spec,
            binary,
            args: [
              ...spec.args,
              "-c",
              `log_dir=${JSON.stringify(owner.logs!.path)}`,
            ],
          },
          handlers,
        );
      }
    }
    this.codex = new Codex(cwd, () => ({ CODEX_HOME: home }), new Transport());
    this.codex.on("event", (message: Rpc) =>
      this.capture("notification", message),
    );
    this.codex.on("approval", (message: Rpc) =>
      this.capture("request", message),
    );
    this.codex.on("tool", (message: Rpc) => this.capture("request", message));
    this.codex.on("status", () => {
      if (this.codex.state === "offline" && !this.closing)
        this.failure = new PublicError("执行节点原生运行时已离线");
    });
  }
  private capture(kind: "notification" | "request", message: Rpc) {
    try {
      const id = message.params?.threadId || message.params?.thread?.id;
      const scope = id && this.ledger.threadScope(id);
      if (id && !scope) {
        const list = this.early.get(id) || [];
        if (
          list.length >= 128 ||
          (!this.early.has(id) && this.early.size >= 16)
        )
          throw new PublicError("未绑定线程事件超过预算");
        this.earlyBytes += Buffer.byteLength(canonicalPacket(message));
        if (this.earlyBytes > 8 * 1024 * 1024)
          throw new PublicError("未绑定线程事件超过预算");
        list.push(message);
        this.early.set(id, list);
        return;
      }
      this.ledger.event(kind, scope || "runtime", message);
    } catch {
      this.failure = new PublicError("节点事件无法持久化，已停止原生运行时");
      this.codex.stop();
    }
  }
  start() {
    return (this.starting ||= (async () => {
      if (this.closing) throw new PublicError("执行节点正在停止");
      this.logs = await volatileRuntimeLogs();
      if (this.closing) throw new PublicError("执行节点正在停止");
      await this.codex.start();
      if (this.closing) {
        await this.codex.stopAndWait();
        throw new PublicError("执行节点正在停止");
      }
      if (this.codex.state !== "ready")
        throw new PublicError(this.codex.reason);
    })());
  }
  health() {
    if (this.failure) throw this.failure;
  }
  stop() {
    return (this.stopped ||= (async () => {
      this.closing = true;
      this.codex.stop();
      await this.starting?.catch(() => {});
      await this.codex.stopAndWait();
      await this.logs?.close();
    })());
  }
  async perform(command: RunnerCommand): Promise<unknown> {
    if (this.failure) throw this.failure;
    const { method, scope } = command,
      p = structuredClone(command.params) as any;
    if (runtimeMethods.has(method)) {
      if (scope !== "runtime")
        return { error: { message: "运行时查询需要节点作用域" } };
    } else if (scope === "runtime")
      return { error: { message: "此操作需要明确的会话工作区" } };
    if (method === "runner/approval" || method === "runner/toolResult") {
      const requests =
        method === "runner/approval"
          ? this.codex.approvals
          : this.codex.toolRequests;
      const request = requests.get(p.requestId);
      if (
        !request ||
        this.ledger.threadScope((request.params as any).threadId) !== scope
      )
        return { error: { message: "审批请求已失效或不属于当前会话" } };
      if (method === "runner/approval")
        this.codex.respond(p.requestId, p.result);
      else this.codex.respondTool(p.requestId, p.result);
      return { accepted: true };
    }
    if (
      !runtimeMethods.has(method) &&
      method !== "thread/start" &&
      this.ledger.threadScope(p.threadId) !== scope
    )
      return {
        error: {
          message: "原生线程不属于此工作区；冷恢复需要先导入已验证的检查点",
        },
      };
    // No unreviewed physical paths cross the node boundary. These arrive later as resource identities.
    for (const key of [
      "path",
      "history",
      "selectedCapabilityRoots",
      "environments",
      "permissions",
    ])
      if (p[key] != null)
        return { error: { message: "此节点通道尚不支持该资源输入：" + key } };
    if (p.input?.some((i: any) => i.type !== "text"))
      return { error: { message: "远程文件和扩展引用尚未同步" } };
    if (p.config) {
      const allowed = new Set([
        "model_provider",
        "model_providers",
        "model",
        "model_reasoning_effort",
      ]);
      if (Object.keys(p.config).some((k) => !allowed.has(k)))
        return { error: { message: "此节点通道尚未开放扩展与文件配置" } };
    }
    if (method === "thread/start")
      mkdirSync(join(this.roots.parent, scope), {
        recursive: true,
        mode: 0o700,
      });
    if (["thread/start", "thread/resume", "turn/start"].includes(method)) {
      const cwd = this.roots.resolve(scope);
      p.cwd = cwd;
      p.runtimeWorkspaceRoots = [cwd];
      if (method !== "turn/start") {
        p.config = {
          ...p.config,
          memories: { use_memories: false, generate_memories: false },
          plugins: { _default: { enabled: false } },
        };
      }
      if (p.sandboxPolicy?.type === "workspaceWrite")
        p.sandboxPolicy.writableRoots = [cwd];
    }
    const result = (await this.codex.call(method as any, p)) as any;
    if (method === "thread/start") {
      this.ledger.bindThread(result.thread.id, scope);
      for (const event of this.early.get(result.thread.id) || [])
        this.capture(
          event.id === undefined ? "notification" : "request",
          event,
        );
      for (const event of this.early.get(result.thread.id) || [])
        this.earlyBytes -= Buffer.byteLength(canonicalPacket(event));
      this.early.delete(result.thread.id);
    }
    return result;
  }
}
