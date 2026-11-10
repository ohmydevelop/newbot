import { chmod, mkdtemp, realpath, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import { PublicError } from "./public-error.js";

/** Native diagnostics can contain request parameters even with RUST_LOG=off. */
export async function volatileRuntimeLogs() {
  try {
    const root = await realpath(
      process.env.NEWBOT_RUNTIME_LOG_ROOT || "/dev/shm",
    );
    const fs = await statfs(root);
    // Linux tmpfs: keep native SQLite diagnostics off persistent instance volumes.
    if (process.platform !== "linux" || fs.type !== 0x01021994) throw Error();
    const path = await mkdtemp(join(root, "newbot-codex-log-"));
    await chmod(path, 0o700);
    return { path, close: () => rm(path, { recursive: true, force: true }) };
  } catch {
    throw new PublicError(
      "内存配置模式需要可写的 tmpfs 日志目录，请检查运行环境",
    );
  }
}
