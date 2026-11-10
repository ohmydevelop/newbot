import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { PublicError } from "./public-error.js";

const within = (root: string, path: string) => {
  const part = relative(root, path);
  return !part || (!part.startsWith("..") && !isAbsolute(part));
};
async function canonical(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return join(await canonical(dirname(path)), basename(path));
  }
}
async function privateDirectory(path: string) {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new PublicError("Codex 运行目录不能使用符号链接或文件");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
}

/** Only child-process locations change. The host process and personal Codex remain untouched. */
export async function prepareRuntimeIsolation(
  home: string,
  hostHome = homedir(),
) {
  const codexHome = resolve(home),
    host = await canonical(resolve(hostHome));
  const target = await canonical(codexHome);
  const protectedHomes = await Promise.all([
    canonical(join(host, ".codex")),
    canonical(join(host, ".agents")),
  ]);
  if (
    protectedHomes.some((root) => within(root, target)) ||
    within(target, host)
  )
    throw new PublicError(
      "newbot 必须使用独立 Codex 目录，不能使用宿主的 .codex 或 .agents",
    );
  await privateDirectory(codexHome);
  // A redirected state directory or file would undo CODEX_HOME isolation.
  for (const name of await readdir(codexHome))
    try {
      const info = await lstat(join(codexHome, name));
      if (info.isSymbolicLink() || (info.isFile() && info.nlink !== 1))
        throw new PublicError("Codex 状态文件不能链接到其他运行环境");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  const userHome = join(codexHome, "runtime-home");
  await privateDirectory(userHome);
  const paths = {
    CODEX_HOME: codexHome,
    CODEX_SQLITE_HOME: codexHome,
    HOME: userHome,
    XDG_CONFIG_HOME: join(userHome, ".config"),
    XDG_DATA_HOME: join(userHome, ".local", "share"),
    XDG_STATE_HOME: join(userHome, ".local", "state"),
    XDG_CACHE_HOME: join(userHome, ".cache"),
  };
  for (const path of Object.values(paths)) {
    if (!within(target, await canonical(path)))
      throw new PublicError("Codex 用户目录不能链接到其他运行环境");
    await privateDirectory(path);
  }
  return { codexHome, userHome, env: paths };
}
