import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { Store } from "./db.js";
import type { Codex } from "./codex.js";
import { PublicError } from "./public-error.js";
import { prepareRuntimeIsolation } from "./runtime-isolation.js";
/** Native package APIs also write preferences. Preserve the original private file; SQLite owns choices. */
export async function nativePluginAssets<T>(
  codex: Codex,
  db: Store,
  fn: () => Promise<T>,
) {
  if (!codex.home) throw new PublicError("原生运行目录不可用");
  await prepareRuntimeIsolation(codex.home);
  const path = join(codex.home, "config.toml"),
    id = randomUUID();
  let prior: Buffer | null = null;
  try {
    prior = await readFile(path);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  db.raw
    .prepare("INSERT INTO extension_native_journal VALUES(?,?,?)")
    .run(id, path, prior);
  try {
    return await fn();
  } finally {
    if (prior === null) await rm(path, { force: true });
    else {
      await writeFile(path + ".restore", prior, { mode: 0o600 });
      await rename(path + ".restore", path);
    }
    db.raw.prepare("DELETE FROM extension_native_journal WHERE id=?").run(id);
  }
}
