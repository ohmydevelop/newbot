import {localWorkspaceFiles,WorkspaceFileError} from "./runner/workspace-files.js";
import { imageExtension } from "./public-images.js";
import { PublicError } from "./public-error.js";
import { createHash, randomUUID } from "node:crypto";
import { constants, mkdirSync, realpathSync } from "node:fs";
import { lstat, open, realpath, opendir, unlink } from "node:fs/promises";
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import type {
  Artifact,
  ArtifactNotice,
  StorageUsage,
  StorageCleanup,
  Json,
  Thread,
} from "../shared/types.js";
import type { Store } from "./db.js";
import {
  storedBytes,
  STORAGE_LIMIT,
  RETENTION_MS,
  reserveUntracked,
  registeredUsage,
  assertStorageDirectory,
} from "./storage.js";

const MAX_FILE = 8 * 1024 * 1024;
const textKinds: Record<string, Artifact["kind"]> = {
  ".txt": "text",
  ".log": "text",
  ".md": "markdown",
  ".json": "json",
  ".csv": "csv",
  ".html": "html",
  ...Object.fromEntries(
    [
      ".ts",
      ".tsx",
      ".js",
      ".jsx",
      ".mjs",
      ".css",
      ".py",
      ".rs",
      ".go",
      ".sh",
      ".yaml",
      ".yml",
      ".toml",
      ".xml",
      ".sql",
    ].map((e) => [e, "code" as const]),
  ),
};
class CaptureError extends PublicError {
  statusCode: number;
  constructor(public reason: string) {
    super(
      (
        {
          storage_limit: "文件存储已达到 512 MiB 上限，请先清理未使用文件",
          snapshot_missing: "文件快照缺失，历史记录仍保留，请从备份恢复",
          snapshot_corrupt: "文件快照校验失败，历史记录仍保留，请从备份恢复",
          file_too_large: "文件超过 8 MiB 保存上限，请先拆分或压缩",
          capture_busy: "文件处理队列已满，请稍后重试",
        } as Record<string, string>
      )[reason] || "产物读取失败，请检查路径、文件类型或存储限制",
    );
    this.statusCode = reason.startsWith("snapshot_") ? 410 : 400;
  }
}
function fail(reason: string): never {
  throw new CaptureError(reason);
}
function within(root: string, path: string) {
  const p = relative(root, path);
  return (
    p === "" || (!p.startsWith(`..${sep}`) && p !== ".." && !isAbsolute(p))
  );
}
function format(path: string, data: Buffer): Pick<Artifact, "kind" | "mime"> {
  const ext = extname(path).toLowerCase();
  if (
    ext === ".png" &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { kind: "image", mime: "image/png" };
  if (
    [".jpg", ".jpeg"].includes(ext) &&
    data[0] === 255 &&
    data[1] === 216 &&
    data[2] === 255
  )
    return { kind: "image", mime: "image/jpeg" };
  if (
    ext === ".webp" &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  )
    return { kind: "image", mime: "image/webp" };
  if (ext === ".pdf" && data.toString("ascii", 0, 5) === "%PDF-")
    return { kind: "pdf", mime: "application/pdf" };
  if (!textKinds[ext] || data.length > 2 * 1024 * 1024 || data.includes(0))
    fail("unsupported_type");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    fail("invalid_text");
  }
  if (/-----BEGIN (?:[A-Z ]*PRIVATE KEY|CERTIFICATE)-----/.test(text))
    fail("sensitive_content");
  const mime =
    ext === ".html"
      ? "text/html"
      : ext === ".md"
        ? "text/markdown"
        : ext === ".json"
          ? "application/json"
          : ext === ".csv"
            ? "text/csv"
            : "text/plain";
  return { kind: textKinds[ext], mime };
}

