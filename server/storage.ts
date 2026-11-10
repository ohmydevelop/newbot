import { PublicError } from "./public-error.js";
import { lstatSync, realpathSync } from "node:fs";
import type { Store } from "./db.js";
export const STORAGE_LIMIT = 512 * 1024 * 1024;
export const RETENTION_MS = 24 * 60 * 60 * 1000;
const untracked = new WeakMap<Store, number>();
export function reserveUntracked(db: Store, bytes: number) {
  untracked.set(db, Math.max(0, bytes));
}
export function registeredUsage(db: Store) {
  const uploads = db.raw
    .prepare(
      "SELECT COUNT(*) count,COALESCE(SUM(size),0) bytes FROM attachments",
    )
    .get() as { count: number; bytes: number };
  const snapshots = db.raw
    .prepare(
      "SELECT COUNT(*) count,COALESCE(SUM(size),0) bytes FROM (SELECT MAX(size) size FROM artifacts GROUP BY sha256)",
    )
    .get() as { count: number; bytes: number };
  const versions = (
    db.raw.prepare("SELECT COUNT(*) count FROM artifacts").get() as {
      count: number;
    }
  ).count;
  return { uploads, snapshots, versions };
}
export function storedBytes(db: Store) {
  const { uploads, snapshots } = registeredUsage(db);
  return uploads.bytes + snapshots.bytes + (untracked.get(db) || 0);
}

export function assertStorageDirectory(path: string) {
  const info = lstatSync(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    realpathSync(path) !== path
  )
    throw new PublicError("文件存储目录无效，不能使用链接目录");
}
