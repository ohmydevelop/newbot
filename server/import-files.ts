import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { crc32 } from "node:zlib";
import { openPromise } from "yauzl";
import { IMPORT_LIMITS as limits } from "../shared/imports.js";
import { PublicError } from "./public-error.js";
export const fileDigest = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
export function importPath(value: string) {
  const parts = value.split("/");
  if (
    !value ||
    value.length > 1024 ||
    isAbsolute(value) ||
    /[\\\x00-\x1f:]/.test(value) ||
    parts.length > limits.depth ||
    parts.some((p) => !p || [".", "..", ".git"].includes(p) || p.length > 200)
  )
    throw new PublicError(
      "包内路径无效：不能包含越界、链接、Git 元数据或过深目录",
    );
  return parts.join("/");
}
export function inside(root: string, path: string) {
  const rel = relative(root, path);
  return (
    rel === "" || (!rel.startsWith("../") && rel !== ".." && !isAbsolute(rel))
  );
}
export async function ensureImportDirectory(root: string, path = root) {
  if (!inside(root, path)) throw new PublicError("导入目录越界");
  await mkdir(path, { recursive: true, mode: 0o700 });
  let current = path;
  while (inside(root, current)) {
    const info = await lstat(current);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(current)) !== resolve(current)
    )
      throw new PublicError("导入目录不能包含链接");
    if (current === root) break;
    current = dirname(current);
  }
}
export type ImportFile = {
  path: string;
  data: Buffer;
  mode: number;
  sha256: string;
};
export async function importTree(
  root: string,
  maxBytes: number = limits.totalBytes,
) {
  const files: ImportFile[] = [];
  let bytes = 0;
  await ensureImportDirectory(root);
  async function walk(dir: string, prefix = "") {
    for (const name of (await readdir(dir)).sort()) {
      const rel = importPath(prefix + name),
        path = join(root, rel),
        before = await lstat(path);
      if (before.isSymbolicLink())
        throw new PublicError(`不支持链接文件：${rel}`);
      if (before.isDirectory()) {
        await walk(path, rel + "/");
        continue;
      }
      if (!before.isFile() || before.nlink !== 1)
        throw new PublicError(`不支持特殊或硬链接文件：${rel}`);
      if (before.size > limits.fileBytes)
        throw new PublicError(
          `单文件超过 ${limits.fileBytes / 1024 / 1024} MiB 上限：${rel}`,
        );
      if ((bytes += before.size) > maxBytes || files.length >= limits.files)
        throw new PublicError("导入资源超过文件数量或大小预算");
      const handle = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      let data: Buffer;
      try {
        const stat = await handle.stat();
        if (
          stat.ino !== before.ino ||
          stat.size !== before.size ||
          stat.nlink !== 1
        )
          throw new PublicError("导入文件在读取时变化");
        data = Buffer.alloc(before.size);
        let n = 0;
        while (n < data.length) {
          const r = await handle.read(data, n, data.length - n, n);
          if (!r.bytesRead) break;
          n += r.bytesRead;
        }
        const after = await handle.stat();
        if (
          n !== data.length ||
          after.mtimeMs !== before.mtimeMs ||
          after.ctimeMs !== before.ctimeMs ||
          (await realpath(path)) !== path
        )
          throw new PublicError("导入文件在读取时变化");
      } finally {
        await handle.close();
      }
      files.push({
        path: rel,
        data,
        mode: before.mode & 0o111 ? 0o700 : 0o600,
        sha256: fileDigest(data),
      });
    }
  }
  await walk(root);
  const digest = fileDigest(
    files.map((f) => `${f.path}\0${f.mode}\0${f.sha256}`).join("\n"),
  );
  return { files, bytes, digest };
}
export async function writeImportTree(root: string, files: ImportFile[]) {
  await ensureImportDirectory(root);
  for (const file of files) {
    const path = join(root, importPath(file.path));
    await ensureImportDirectory(root, dirname(path));
    await writeFile(path, file.data, { mode: file.mode, flag: "wx" });
  }
}
export async function extractImportZip(path: string, root: string) {
  const size = (await lstat(path)).size;
  if (size > limits.archiveBytes) throw new PublicError("ZIP 超过 40 MiB 上限");
  const archive = await openPromise(path, {
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  let bytes = 0,
    count = 0;
  const paths = new Set<string>();
  try {
    if (archive.entryCount > limits.files + limits.files)
      throw new PublicError("ZIP 条目过多");
    for await (const entry of archive.eachEntry()) {
      const directory = entry.fileName.endsWith("/"),
        rel = importPath(
          directory ? entry.fileName.slice(0, -1) : entry.fileName,
        );
      const mode = (entry.externalFileAttributes >>> 16) & 0xffff,
        type = mode & 0o170000;
      if (
        entry.isEncrypted() ||
        !entry.canDecodeFileData() ||
        (type && ![0o100000, 0o040000].includes(type)) ||
        (type === 0o040000 && !directory)
      )
        throw new PublicError(`ZIP 包含加密、链接或特殊文件：${rel}`);
      if (paths.has(rel)) throw new PublicError(`ZIP 包含重复路径：${rel}`);
      paths.add(rel);
      if (directory) {
        await ensureImportDirectory(root, join(root, rel));
        continue;
      }
      if (entry.uncompressedSize > limits.fileBytes)
        throw new PublicError(
          `单文件超过 ${limits.fileBytes / 1024 / 1024} MiB 上限：${rel}`,
        );
      if (
        ++count > limits.files ||
        (bytes += entry.uncompressedSize) > limits.totalBytes ||
        (entry.uncompressedSize > 1024 * 1024 &&
          entry.uncompressedSize > Math.max(1, entry.compressedSize) * 200)
      )
        throw new PublicError("ZIP 解压大小、文件数或膨胀比例超过限制");
      const stream = await archive.openReadStreamPromise(entry);
      const chunks: Buffer[] = [];
      let actual = 0;
      for await (const chunk of stream) {
        actual += chunk.length;
        if (actual > entry.uncompressedSize || actual > limits.fileBytes) {
          stream.destroy();
          throw new PublicError("ZIP 解压内容超过声明大小");
        }
        chunks.push(chunk);
      }
      const data = Buffer.concat(chunks);
      if (actual !== entry.uncompressedSize || crc32(data) !== entry.crc32)
        throw new PublicError("ZIP 文件校验失败");
      const target = join(root, rel);
      await ensureImportDirectory(root, dirname(target));
      await writeFile(target, data, {
        mode: mode & 0o111 ? 0o700 : 0o600,
        flag: "wx",
      });
    }
  } finally {
    archive.close();
  }
  return importTree(root);
}