type Row = {
  id: string;
  thread_id: string;
  turn_id: string;
  item_id: string | null;
  path: string;
  name: string;
  kind: Artifact["kind"];
  mime: string;
  size: number;
  sha256: string;
  version: number;
  source: Artifact["source"];
  created: number;
};
function dto(row: Row): Artifact {
  return {
    id: row.id,
    threadId: row.thread_id,
    turnId: row.turn_id,
    itemId: row.item_id,
    path: row.path,
    name: row.name,
    kind: row.kind,
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    version: row.version,
    source: row.source,
    createdAt: row.created,
    contentUrl: `/api/artifacts/${row.id}/content`,
    downloadUrl: `/api/artifacts/${row.id}/download`,
  };
}

export function artifactStore(
  directory: string,
  workspace: string,
  db: Store,
  workspaceRoot?: (threadId: string) => string,
) {
  const root = realpathSync(workspace);
  const privateRoot = realpathSync(directory);
  const folder = join(privateRoot, "artifacts");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  assertStorageDirectory(folder);
  let queue = Promise.resolve();
  let pending = 0;
  let closed = false;
  let untrackedBytes = 0;
  let orphanSizes = new Map<string, number>();
  const uploadsFolder = join(privateRoot, "uploads");
  const own = (id: string) => {
    if (!db.owns(id)) throw new PublicError("会话不存在");
  };
  const physical = localWorkspaceFiles(workspace, privateRoot, MAX_FILE, new Set(Object.keys(textKinds)));
  const pathOf: typeof physical.pathOf = (...args) => {
    try { return physical.pathOf(...args); } catch (e) { if (e instanceof WorkspaceFileError) fail(e.reason); throw e; }
  };
  const readBounded: typeof physical.readBounded = async (...args) => {
    try { return await physical.readBounded(...args); } catch (e) { if (e instanceof WorkspaceFileError) fail(e.reason); throw e; }
  };
  function get(id: string) {
    const row = db.raw.prepare("SELECT * FROM artifacts WHERE id=?").get(id) as
      | Row
      | undefined;
    if (!row || !db.owns(row.thread_id)) throw new PublicError("产物不存在");
    return dto(row);
  }
  function list(threadId: string, turnId?: string) {
    own(threadId);
    return (
      db.raw
        .prepare(
          `SELECT * FROM artifacts WHERE thread_id=? ${turnId ? "AND turn_id=?" : ""} ORDER BY created,version`,
        )
        .all(...(turnId ? [threadId, turnId] : [threadId])) as Row[]
    ).map(dto);
  }
  function notices(threadId: string) {
    own(threadId);
    return db.raw
      .prepare(
        "SELECT turn_id AS turnId,item_id AS itemId,path,state,reason FROM artifact_sources WHERE thread_id=? AND state!='ready' ORDER BY created",
      )
      .all(threadId) as ArtifactNotice[];
  }
  function serial<T>(task: () => Promise<T>): Promise<T> {
    if (closed || pending >= 64)
      return Promise.reject(new CaptureError("capture_busy"));
    pending++;
    const result = queue.then(task);
    queue = result
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        pending--;
      });
    return result;
  }
  async function scan(remove: boolean) {
    assertStorageDirectory(folder);
    assertStorageDirectory(uploadsFolder);
    const refs = new Set(
      (
        db.raw.prepare("SELECT DISTINCT sha256 FROM artifacts").all() as {
          sha256: string;
        }[]
      ).map((r) => r.sha256),
    );
    const orphan = new Map<string, number>();
    let unknownBytes = 0,
      legacyUploadBytes = 0,
      reclaimableBytes = 0,
      reclaimableFiles = 0,
      removedFiles = 0,
      failedFiles = 0;
    const now = Date.now();
    const entries = await opendir(folder);
    for await (const entry of entries) {
      if (refs.has(entry.name)) continue;
      const path = join(folder, entry.name);
      try {
        const info = await lstat(path);
        if (!info.isFile()) continue; // Never traverse symlinks or directories.
        const eligible =
          /^[a-f0-9]{64}$/.test(entry.name) &&
          info.nlink === 1 &&
          info.mtimeMs < now - RETENTION_MS;
        if (eligible && remove) {
          // Capture and maintenance share a serial queue. Recheck references immediately
          // before unlinking, including archived threads and every historical version.
          if (
            !db.raw
              .prepare("SELECT id FROM artifacts WHERE sha256=? LIMIT 1")
              .get(entry.name)
          ) {
            try {
              await unlink(path);
              removedFiles++;
              continue;
            } catch {
              failedFiles++;
            }
          }
        }
        unknownBytes += info.size;
        if (/^[a-f0-9]{64}$/.test(entry.name))
          orphan.set(entry.name, info.size);
        if (eligible) {
          reclaimableBytes += info.size;
          reclaimableFiles++;
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
          throw new PublicError("文件存储扫描失败，请稍后重试");
      }
    }
    const uploads = await opendir(uploadsFolder);
    for await (const entry of uploads) {
      if (
        db.raw.prepare("SELECT id FROM attachments WHERE id=?").get(entry.name)
      )
        continue;
      try {
        const info = await lstat(join(uploadsFolder, entry.name));
        if (info.isFile()) legacyUploadBytes += info.size;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
          throw new PublicError("附件存储扫描失败，请稍后重试");
      }
    }
    const expired = db.raw
      .prepare(
        "SELECT COUNT(*) count,COALESCE(SUM(size),0) bytes FROM attachments WHERE legacy=0 AND created<? AND NOT EXISTS(SELECT 1 FROM run_attachments WHERE file_id=attachments.id)",
      )
      .get(now - RETENTION_MS) as { count: number; bytes: number };
    untrackedBytes = unknownBytes + legacyUploadBytes;
    orphanSizes = orphan;
    reserveUntracked(db, untrackedBytes);
    const registered = registeredUsage(db);
    const usage: StorageUsage = {
      usedBytes: storedBytes(db),
      limitBytes: STORAGE_LIMIT,
      uploadsBytes: registered.uploads.bytes,
      snapshotBytes: registered.snapshots.bytes,
      untrackedBytes,
      legacyUploadBytes,
      versions: registered.versions,
      snapshots: registered.snapshots.count,
      reclaimableBytes: reclaimableBytes + expired.bytes,
      reclaimableFiles: reclaimableFiles + expired.count,
      scannedAt: now,
      limits: {
        artifactBytes: MAX_FILE,
        textBytes: 2 * 1024 * 1024,
        retentionHours: 24,
      },
    };
    return { usage, removedFiles, failedFiles };
  }
  async function maintenance(
    remove = false,
    cleanUploads: () => number = () => 0,
  ): Promise<StorageCleanup> {
    return serial(async () => {
      const before = await scan(false);
      if (!remove) return { ...before, releasedBytes: 0 };
      let removed = 0,
        failures = 0;
      try {
        removed = cleanUploads();
      } catch {
        failures++;
      }
      const after = await scan(true);
      return {
        usage: after.usage,
        removedFiles: removed + after.removedFiles,
        failedFiles: failures + after.failedFiles,
        releasedBytes: Math.max(
          0,
          before.usage.usedBytes - after.usage.usedBytes,
        ),
      };
    });
  }
  async function capture(
    threadId: string,
    turnId: string,
    path: string,
    itemId: string | null,
    provided?: Buffer,
    source: Artifact["source"] = itemId ? "fileChange" : "user",
  ) {
    own(threadId);
    assertStorageDirectory(folder);
    const root = workspaceRoot?.(threadId) || realpathSync(workspace);
    const data =
      provided ??
      (await readBounded(pathOf(path, false, root).full, true, root));
    const type = format(path, data);
    const sha = createHash("sha256").update(data).digest("hex");
    if (!itemId) {
      const same = db.raw
        .prepare(
          "SELECT * FROM artifacts WHERE thread_id=? AND turn_id=? AND path=? AND sha256=? AND source='user'",
        )
        .get(threadId, turnId, path, sha) as Row | undefined;
      if (same) return dto(same);
    }
    const exists = !!db.raw
      .prepare("SELECT id FROM artifacts WHERE sha256=? LIMIT 1")
      .get(sha);
    let adoptedBytes = exists ? 0 : orphanSizes.get(sha) || 0;
    // A crash can leave a partial, unreferenced blob under its final hash name.
    // Recreate that blob from the explicitly read current file; never repair or
    // overwrite anything referenced by historical metadata.
    if (!exists && orphanSizes.has(sha)) {
      let valid = false;
      try {
        valid =
          createHash("sha256")
            .update(await readBounded(join(folder, sha), false))
            .digest("hex") === sha;
      } catch {}
      if (!valid) {
        const info = await lstat(join(folder, sha));
        if (!info.isFile() || info.nlink !== 1) fail("snapshot_corrupt");
        await unlink(join(folder, sha));
        untrackedBytes -= orphanSizes.get(sha)!;
        orphanSizes.delete(sha);
        reserveUntracked(db, untrackedBytes);
        adoptedBytes = 0;
      }
    }
    if (!exists && storedBytes(db) + data.length - adoptedBytes > STORAGE_LIMIT)
      fail("storage_limit");
    const target = join(folder, sha);
    let created = false;
    try {
      const handle = await open(
        target,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW,
        0o600,
      );
      created = true;
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
        if (created) await unlink(target).catch(() => {});
        throw e;
      }
    }
    try {
      // A crash may leave an unreferenced blob. Never trust it without verification.
      if (
        !created &&
        createHash("sha256")
          .update(await readBounded(target, false))
          .digest("hex") !== sha
      )
        fail("snapshot_corrupt");
      db.raw.exec("BEGIN IMMEDIATE");
      try {
        const shared = !!db.raw
          .prepare("SELECT id FROM artifacts WHERE sha256=? LIMIT 1")
          .get(sha);
        if (
          !shared &&
          storedBytes(db) + data.length - adoptedBytes > STORAGE_LIMIT
        )
          fail("storage_limit");
        const version = (
          db.raw
            .prepare(
              "SELECT COALESCE(MAX(version),0)+1 version FROM artifacts WHERE thread_id=? AND path=?",
            )
            .get(threadId, path) as { version: number }
        ).version;
        const id = randomUUID();
        db.raw
          .prepare("INSERT INTO artifacts VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
          .run(
            id,
            threadId,
            turnId,
            itemId,
            path,
            basename(path),
            type.kind,
            type.mime,
            data.length,
            sha,
            version,
            source,
            Date.now(),
          );
        if (itemId && source === "fileChange")
          db.raw
            .prepare(
              "UPDATE artifact_sources SET state='ready',artifact_id=?,reason=NULL WHERE thread_id=? AND turn_id=? AND item_id=? AND path=?",
            )
            .run(id, threadId, turnId, itemId, path);
        db.raw.exec("COMMIT");
        if (orphanSizes.has(sha)) {
          untrackedBytes -= orphanSizes.get(sha)!;
          orphanSizes.delete(sha);
          reserveUntracked(db, untrackedBytes);
        }
        return get(id);
      } catch (e) {
        db.raw.exec("ROLLBACK");
        throw e;
      }
    } catch (e) {
      if (created) await unlink(target).catch(() => {});
      throw e;
    }
  }
  return {
    get,
    image(
      threadId: string,
      turnId: string,
      itemId: string,
      input: { path?: string; data?: Buffer },
    ) {
      own(threadId);
      return serial(async () => {
        const root = workspaceRoot?.(threadId) || realpathSync(workspace);
        const data =
          input.data ??
          (await readBounded(pathOf(input.path!, true, root).full, true, root));
        const ext = imageExtension(data);
        const key = createHash("sha256")
          .update(itemId)
          .digest("hex")
          .slice(0, 24);
        return capture(
          threadId,
          turnId,
          `media/${key}/image${ext}`,
          itemId,
          data,
          "media",
        );
      });
    },
    list,
    maintenance,
    versions(id: string, before?: number) {
      const artifact = get(id);
      const rows = db.raw
        .prepare(
          `SELECT * FROM artifacts WHERE thread_id=? AND path=? ${before ? "AND version<?" : ""} ORDER BY version DESC LIMIT 51`,
        )
        .all(
          ...(before
            ? [artifact.threadId, artifact.path, before]
            : [artifact.threadId, artifact.path]),
        ) as Row[];
      const latestVersion = (
        db.raw
          .prepare(
            "SELECT MAX(version) latest FROM artifacts WHERE thread_id=? AND path=?",
          )
          .get(artifact.threadId, artifact.path) as { latest: number }
      ).latest;
      return {
        versions: rows.slice(0, 50).map(dto),
        latestVersion,
        nextBefore: rows.length > 50 ? rows[49].version : null,
      };
    },
    notices,
    decorate(thread: Thread) {
      const records = list(thread.id);
      const issues = notices(thread.id);
      for (const turn of thread.turns) {
        turn.artifacts = records.filter((a) => a.turnId === turn.id);
        turn.artifactNotices = issues.filter((a) => a.turnId === turn.id);
      }
      return thread;
    },
    register(threadId: string, turnId: string, input: string) {
      own(threadId);
      const { path } = pathOf(input, false, workspaceRoot?.(threadId) || root);
      return serial(() => capture(threadId, turnId, path, null));
    },
    completed(
      threadId: string,
      turnId: string,
      item: Json,
      changed: () => void,
    ) {
      if (
        !db.owns(threadId) ||
        !turnId ||
        item.type !== "fileChange" ||
        item.status !== "completed"
      )
        return;
      if ((item.changes?.length || 0) > 32) {
        db.raw
          .prepare(
            "INSERT OR IGNORE INTO artifact_sources VALUES(?,?,?,'','skipped','change_limit',NULL,?)",
          )
          .run(threadId, turnId, item.id, Date.now());
        changed();
      }
      // Only live events establish provenance. Reading old history must never capture current bytes as an old version.
      for (const change of (item.changes || []).slice(0, 32)) {
        if (change.kind?.type === "delete") continue;
        let path: string;
        try {
          path = pathOf(
            change.kind?.move_path || change.path,
            true,
            workspaceRoot?.(threadId) || root,
          ).path;
        } catch {
          continue;
        }
        const inserted = db.raw
          .prepare(
            "INSERT OR IGNORE INTO artifact_sources VALUES(?,?,?,?,'pending',NULL,NULL,?)",
          )
          .run(threadId, turnId, item.id, path, Date.now());
        if (!inserted.changes) continue;
        void serial(() => capture(threadId, turnId, path, item.id))
          .catch((e) => {
            db.raw
              .prepare(
                "UPDATE artifact_sources SET state='failed',reason=? WHERE thread_id=? AND turn_id=? AND item_id=? AND path=?",
              )
              .run(
                e instanceof CaptureError ? e.reason : "capture_failed",
                threadId,
                turnId,
                item.id,
                path,
              );
          })
          .finally(changed);
      }
    },
    async read(id: string) {
      assertStorageDirectory(folder);
      const artifact = get(id);
      let data: Buffer;
      try {
        data = await readBounded(join(folder, artifact.sha256), false);
      } catch (e) {
        fail(
          (e as NodeJS.ErrnoException).code === "ENOENT"
            ? "snapshot_missing"
            : "snapshot_corrupt",
        );
      }
      if (
        data.length !== artifact.size ||
        createHash("sha256").update(data).digest("hex") !== artifact.sha256
      )
        fail("snapshot_corrupt");
      return { artifact, data };
    },
    async workspaceFiles(input = "", offset = 0, threadId?: string) {
      try { return await physical.list(input, offset, workspaceRoot && threadId ? workspaceRoot(threadId) : root); }
      catch(e) { if(e instanceof WorkspaceFileError) fail(e.reason); throw e; }
    },
    async flush() {
      await queue;
    },
    async close() {
      closed = true;
      await queue;
    },
  };
}
export type ArtifactStore = ReturnType<typeof artifactStore>;
