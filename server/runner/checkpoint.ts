import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
  readFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { PublicError } from "../public-error.js";

const id = z.string().uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const entry = z
  .object({
    path: z.string(),
    sha256: digest,
    bytes: z.number().int().nonnegative().safe(),
    executable: z.boolean(),
  })
  .strict();
const manifestSchema = z
  .object({
    format: z.literal(1),
    id,
    threadId: id,
    nativeVersion: z.string().min(1).max(160),
    rollout: z.string(),
    directories: z.array(z.string()).max(100000).default([]),
    files: z.array(entry).max(100000),
  })
  .strict();
export type ThreadCheckpoint = z.infer<typeof manifestSchema>;
export function checkpointPath(value: string) {
  if (
    !value ||
    isAbsolute(value) ||
    /[\\\x00-\x1f]/.test(value) ||
    value.length > 4096 ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new PublicError("恢复包包含无效路径");
  return value;
}
async function directory(path: string, create = true) {
  if (create) await mkdir(path, { recursive: true, mode: 0o700 });
  if (
    (await realpath(path)) !== resolve(path) ||
    !(await lstat(path)).isDirectory()
  )
    throw new PublicError("恢复目录不能包含链接");
}
export async function hashFile(path: string) {
  const hash = createHash("sha256");
  let bytes = 0;
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    for await (const part of handle.createReadStream({ autoClose: false })) {
      hash.update(part);
      bytes += part.length;
    }
  } finally {
    await handle.close();
  }
  return { sha256: hash.digest("hex"), bytes };
}
export async function copyStable(source: string, target: string) {
  const before = await lstat(source);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)
    throw new PublicError("恢复文件必须是普通文件，不能包含链接");
  await directory(dirname(target));
  const input = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output: Awaited<ReturnType<typeof open>> | undefined;
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    output = await open(target, "wx", 0o600);
    const opened = await input.stat();
    if (
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      (process.platform === "linux" &&
        (await realpath(`/proc/self/fd/${input.fd}`)) !== resolve(source))
    )
      throw new PublicError("恢复源文件正在变化");
    const buffer = Buffer.allocUnsafe(256 * 1024);
    while (true) {
      const r = await input.read(buffer, 0, buffer.length, null);
      if (!r.bytesRead) break;
      const part = buffer.subarray(0, r.bytesRead);
      hash.update(part);
      bytes += r.bytesRead;
      let offset = 0;
      while (offset < part.length) {
        const written = await output.write(part, offset, part.length - offset);
        if (!written.bytesWritten) throw Error("short write");
        offset += written.bytesWritten;
      }
    }
    const after = await input.stat(),
      atPath = await lstat(source);
    if (
      before.ino !== atPath.ino ||
      before.dev !== atPath.dev ||
      before.size !== bytes ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new PublicError("恢复源文件正在变化");
    await output.sync();
  } finally {
    await input.close();
    await output?.close();
  }
  const executable = !!(before.mode & 0o111);
  await chmod(target, executable ? 0o700 : 0o600);
  return { sha256: hash.digest("hex"), bytes, executable };
}
export async function syncDirectory(path: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function syncTree(path: string): Promise<void> {
  for (const entry of await readdir(path, { withFileTypes: true }))
    if (entry.isDirectory()) await syncTree(join(path, entry.name));
  await syncDirectory(path);
}
// Native path resume can rebuild an index from a self-contained rollout. Lineage
// references need a dependency graph, so format 1 must refuse rather than truncate.
async function validateNativeHeader(path: string, threadId: string) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = Buffer.allocUnsafe(65536),
        { bytesRead } = await handle.read(chunk);
      if (!bytesRead) throw new PublicError("原生会话缺少完整元数据");
      const end = chunk.subarray(0, bytesRead).indexOf(10);
      const part = chunk.subarray(0, end < 0 ? bytesRead : end);
      length += part.length;
      if (length > 32 * 1024 * 1024)
        throw new PublicError("原生会话元数据超过恢复预算");
      chunks.push(part);
      if (end < 0) continue;
      let value;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        throw new PublicError("原生会话元数据无法读取");
      }
      if (value?.type !== "session_meta" || value.payload?.id !== threadId)
        throw new PublicError("原生会话身份与恢复清单不匹配");
      if (
        value.payload.history_base ||
        value.payload.forked_from_id ||
        value.payload.attached_thread
      )
        throw new PublicError(
          "此会话包含其他线程的历史依赖，必须先导出完整依赖后恢复",
        );
      // Keep account-scoped and tool metadata intact; the native runtime enforces them.
      return;
    }
  } finally {
    await handle.close();
  }
}
/** Cold native rollout + workspace. Caller must exclusively stop its Runner before capture.
 * No SQLite/auth/config files are copied. Format 1 excludes external resources and memories.
 */
