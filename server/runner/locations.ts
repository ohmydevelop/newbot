import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PublicError } from "../public-error.js";
export type RuntimeLocations = {
  layout: "legacy" | "standard";
  server: string;
  client: string;
  codex: string;
  workspaceRoot: string;
  legacyWorkspace: string;
  home: string | null;
};
function canonical(path: string): string {
  if (existsSync(path)) return realpathSync(path);
  const parent = dirname(path);
  return parent === path
    ? path
    : join(canonical(parent), relative(parent, path));
}
export function protectedPath(path: string, host = homedir()) {
  const actual = canonical(resolve(path));
  for (const personal of [join(host, ".codex"), join(host, ".agents")]) {
    const p = canonical(personal),
      r = relative(p, actual);
    if (!r || (!r.startsWith("../") && r !== ".." && !isAbsolute(r)))
      throw new PublicError("newbot 运行目录不能使用个人 Codex 或技能目录");
  }
  if (actual !== resolve(path))
    throw new PublicError("newbot 运行目录不能经过符号链接");
  const toHost = relative(actual, canonical(host));
  if (
    !toHost ||
    (!toHost.startsWith("../") && toHost !== ".." && !isAbsolute(toHost)) ||
    actual === dirname(actual)
  )
    throw new PublicError("newbot 需要独立的运行目录");
  return resolve(path);
}
/** Resolve only. Never moves data, creates directories or changes process HOME. */
// A repository installation is recognized by its persistent state, not by one
// file: clearing the database must not change where the instance lives.
const repositoryState = [
  "newbot.sqlite",
  "newbot.sqlite-wal",
  "newbot.sqlite-shm",
  "initial-password",
  "private-credentials.key",
  "codex",
  "workspaces",
  "runner",
];
function repositoryInstall(project: string): boolean {
  return repositoryState.some((name) =>
    existsSync(join(project, ".data", name)),
  );
}
export function runtimeLocations(
  options: {
    directory?: string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    hostHome?: string;
    project?: string;
  } = {},
): RuntimeLocations {
  const env = options.env || process.env,
    host = resolve(options.hostHome || homedir()),
    project = resolve(options.project || process.cwd());
  const explicitData = options.directory || env.DATA_DIR;
  const legacy =
    explicitData ||
    (!env.NEWBOT_HOME && repositoryInstall(project)
      ? join(project, ".data")
      : null);
  if (legacy) {
    const server = protectedPath(resolve(project, legacy), host);
    return {
      layout: "legacy",
      home: null,
      server,
      client: join(server, "runner"),
      codex: protectedPath(
        env.NEWBOT_CODEX_HOME || join(server, "codex"),
        host,
      ),
      workspaceRoot: protectedPath(
        env.NEWBOT_WORKSPACES_HOME || join(server, "workspaces"),
        host,
      ),
      legacyWorkspace: protectedPath(
        options.cwd || env.AGENT_WORKSPACE || join(server, "workspace"),
        host,
      ),
    };
  }
  const home = protectedPath(env.NEWBOT_HOME || join(host, ".newbot"), host);
  if (
    repositoryInstall(project) &&
    !existsSync(join(home, "server", "newbot.sqlite"))
  )
    throw new PublicError(
      "检测到旧实例；请先完成目录迁移，不能直接切换到空白运行目录",
    );
  const workspaces = protectedPath(
    env.NEWBOT_WORKSPACES_HOME || join(host, "Newbot", "workspaces"),
    host,
  );
  const distance = relative(home, workspaces),
    reverse = relative(workspaces, home);
  if (
    !distance ||
    !reverse ||
    (!distance.startsWith("../") && !isAbsolute(distance)) ||
    (!reverse.startsWith("../") && !isAbsolute(reverse))
  )
    throw new PublicError("会话工作区必须与 newbot 私密运行目录分离");
  return {
    layout: "standard",
    home,
    server: join(home, "server"),
    client: join(home, "client"),
    codex: protectedPath(env.NEWBOT_CODEX_HOME || join(home, "codex"), host),
    workspaceRoot: workspaces,
    legacyWorkspace: protectedPath(
      options.cwd || env.AGENT_WORKSPACE || join(home, "client", "scratch"),
      host,
    ),
  };
}
