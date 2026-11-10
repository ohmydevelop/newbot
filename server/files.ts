import { PublicError } from "./public-error.js";
import {
  storedBytes,
  STORAGE_LIMIT,
  assertStorageDirectory,
} from "./storage.js";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  statSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { join, basename, extname } from "node:path";
import type { Thread, Json } from "../shared/types.js";
import type { Store } from "./db.js";
import type { UserInput } from "../generated/codex/v2/UserInput.js";
const textExtensions = new Set([
  ".txt",
  ".md",
  ".json",
  ".csv",
  ".log",
  ".ts",
  ".tsx",
  ".js",
  ".py",
  ".html",
  ".css",
  ".yaml",
  ".yml",
  ".toml",
]);
export function fileStore(directory: string, db: Store) {
  const folder = join(realpathSync(directory), "uploads");
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  assertStorageDirectory(folder);
  // Preserve untracked uploads from older installations; only new, unsent files expire.
  for (const row of db.raw
    .prepare("SELECT key,value FROM metadata WHERE key LIKE 'file:%'")
    .all() as { key: string; value: string }[]) {
    const meta = JSON.parse(row.value);
    const id = row.key.slice(5);
    if (!/^[\da-f-]{36}$/.test(id) || !existsSync(join(folder, id))) continue;
    db.raw
      .prepare("INSERT OR IGNORE INTO attachments VALUES(?,?,?,?,?,1)")
      .run(
        id,
        meta.name,
        meta.mime,
        meta.size,
        statSync(join(folder, id)).mtimeMs,
      );
    db.raw.prepare("DELETE FROM metadata WHERE key=?").run(row.key);
  }
  function metadata(id: string) {
    assertStorageDirectory(folder);
    if (!/^[\da-f-]{36}$/.test(id)) throw new PublicError("附件不存在");
    const entry = db.raw
      .prepare("SELECT * FROM attachments WHERE id=?")
      .get(id) as
      | { id: string; name: string; mime: string; size: number }
      | undefined;
    if (!entry) throw new PublicError("附件不存在");
    return entry;
  }
  function cleanup(now = Date.now()) {
    assertStorageDirectory(folder);
    const rows = db.raw
      .prepare(
        "SELECT id FROM attachments WHERE legacy=0 AND created<? AND NOT EXISTS(SELECT 1 FROM run_attachments WHERE file_id=attachments.id)",
      )
      .all(now - 86400000) as { id: string }[];
    for (const { id } of rows) {
      try {
        unlinkSync(join(folder, id));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      db.raw.prepare("DELETE FROM attachments WHERE id=?").run(id);
    }
    return rows.length;
  }
  return {
    cleanup,
    unbind(requestId: string) {
      db.raw
        .prepare("DELETE FROM run_attachments WHERE request_id=?")
        .run(requestId);
    },
    bind(requestId: string, ids: string[]) {
      for (const id of new Set(ids)) {
        metadata(id);
        db.raw
          .prepare("INSERT OR IGNORE INTO run_attachments VALUES(?,?)")
          .run(requestId, id);
      }
    },
    decorate(thread: Thread) {
      const rows = db.raw
        .prepare(
          "SELECT r.turn_id,r.client_message_id,a.id,a.name,a.mime FROM runs r JOIN run_attachments ra ON ra.request_id=r.request_id JOIN attachments a ON a.id=ra.file_id WHERE r.thread_id=?",
        )
        .all(thread.id) as Json[];
      for (const turn of thread.turns) {
        for (const item of turn.items.filter((i) => i.type === "userMessage")) {
          const refs = rows.filter(
            (r) =>
              r.client_message_id === item.clientId ||
              r.client_message_id === item.id ||
              (r.turn_id === turn.id &&
                turn.items.find((i) => i.type === "userMessage")?.id ===
                  item.id),
          );
          if (!refs.length) continue;
          item.content = [
            ...(item.content || [])
              .filter((c) => c.type === "text")
              .slice(0, 1),
            ...refs.map((r) => ({
              type: r.mime.startsWith("image/") ? "image" : "attachment",
              url: `/api/files/${r.id}`,
              name: r.name,
            })),
          ];
        }
      }
      return thread;
    },
    save(name: string, data: Buffer) {
      name = basename(name)
        .replace(/[\x00-\x1f\x7f]/g, "")
        .slice(0, 160);
      if (!name || !data.length || data.length > 8 * 1024 * 1024)
        throw new PublicError("附件为空或超过 8 MiB");
      let mime = "text/plain";
      if (
        data
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      )
        mime = "image/png";
      else if (data[0] === 255 && data[1] === 216 && data[2] === 255)
        mime = "image/jpeg";
      else if (
        data.toString("ascii", 0, 4) === "RIFF" &&
        data.toString("ascii", 8, 12) === "WEBP"
      )
        mime = "image/webp";
      else {
        if (
          !textExtensions.has(extname(name).toLowerCase()) ||
          data.includes(0) ||
          data.length > 200000
        )
          throw new PublicError(
            "支持 PNG、JPEG、WebP，或不超过 200 KB 的纯文本与代码文件",
          );
        new TextDecoder("utf-8", { fatal: true }).decode(data);
      }
      cleanup();
      if (storedBytes(db) + data.length > STORAGE_LIMIT)
        throw new PublicError("文件存储已达到 512 MiB 上限");
      const id = randomUUID();
      writeFileSync(join(folder, id), data, { mode: 0o600, flag: "wx" });
      db.raw
        .prepare("INSERT INTO attachments VALUES(?,?,?,?,?,0)")
        .run(id, name, mime, data.length, Date.now());
      return { id, name, mime };
    },
    read(id: string) {
      const meta = metadata(id);
      return { ...meta, data: readFileSync(join(folder, id)) };
    },
    inputs(ids: string[]): UserInput[] {
      if (ids.length > 8) throw new PublicError("每条消息最多 8 个附件");
      let size = 0;
      return ids.map((id) => {
        const meta = metadata(id);
        size += meta.size;
        if (size > 16 * 1024 * 1024)
          throw new PublicError("单条消息附件总大小不能超过 16 MiB");
        if (meta.mime.startsWith("image/"))
          return { type: "localImage" as const, path: join(folder, id) };
        return {
          type: "text" as const,
          text: `\n附件：${meta.name}\n\n${readFileSync(join(folder, id), "utf8")}`,
          text_elements: [],
        };
      });
    },
  };
}
export type FileStore = ReturnType<typeof fileStore>;
