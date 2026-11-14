import { lstat, readdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { importTree } from "./import-files.js";
import { PublicError } from "./public-error.js";

export class PluginInstallationError extends PublicError {}

/** A display manifest version is not necessarily Codex's cache version (curated uses a Git SHA). */
export async function installedPluginRoot(
  home: string,
  marketplace: string,
  name: string,
  version?: string | null,
) {
  const segment = (value: string) =>
    /^[A-Za-z0-9_.+-]+$/.test(value) && ![".", ".."].includes(value);
  if (!segment(marketplace) || !segment(name))
    throw new PluginInstallationError("插件缓存标识无效");
  const root = resolve(home, "plugins/cache", marketplace, name);
  const entries = (
    await readdir(root, { withFileTypes: true }).catch(() => {
      throw new PluginInstallationError("插件安装目录不可读，请重新安装插件");
    })
  ).filter((e) => e.isDirectory() && segment(e.name));
  // An isolated installer has exactly one activated version. Existing caches prefer
  // the upstream 'local' version or an exact manifest version; ambiguous legacy
  // caches must not silently import an arbitrary package.
  const selected =
    entries.length === 1
      ? entries[0].name
      : entries.find((e) => e.name === "local")?.name ||
        entries.find((e) => e.name === version)?.name;
  if (!selected)
    throw new PluginInstallationError(
      "无法确认插件的实际安装目录，请重新安装插件",
    );
  const path = join(root, selected);
  if (!(await lstat(path)).isDirectory() || (await realpath(path)) !== path)
    throw new PluginInstallationError("插件安装目录不能包含链接");
  return path;
}

/** A missing source must never be materialized as a valid empty installation. */
export async function installedPluginTree(path: string) {
  const stat = await lstat(path).catch(() => {
    throw new PluginInstallationError("插件安装目录缺失，请重新安装插件");
  });
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (await realpath(path)) !== resolve(path)
  )
    throw new PluginInstallationError("插件安装目录无效，请重新安装插件");
  const tree = await importTree(path);
  if (!tree.files.length)
    throw new PluginInstallationError("插件安装目录为空，请重新安装插件");
  return tree;
}