export class ThreadCheckpoints {
  constructor(readonly root: string) {}
  async capture(input: {
    threadId: string;
    nativeVersion: string;
    home: string;
    workspace: string;
    rollout: string;
    isStopped: () => boolean;
  }) {
    id.parse(input.threadId);
    if (!input.isStopped())
      throw new PublicError("生成冷恢复包前必须停止执行节点");
    const home = await realpath(input.home),
      workspace = await realpath(input.workspace),
      rollout = checkpointPath(relative(home, input.rollout));
    if (
      !rollout.startsWith("sessions/") &&
      !rollout.startsWith("archived_sessions/")
    )
      throw new PublicError("仅允许备份原生会话记录");
    if (
      (await realpath(input.rollout)) !== resolve(home, rollout) ||
      !rollout.includes(input.threadId) ||
      !rollout.endsWith(".jsonl")
    )
      throw new PublicError("原生会话记录与线程不匹配，或此存储格式尚不支持");
    await directory(this.root);
    const checkpointId = randomUUID(),
      stage = join(this.root, ".stage-" + checkpointId),
      files: ThreadCheckpoint["files"] = [],
      directories: string[] = [];
    await directory(stage);
    try {
      const add = async (source: string, path: string) => {
        if (files.length >= 100000)
          throw new PublicError("恢复包文件数超过当前预算");
        files.push({
          path: checkpointPath(path),
          ...(await copyStable(source, join(stage, path))),
        });
      };
      await add(input.rollout, "native/" + rollout);
      await validateNativeHeader(
        join(stage, "native", rollout),
        input.threadId,
      );
      const walk = async (path: string, prefix = "") => {
        for (const name of (await readdir(path)).sort()) {
          const absolute = join(path, name),
            info = await lstat(absolute),
            rel = checkpointPath(prefix + name);
          if (info.isSymbolicLink())
            throw new PublicError("工作区包含链接，不能生成此版本恢复包");
          if (info.isDirectory()) {
            if (directories.length >= 100000)
              throw new PublicError("恢复包目录数超过当前预算");
            directories.push("workspace/" + rel);
            await walk(absolute, rel + "/");
          } else await add(absolute, "workspace/" + rel);
        }
      };
      await walk(workspace);
      if (!input.isStopped())
        throw new PublicError("恢复包生成期间节点已重新启动");
      const manifest = manifestSchema.parse({
        format: 1,
        id: checkpointId,
        threadId: input.threadId,
        nativeVersion: input.nativeVersion,
        rollout,
        directories,
        files,
      });
      await writeFile(join(stage, "manifest.json"), JSON.stringify(manifest), {
        mode: 0o600,
        flag: "wx",
      });
      const manifestHandle = await open(join(stage, "manifest.json"), "r");
      try {
        await manifestHandle.sync();
      } finally {
        await manifestHandle.close();
      }
      await syncTree(stage);
      await rename(stage, join(this.root, checkpointId));
      await syncDirectory(this.root);
      return manifest;
    } catch (e) {
      await rm(stage, { recursive: true, force: true });
      throw e;
    }
  }
  async inspect(checkpointId: string, nativeVersion: string) {
    id.parse(checkpointId);
    const folder = join(this.root, checkpointId);
    await directory(folder, false);
    const manifestPath = join(folder, "manifest.json");
    const info = await lstat(manifestPath);
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.isSymbolicLink() ||
      info.size > 32 * 1024 * 1024
    )
      throw new PublicError("恢复清单无效");
    const manifest = manifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8")),
    );
    if (
      manifest.id !== checkpointId ||
      manifest.nativeVersion !== nativeVersion
    )
      throw new PublicError("恢复包版本与当前运行内核不匹配");
    checkpointPath(manifest.rollout);
    if (
      !/^(sessions|archived_sessions)\//.test(manifest.rollout) ||
      !manifest.rollout.includes(manifest.threadId) ||
      !manifest.rollout.endsWith(".jsonl")
    )
      throw new PublicError("恢复包会话路径无效");
    const names = new Set<string>();
    for (const path of manifest.directories) {
      checkpointPath(path);
      if (!path.startsWith("workspace/") || names.has(path))
        throw new PublicError("恢复包目录范围无效");
      names.add(path);
    }
    for (const file of manifest.files) {
      checkpointPath(file.path);
      if (
        names.has(file.path) ||
        (!file.path.startsWith("workspace/") &&
          file.path !== "native/" + manifest.rollout)
      )
        throw new PublicError("恢复包文件范围或重复路径无效");
      names.add(file.path);
      const path = join(folder, file.path),
        s = await lstat(path);
      if (
        !s.isFile() ||
        s.nlink !== 1 ||
        s.isSymbolicLink() ||
        (await realpath(path)) !== path
      )
        throw new PublicError("恢复包包含链接");
      const actual = await hashFile(path);
      if (actual.sha256 !== file.sha256 || actual.bytes !== file.bytes)
        throw new PublicError("恢复包文件校验失败");
    }
    if (!names.has("native/" + manifest.rollout))
      throw new PublicError("恢复包缺少原生会话记录");
    await validateNativeHeader(
      join(folder, "native", manifest.rollout),
      manifest.threadId,
    );
    return manifest;
  }
  /** Publish one fresh node directory atomically; never overwrite an existing node. */
  async restore(checkpointId: string, nativeVersion: string, target: string) {
    const manifest = await this.inspect(checkpointId, nativeVersion);
    target = resolve(target);
    await directory(dirname(target));
    if (
      await lstat(target).then(
        () => true,
        (e) => {
          if (e.code === "ENOENT") return false;
          throw e;
        },
      )
    )
      throw new PublicError("恢复目标已存在，不覆盖现有节点");
    const claim = target + ".restore-lock";
    try {
      await mkdir(claim, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new PublicError("此节点已在恢复中；异常退出后请先核对恢复记录");
      throw error;
    }
    const stage = join(dirname(target), ".restore-" + randomUUID());
    try {
      await directory(stage);
      for (const file of manifest.files) {
        const next = await copyStable(
          join(this.root, checkpointId, file.path),
          join(stage, file.path),
        );
        if (next.sha256 !== file.sha256 || next.bytes !== file.bytes)
          throw new PublicError("恢复包在导入期间变化");
      }
      for (const path of manifest.directories)
        await directory(join(stage, path));
      await directory(join(stage, "workspace"));
      if (
        await lstat(target).then(
          () => true,
          (e) => {
            if (e.code === "ENOENT") return false;
            throw e;
          },
        )
      )
        throw new PublicError("恢复目标已存在，不覆盖现有节点");
      await syncTree(stage);
      // The exclusive sibling claim serializes cooperating node restorations.
      await rename(stage, target);
      await syncDirectory(dirname(target));
      return {
        manifest,
        home: join(target, "native"),
        workspace: join(target, "workspace"),
        rollout: join(target, "native", manifest.rollout),
      };
    } catch (e) {
      await rm(stage, { recursive: true, force: true });
      throw e;
    } finally {
      await rm(claim, { recursive: true, force: true });
    }
  }
}
