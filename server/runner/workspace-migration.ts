import { DatabaseSync, backup } from "node:sqlite";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  statfs,
  writeFile,
  open,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { instanceLease } from "../instance-lease.js";
import { PublicError } from "../public-error.js";
import { copyStable, syncTree, syncDirectory, hashFile } from "./checkpoint.js";
import { protectedPath } from "./locations.js";

type Binding = {
  thread_id: string;
  workspace_id: string | null;
  root: string;
  legacy: number;
  revision: string;
  snapshot: string;
};
const inside = (root: string, path: string) => {
  const p = relative(root, path);
  return !p || (p !== ".." && !p.startsWith("../") && !isAbsolute(p));
};
async function exists(path: string) {
  return !!(await lstat(path).catch((e) => {
    if (e.code !== "ENOENT") throw e;
    return null;
  }));
}
async function plainDirectory(path: string) {
  if ((await realpath(path)) !== path || !(await lstat(path)).isDirectory())
    throw new PublicError("迁移目录不能使用链接");
}
async function scan(root: string) {
  await plainDirectory(root);
  const files: {
      path: string;
      bytes: number;
      mtime: number;
      ctime: number;
      ino: number;
    }[] = [],
    directories: string[] = [];
  async function walk(dir: string) {
    await plainDirectory(dir);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name),
        info = await lstat(path);
      if (
        info.isSymbolicLink() ||
        (!info.isDirectory() && (!info.isFile() || info.nlink !== 1))
      )
        throw new PublicError("工作区包含链接或特殊文件，不能自动迁移");
      if (info.isDirectory()) {
        directories.push(relative(root, path));
        await walk(path);
      } else
        files.push({
          path: relative(root, path),
          bytes: info.size,
          mtime: info.mtimeMs,
          ctime: info.ctimeMs,
          ino: info.ino,
        });
      if (files.length + directories.length > 100000)
        throw new PublicError("工作区迁移超过当前文件数量预算");
    }
  }
  await walk(root);
  return { files, directories };
}
function reboundSnapshot(value: string, from: string, to: string) {
  const snapshot = JSON.parse(value);
  const path = (v: string | undefined) =>
    v && inside(from, v) ? join(to, relative(from, v)) : v;
  for (const resource of snapshot.resources || []) {
    resource.projectPath = path(resource.projectPath);
    resource.projectRoot = path(resource.projectRoot);
  }
  for (const skill of snapshot.config?.skills?.config || [])
    skill.path = path(skill.path);
  // Source package locations, recipient configuration and arbitrary history text are deliberately untouched.
  return JSON.stringify(snapshot);
}
/** Read-only inventory. No source process is stopped and no new directory is created. */
export async function inspectWorkspaceMigration(
  directory: string,
  target: string,
) {
  directory = protectedPath(directory);
  target = protectedPath(target);
  if (inside(directory, target) || inside(target, directory))
    throw new PublicError("迁移工作区必须与私密实例目录分离");
  const sql = new DatabaseSync(join(directory, "newbot.sqlite"), {
    readOnly: true,
  });
  try {
    const bindings = sql
      .prepare("SELECT * FROM thread_workspaces ORDER BY thread_id")
      .all() as Binding[];
    const groups = new Map<
      string,
      {
        source: string;
        target: string;
        bindings: Binding[];
        files: { path: string; bytes: number }[];
        directories: string[];
      }
    >();
    for (const row of bindings) {
      if (!row.legacy && !/^[a-f0-9-]{36}$/i.test(row.workspace_id || ""))
        throw new PublicError("会话工作区身份无效");
      if (inside(row.root, target) || inside(target, row.root))
        throw new PublicError("目标不能包含或覆盖原工作区");
      if (!groups.has(row.root)) {
        const id = row.legacy
          ? "legacy-" +
            createHash("sha256").update(row.root).digest("hex").slice(0, 24)
          : row.workspace_id!;
        if ([...groups.values()].some((g) => g.target === join(target, id)))
          throw new PublicError("工作区身份冲突");
        // Refuse copying an entire project containing the private instance subtree.
        if (inside(row.root, directory))
          throw new PublicError(
            "旧工作区包含私密实例目录，需先单独整理文件范围",
          );
        groups.set(row.root, {
          source: row.root,
          target: join(target, id),
          bindings: [],
          ...(await scan(row.root)),
        });
      }
      groups.get(row.root)!.bindings.push(row);
    }
    return {
      directory,
      target,
      groups: [...groups.values()],
      bytes: [...groups.values()].reduce(
        (n, g) => n + g.files.reduce((m, f) => m + f.bytes, 0),
        0,
      ),
    };
  } finally {
    sql.close();
  }
}
/** Offline workspace-only relocation. Server/native homes are migrated separately.
 * Publication happens after durable copy; old files and a SQLite backup always remain.
 */
