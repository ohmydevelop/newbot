import { promisify } from "node:util";
import {
  spawn,
  execFile,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { createInterface } from "node:readline";
import { PublicError } from "../public-error.js";
import { encodeRpc } from "../protocol.js";
import type { Rpc } from "../../shared/types.js";
import type { RunnerStart, RunnerTransport } from "./transport.js";
// Existing product operations only; new upstream methods need an explicit review.
export const RUNNER_METHODS = new Set([
  "initialize",
  "initialized",
  "config/read",
  "config/batchWrite",
  "config/value/write",
  "config/mcpServer/reload",
  "configRequirements/read",
  "model/list",
  "hooks/list",
  "plugin/install",
  "marketplace/add",
  "plugin/list",
  "plugin/read",
  "plugin/uninstall",
  "skills/list",
  "skills/config/write",
  "skills/extraRoots/set",
  "mcpServerStatus/list",
  "mcpServer/oauth/login",
  "mcpServer/resource/read",
  "mcpServer/tool/call",
  "thread/start",
  "thread/read",
  "thread/resume",
  "thread/list",
  "thread/items/list",
  "thread/turns/list",
  "thread/settings/update",
  "thread/name/set",
  "thread/archive",
  "thread/unarchive",
  "thread/unsubscribe",
  "turn/start",
  "turn/interrupt",
  "turn/settings/update",
]);
export class LocalRunnerTransport implements RunnerTransport {
  child?: ChildProcessWithoutNullStreams;
  constructor(private readonly processGroup = false) {}
  async version(spec: Omit<RunnerStart, "args">) {
    const { stdout } = await promisify(execFile)(spec.binary, ["--version"], {
      cwd: spec.cwd,
      env: spec.env,
      timeout: 5000,
      maxBuffer: 16 * 1024,
    });
    return stdout.trim();
  }
  start(spec: RunnerStart, handlers: Parameters<RunnerTransport["start"]>[1]) {
    if (
      this.child &&
      this.child.exitCode === null &&
      this.child.signalCode === null
    )
      throw new PublicError("执行节点已经启动");
    const child = spawn(spec.binary, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: this.processGroup,
    });
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (this.child !== child) return;
      try {
        const value = JSON.parse(line);
        if (value && typeof value === "object" && !Array.isArray(value))
          handlers.message(value);
      } catch {
        /* Never forward malformed native output or logs. */
      }
    });
    child.stderr.on("data", () => {});
    child.stdin.on("error", () => {
      if (this.child === child) handlers.offline("Codex 输入管道已关闭");
    });
    child.on("error", () => {
      if (this.child === child) {
        handlers.closed();
        handlers.offline("Codex 子进程启动失败，请检查服务端配置");
      }
    });
    child.on("exit", () => {
      lines.close();
      if (this.child === child) {
        handlers.closed();
        handlers.offline("Codex 进程已退出；任务状态需要重新读取");
      }
    });
  }
  send(message: Rpc) {
    if (message.method && !RUNNER_METHODS.has(message.method))
      throw new PublicError("执行节点不支持此操作");
    if (!this.child?.stdin.writable) throw new PublicError("Codex 未连接");
    this.child.stdin.write(encodeRpc(message) + "\n");
  }
  private signal(
    child: ChildProcessWithoutNullStreams,
    signal: NodeJS.Signals,
  ) {
    if (this.processGroup && child.pid) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    } else child.kill(signal);
  }
  stop() {
    if (this.child) this.signal(this.child, "SIGTERM");
  }

  async stopAndWait() {
    const child = this.child;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      if (this.processGroup) this.signal(child, "SIGKILL");
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const force = setTimeout(() => this.signal(child, "SIGKILL"), 5000);
      const deadline = setTimeout(() => {
        clearTimeout(force);
        reject(new PublicError("Codex 进程未能停止"));
      }, 10000);
      child.once("exit", () => {
        clearTimeout(force);
        clearTimeout(deadline);
        if (this.processGroup) this.signal(child, "SIGKILL");
        resolve();
      });
      this.signal(child, "SIGTERM");
    });
  }
}
