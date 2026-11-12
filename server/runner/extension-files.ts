import { randomUUID, createHash } from "node:crypto";
import {
  lstat,
  readdir,
  readFile,
  mkdir,
  writeFile,
  rename,
  rm,
  realpath,
} from "node:fs/promises";
import { join, dirname, basename, resolve, relative } from "node:path";
import { PublicError } from "../public-error.js";
import { IMPORT_LIMITS } from "../../shared/imports.js";
import type { ExtensionSnapshot } from "../../shared/extension-snapshot.js";
import type { Json } from "../../shared/types.js";
const digest = (v: string | Buffer) =>
  createHash("sha256").update(v).digest("hex");
async function tree(root: string) {
  if ((await realpath(root)) !== resolve(root))
    throw new PublicError("技能资源目录不能包含链接");
  const files: { path: string; data: Buffer; mode: number }[] = [];
  let bytes = 0;
  async function scan(dir: string, prefix = "") {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name),
        info = await lstat(path),
        rel = prefix + name;
      if (info.isSymbolicLink())
        throw new PublicError("技能资源包含链接，请改为普通文件后重试");
      if (info.isDirectory()) {
        await scan(path, rel + "/");
        continue;
      }
      if (
        !info.isFile() ||
        info.nlink !== 1 ||
        info.size > IMPORT_LIMITS.fileBytes ||
        files.length >= IMPORT_LIMITS.files ||
        (bytes += info.size) > IMPORT_LIMITS.packageBytes
      )
        throw new PublicError("技能资源超过复制限制或包含特殊文件");
      const data = await readFile(path),
        after = await lstat(path);
      if (
        info.ino !== after.ino ||
        info.mtimeMs !== after.mtimeMs ||
        info.size !== data.length
      )
        throw new PublicError("技能资源正在变化，请重试");
      files.push({ path: rel, data, mode: info.mode & 0o111 ? 0o700 : 0o600 });
    }
  }
  await scan(root);
  const hash = createHash("sha256");
  for (const f of files)
    hash.update(f.path + "\0" + f.mode + "\0").update(f.data);
  return { files, digest: hash.digest("hex") };
}
async function ensureDirectories(root: string, parts: string[]) {
  let path = root;
  for (const part of parts) {
    path = join(path, part);
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const info = await lstat(path);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(path)) !== path
    )
      throw new PublicError("扩展同步目录不能包含链接");
  }
  return path;
}
/** Local resource IO. Server owns the desired snapshot; this module only materializes it. */
export function localExtensionFiles() {
  async function prepare(root: string, snapshot: ExtensionSnapshot) {
    const projection = join(root, ".agents", "skills"),
      staging = join(root, ".newbot", `stage-${randomUUID()}`);
    await ensureDirectories(root, [".agents", "skills"]);
    await ensureDirectories(root, [".newbot", basename(staging)]);
    if (
      (await realpath(projection)) !== projection ||
      (await realpath(staging)) !== staging
    )
      throw new PublicError("扩展同步目录不能包含链接");
    const backups: { target: string; backup: string }[] = [],
      created: string[] = [];
    async function rollback() {
      for (const path of created)
        await rm(path, { recursive: true, force: true });
      for (const old of backups) await rename(old.backup, old.target);
      await rm(staging, { recursive: true, force: true });
    }
    try {
      const config = structuredClone(snapshot.config),
        resources = [];
      const roots = new Map<string, string>();
      for (const resource of snapshot.resources) {
        const resourceRoot = resource.resourceRoot || dirname(resource.path);
        let target = roots.get(resourceRoot);
        if (!target) {
          const source = await tree(resourceRoot);
          if (source.digest !== resource.digest)
            throw new PublicError("技能资源已变化，请重新发送");
          const folder = `newbot-${resource.resourceRoot ? digest(resourceRoot) : resource.id}`;
          target = join(projection, folder);
          const stage = join(staging, folder);
          await mkdir(stage, { mode: 0o700 });
          for (const file of source.files) {
            const path = join(stage, file.path);
            await mkdir(dirname(path), { recursive: true, mode: 0o700 });
            await writeFile(path, file.data, { mode: file.mode, flag: "wx" });
          }
          roots.set(resourceRoot, target);
        }
        const projectPath = join(target, relative(resourceRoot, resource.path));
        resources.push({ ...resource, projectPath, projectRoot: target });
      }
      // Preserve disabled siblings in a shared imported tree. Otherwise native
      // recursive discovery would accidentally re-enable their copied files.
      const projected = new Map<string, boolean>();
      for (const skill of snapshot.config.skills.config as {
        path: string;
        enabled: boolean;
      }[]) {
        for (const [source, target] of roots)
          if (skill.path.startsWith(source + "/")) {
            projected.set(skill.path, false);
            projected.set(
              join(target, relative(source, skill.path)),
              skill.enabled,
            );
            break;
          }
      }
      config.skills.config = config.skills.config
        .filter((s: Json) => !projected.has(s.path))
        .concat([...projected].map(([path, enabled]) => ({ path, enabled })));
      // Only our reserved projection folders are replaced; user-authored project skills remain intact.
      for (const folder of await readdir(projection))
        if (/^newbot-[a-f0-9]{64}$/.test(folder)) {
          const target = join(projection, folder),
            info = await lstat(target);
          if (!info.isDirectory() || info.isSymbolicLink())
            throw new PublicError("技能投放目录已变化");
          const backup = join(staging, `old-${folder}`);
          await rename(target, backup);
          backups.push({ target, backup });
        }
      for (const target of roots.values()) {
        await rename(join(staging, basename(target)), target);
        created.push(target);
      }
      return {
        snapshot: { ...snapshot, config, resources },
        commit: () => rm(staging, { recursive: true, force: true }),
        rollback,
      };
    } catch (error) {
      await rollback();
      throw error;
    }
  }
  async function currentFiles(snapshot: ExtensionSnapshot) {
    for (const r of snapshot.resources) {
      if (!r.projectPath) return false;
      try {
        if (
          (await tree(r.projectRoot || dirname(r.projectPath))).digest !==
          r.digest
        )
          return false;
      } catch {
        return false;
      }
    }
    return true;
  }
  return { tree, prepare, currentFiles };
}
export type RunnerExtensionFiles = ReturnType<typeof localExtensionFiles>;