export async function migrateWorkspaces(directory: string, target: string) {
  directory = protectedPath(directory);
  target = protectedPath(target);
  const lease = await instanceLease(directory, "migration");
  let sql: DatabaseSync | undefined;
  let stage: string | undefined;
  try {
    const plan = await inspectWorkspaceMigration(directory, target);
    if (await exists(target))
      throw new PublicError("目标已存在，不能覆盖工作区");
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await plainDirectory(dirname(target));
    const disk = await statfs(dirname(target));
    if (
      Number(disk.bavail) * Number(disk.bsize) <
      plan.bytes + 16 * 1024 * 1024
    )
      throw new PublicError("目标空间不足，源工作区未改变");
    const id = randomUUID(),
      recordRoot = join(directory, "migrations", id);
    await mkdir(recordRoot, { recursive: true, mode: 0o700 });
    await plainDirectory(recordRoot);
    sql = new DatabaseSync(join(directory, "newbot.sqlite"));
    await backup(sql, join(recordRoot, "original.sqlite"));
    await chmod(join(recordRoot, "original.sqlite"), 0o600);
    const backupHandle = await open(join(recordRoot, "original.sqlite"), "r");
    try {
      await backupHandle.sync();
    } finally {
      await backupHandle.close();
    }
    const state = await readFile(
      join(directory, ".instance-state.json"),
      "utf8",
    );
    stage = join(dirname(target), ".workspace-migration-" + id);
    await mkdir(stage, { mode: 0o700 });
    const checks: { path: string; sha256: string; bytes: number }[] = [];
    for (const group of plan.groups) {
      const root = join(stage, relative(target, group.target));
      await mkdir(root, { mode: 0o700 });
      for (const path of group.directories)
        await mkdir(join(root, path), { recursive: true, mode: 0o700 });
      for (const file of group.files) {
        const copied = await copyStable(
          join(group.source, file.path),
          join(root, file.path),
        );
        checks.push({
          path: relative(stage, join(root, file.path)),
          sha256: copied.sha256,
          bytes: copied.bytes,
        });
      }
      const after = await scan(group.source);
      if (
        JSON.stringify(
          after.files.sort((a, b) => a.path.localeCompare(b.path)),
        ) !==
          JSON.stringify(
            [...group.files].sort((a, b) => a.path.localeCompare(b.path)),
          ) ||
        JSON.stringify(after.directories.sort()) !==
          JSON.stringify([...group.directories].sort())
      )
        throw new PublicError("源工作区在复制期间变化，请停止外部写入后重试");
    }
    await syncTree(stage);
    const record = {
      format: 1,
      id,
      directory,
      target,
      state,
      previous: {
        parent:
          (
            sql
              .prepare(
                "SELECT value FROM metadata WHERE key='runner:workspace-root'",
              )
              .get() as { value: string } | undefined
          )?.value ?? null,
        migration:
          (
            sql
              .prepare(
                "SELECT value FROM metadata WHERE key='runner:last-workspace-migration'",
              )
              .get() as { value: string } | undefined
          )?.value ?? null,
      },
      groups: plan.groups.map((g) => ({
        source: g.source,
        target: g.target,
        bindings: g.bindings,
        directories: g.directories,
      })),
      checks,
    };
    await writeFile(join(recordRoot, "record.json"), JSON.stringify(record), {
      mode: 0o600,
      flag: "wx",
    });
    await syncTree(recordRoot);
    // A unique marker distinguishes this operation's target from an unrelated directory on recovery.
    await writeFile(join(stage, ".newbot-workspace-migration"), id, {
      mode: 0o600,
      flag: "wx",
    });
    await syncTree(stage);
    if (await exists(target)) throw new PublicError("目标目录已被其他操作创建");
    await rename(stage, target);
    stage = undefined;
    await syncDirectory(dirname(target));
    sql.exec("BEGIN IMMEDIATE");
    try {
      for (const group of plan.groups)
        for (const row of group.bindings) {
          const changed = sql
            .prepare(
              "UPDATE thread_workspaces SET root=?,snapshot=?,revision=? WHERE thread_id=? AND root=? AND revision=? AND snapshot=?",
            )
            .run(
              group.target,
              reboundSnapshot(row.snapshot, row.root, group.target),
              "relocated:" + id + ":" + row.revision,
              row.thread_id,
              row.root,
              row.revision,
              row.snapshot,
            );
          if (Number(changed.changes) !== 1)
            throw new PublicError("工作区绑定已变化，未发布迁移");
        }
      sql
        .prepare(
          "INSERT OR REPLACE INTO metadata VALUES('runner:workspace-root',?)",
        )
        .run(target);
      sql
        .prepare(
          "INSERT OR REPLACE INTO metadata VALUES('runner:last-workspace-migration',?)",
        )
        .run(id);
      sql.exec("COMMIT");
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
    return {
      id,
      threads: plan.groups.reduce((n, g) => n + g.bindings.length, 0),
      files: checks.length,
      bytes: plan.bytes,
      recordRoot,
      target,
    };
  } finally {
    sql?.close();
    if (stage) await rm(stage, { recursive: true, force: true });
    await lease.release();
  }
}

/** Roll back bindings only before the migrated instance has started or files changed.
 * Never overwrite the whole database or delete either generation of user files.
 */
export async function rollbackWorkspaceMigration(
  directory: string,
  id: string,
) {
  directory = protectedPath(directory);
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new PublicError("迁移记录标识无效");
  const lease = await instanceLease(directory, "migration");
  let sql: DatabaseSync | undefined;
  try {
    const recordPath = join(directory, "migrations", id, "record.json");
    if ((await realpath(recordPath)) !== recordPath)
      throw new PublicError("迁移记录不能使用链接");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    if (
      record.format !== 1 ||
      record.id !== id ||
      record.directory !== directory ||
      !Array.isArray(record.groups) ||
      !Array.isArray(record.checks)
    )
      throw new PublicError("迁移记录无效");
    protectedPath(record.target);
    if (
      (await readFile(join(directory, ".instance-state.json"), "utf8")) !==
      record.state
    )
      throw new PublicError("迁移后实例已启动，不能用旧工作区覆盖后续修改");
    if (
      (await readFile(
        join(record.target, ".newbot-workspace-migration"),
        "utf8",
      )) !== id
    )
      throw new PublicError("迁移目标身份已变化");
    for (const group of record.groups) {
      protectedPath(group.source);
      if (
        !inside(record.target, group.target) ||
        group.target === record.target
      )
        throw new PublicError("迁移路径无效");
      const source = await scan(group.source),
        target = await scan(group.target);
      const expected = record.checks.filter((f: any) =>
        inside(group.target, join(record.target, f.path)),
      );
      for (const [root, actual] of [
        [group.source, source],
        [group.target, target],
      ] as const) {
        if (
          JSON.stringify([...actual.directories].sort()) !==
            JSON.stringify([...(group.directories || [])].sort()) ||
          actual.files.length !== expected.length
        )
          throw new PublicError("迁移后的文件已变化，不能自动回退");
        for (const file of actual.files) {
          const key = relative(record.target, join(group.target, file.path));
          const check = expected.find((f: any) => f.path === key);
          const hash = await hashFile(join(root, file.path));
          if (
            !check ||
            check.bytes !== hash.bytes ||
            check.sha256 !== hash.sha256
          )
            throw new PublicError("迁移后的文件已变化，不能自动回退");
        }
      }
    }
    sql = new DatabaseSync(join(directory, "newbot.sqlite"));
    if (
      (
        sql
          .prepare(
            "SELECT value FROM metadata WHERE key='runner:last-workspace-migration'",
          )
          .get() as any
      )?.value !== id
    )
      throw new PublicError("当前目录绑定不属于此迁移");
    sql.exec("BEGIN IMMEDIATE");
    try {
      for (const group of record.groups)
        for (const row of group.bindings as Binding[]) {
          if (row.root !== group.source)
            throw new PublicError("原始绑定记录无效");
          const changed = sql
            .prepare(
              "UPDATE thread_workspaces SET root=?,revision=?,snapshot=? WHERE thread_id=? AND root=? AND revision=? AND snapshot=?",
            )
            .run(
              row.root,
              row.revision,
              row.snapshot,
              row.thread_id,
              group.target,
              "relocated:" + id + ":" + row.revision,
              reboundSnapshot(row.snapshot, row.root, group.target),
            );
          if (Number(changed.changes) !== 1)
            throw new PublicError("迁移绑定已变化，不能自动回退");
        }
      for (const [key, value] of [
        ["runner:workspace-root", record.previous.parent],
        ["runner:last-workspace-migration", record.previous.migration],
      ]) {
        if (value === null)
          sql.prepare("DELETE FROM metadata WHERE key=?").run(key);
        else
          sql
            .prepare("INSERT OR REPLACE INTO metadata VALUES(?,?)")
            .run(key, value);
      }
      sql.exec("COMMIT");
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
    return { id, preservedTarget: record.target };
  } finally {
    sql?.close();
    await lease.release();
  }
}
