import { PublicError } from "./public-error.js";
import {
  storedBytes,
  storageLimit,
  assertStorageDirectory,
} from "./storage.js";
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  statSync,
  realpathSync,
} from "node:fs";
import { join, basename, extname } from "node:path";
import { docxText, pdfText } from "./attachment-text.js";
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
const DEFAULT_BYTE_LIMIT = 8 * 1024 * 1024;
export const ATTACHMENT_BYTE_MIN = 1024 * 1024;
export const ATTACHMENT_BYTE_MAX = 64 * 1024 * 1024;
/** Any file may be attached; this is the per-file ceiling. */
export function attachmentByteLimit(db: Store) {
  const value = Number(db.get("upload:max-bytes"));
  return Number.isInteger(value) &&
    value >= ATTACHMENT_BYTE_MIN &&
    value <= ATTACHMENT_BYTE_MAX
    ? value
    : DEFAULT_BYTE_LIMIT;
}
export function setAttachmentByteLimit(db: Store, bytes: number) {
  db.set("upload:max-bytes", String(bytes));
  return attachmentByteLimit(db);
}
export const ATTACHMENT_TOTAL_LIMIT = 64 * 1024 * 1024;
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
      const limit = attachmentByteLimit(db);
      if (!name || !data.length || data.length > limit)
        throw new PublicError(
          `附件为空或超过 ${Math.round(limit / 1024 / 1024)} MiB`,
        );
      let mime = "";
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
      else if (data.subarray(0, 5).toString("ascii") === "%PDF-")
        mime = "application/pdf";
      else if (
        data.subarray(0, 2).toString("ascii") === "PK" &&
        /^\s*(docx|xlsx|pptx|zip)$/i.test(extname(name).slice(1))
      )
        mime = "application/zip";
      if (!mime) {
        // Anything decodable as bounded UTF-8 text stays inline; every other
        // file is accepted as binary and handed to the agent through the
        // conversation workspace.
        const textLimit = attachmentByteLimit(db);
        const printable =
          !data.includes(0) &&
          textExtensions.has(extname(name).toLowerCase()) === true;
        try {
          if (printable && data.length <= textLimit) {
            new TextDecoder("utf-8", { fatal: true }).decode(data);
            mime = "text/plain";
          }
        } catch {
          /* Invalid UTF-8: treat as binary. */
        }
        if (!mime) mime = "application/octet-stream";
      }
      cleanup();
      const quota = storageLimit(db);
      if (quota !== null && storedBytes(db) + data.length > quota)
        throw new PublicError(
          "文件存储已达到配置的上限，请先清理文件或在设置中调整",
        );
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
    async inputs(ids: string[], workspaceRoot?: string): Promise<UserInput[]> {
      if (ids.length > 8) throw new PublicError("每条消息最多 8 个附件");
      const textLimit = attachmentByteLimit(db);
      const copy = (meta: { name: string }, id: string) => {
        const folderPath = join(workspaceRoot!, "attachments");
        mkdirSync(folderPath, { recursive: true, mode: 0o755 });
        const safe =
          basename(meta.name).replace(/[^\w.\-\u4e00-\u9fff ]+/g, "_") ||
          "attachment";
        let path = join(folderPath, safe);
        for (let n = 2; existsSync(path) && n < 100; n++)
          path = join(folderPath, `${n}-${safe}`);
        copyFileSync(join(folder, id), path);
        chmodSync(path, 0o644);
        return path;
      };
      let size = 0;
      const out: UserInput[] = [];
      for (const id of ids) {
        const meta = metadata(id);
        size += meta.size;
        if (size > ATTACHMENT_TOTAL_LIMIT)
          throw new PublicError("单条消息附件总大小不能超过 64 MiB");
        if (meta.mime.startsWith("image/")) {
          out.push({ type: "localImage" as const, path: join(folder, id) });
          continue;
        }
        if (meta.mime.startsWith("text/")) {
          out.push({
            type: "text" as const,
            text: `\n附件：${meta.name}\n\n${readFileSync(join(folder, id), "utf8")}`,
            text_elements: [],
          });
          continue;
        }
        // Office/PDF documents are read inline when their text fits; the file
        // still lands in the workspace so the agent can inspect the original.
        let extracted: string | undefined;
        const bytes = readFileSync(join(folder, id));
        if (/^application\/zip$/.test(meta.mime) && /\.docx$/i.test(meta.name))
          extracted = docxText(bytes);
        else if (meta.mime === "application/pdf")
          extracted = await pdfText(bytes, textLimit);
        if (!workspaceRoot) {
          out.push({
            type: "text" as const,
            text: extracted
              ? `\n附件：${meta.name}\n\n${extracted}`
              : `\n附件：${meta.name}（${meta.mime}，${meta.size} 字节）。该文件为二进制，未放入工作区。`,
            text_elements: [],
          });
          continue;
        }
        const path = copy(meta, id);
        out.push(
          extracted && extracted.length <= textLimit
            ? {
                type: "text" as const,
                text: `\n附件：${meta.name}（原文件已保存到工作区 attachments/${basename(path)}）\n\n${extracted}`,
                text_elements: [],
              }
            : {
                type: "text" as const,
                text: `\n附件已保存到工作区：attachments/${basename(path)}（${meta.mime}，${meta.size} 字节）。这是二进制文件，请用文件或命令行工具读取、解析或转换后再回答。`,
                text_elements: [],
              },
        );
      }
      return out;
    },
  };
}
export type FileStore = ReturnType<typeof fileStore>;
