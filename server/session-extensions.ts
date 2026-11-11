import type { UserInput } from "../generated/codex/v2/UserInput.js";
import { createHash, randomUUID } from "node:crypto";
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
import type { Codex } from "./codex.js";
import type { Workspaces } from "./workspaces.js";
import type { configuration } from "./configuration.js";
import type { skillLibrary } from "./skills.js";
import type { pluginLibrary } from "./plugins.js";
import type { Json } from "../shared/types.js";
import { PublicError } from "./public-error.js";
import { IMPORT_LIMITS } from "../shared/imports.js";
export type ExtensionSnapshot = {
  revision: string;
  config: Json;
  disabledPluginIds: string[];
  activePlugins?: { id: string; version: string | null }[];
  resources: {
    id: string;
    path: string;
    digest: string;
    projectPath?: string;
    resourceRoot?: string;
    projectRoot?: string;
  }[];
};
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
export function sessionExtensions(
  codex: Codex,
  workspaces: Workspaces,
  core: ReturnType<typeof configuration>,
  library: ReturnType<typeof skillLibrary>,
  plugins: ReturnType<typeof pluginLibrary>,
) {
  const pending = new Map<
    string,
    { cwd: string; revision: string; config: Json }
  >();
  const context = (id: string) =>
    pending.get(id) || {
      cwd: workspaces.root(id),
      revision: workspaces.saved(id).revision,
      config: workspaces.saved(id).snapshot.config || {},
    };
  codex.executionContext = context;
  async function capture(selectedPluginIds: string[] = []): Promise<ExtensionSnapshot | undefined> {
    if (!core.extensions) return undefined;
    // Legacy resources may be migrated by catalog discovery. Capture the revision
    // after that publication, then discover skills against those same pins.
    const pluginCatalog = await plugins.list();
    const before = await core.read(),
      configured = core.extensions.snapshot();
    const catalog = await library.list();
    const config = core.extensions.config(before.response),
      resources: ExtensionSnapshot["resources"] = [];
    const selected = new Set(selectedPluginIds);
    for (const id of selected) {
      const plugin = pluginCatalog.entries.find((entry) => entry.id === id);
      if (!plugin?.installed || !plugin.enabled || !plugin.available)
        throw new PublicError("引用的插件已停用、卸载或不可用，请重新选择");
    }
    config.plugins ||= {};
    for (const id of Object.keys(config.plugins)) config.plugins[id] = { ...config.plugins[id], enabled: false };
    for (const plugin of pluginCatalog.entries)
      if (plugin.installed)
        config.plugins[plugin.id] = {
          ...config.plugins[plugin.id],
          enabled: selected.has(plugin.id) && plugin.enabled && plugin.available,
        };
    if (codex.runtimeCapabilities?.pinnedPluginRoots) {
      config.plugins._default = { enabled: false };
      for (const pluginId of selected) {
        const pin = core.extensions.resources.pins()[pluginId];
        if (!pin) throw new PublicError("此插件尚未完成资源版本迁移，请刷新插件目录后重试");
        Object.assign(config.plugins[pluginId], pin);
        const pkg = core.extensions.resources.plugin(pluginId);
        const hookTrust = pkg && JSON.parse(pkg.content).hookTrust;
        if (hookTrust) config.hooks = { ...config.hooks, state:{...config.hooks?.state,...hookTrust} };
      }
    }
    config.skills.config = catalog.skills.map((s) => ({
      path: s.path,
      enabled: s.enabled && (!s.pluginId || selected.has(s.pluginId)),
    }));
    for (const path of catalog.hiddenPaths || []) config.skills.config.push({path,enabled:false});
    for (const [id, owner] of Object.entries(
      config.newbot_plugin_connections || {},
    ) as [string, any][])
      if (!selected.has(owner.pluginId) || config.plugins[owner.pluginId]?.enabled !== true)
        config.mcp_servers[id].enabled = false;
    const trees = new Map<string, Awaited<ReturnType<typeof tree>>>();
    let totalBytes = 0,
      totalFiles = 0;
    for (const skill of catalog.skills) {
      if (
        !skill.enabled ||
        skill.pluginId ||
        !["user", "repo"].includes(skill.scope)
      )
        continue;
      await library.readCurrent(skill); // Validate this catalog snapshot without discovering it once per skill.
      const resourceRoot =
        core.extensions.packageRoot(skill.path) || dirname(skill.path);
      let current = trees.get(resourceRoot);
      if (!current) {
        current = await tree(resourceRoot);
        trees.set(resourceRoot, current);
        totalBytes += current.files.reduce((n, f) => n + f.data.length, 0);
        totalFiles += current.files.length;
        if (totalBytes > 128 * 1024 * 1024 || totalFiles > 8192)
          throw new PublicError(
            "启用技能资源超过 128 MiB 或 8192 个文件的会话预算",
          );
      }
      resources.push({
        id: skill.id,
        path: skill.path,
        digest: current.digest,
        ...(core.extensions.packageRoot(skill.path) ? { resourceRoot } : {}),
      });
    }
    if (core.extensions.revision !== configured.revision)
      throw new PublicError("扩展配置在准备期间变化，请重试");
    const disabledPluginIds = pluginCatalog.entries
      .filter((p) => !selected.has(p.id) || !p.enabled || !p.available)
      .map((p) => p.id);
    const value = {
      config,
      resources,
      disabledPluginIds,
      plugins: pluginCatalog.entries.map((p) => [p.id, p.version, p.enabled]),
      sourceRevision: configured.revision,
    };
    return {
      revision: digest(JSON.stringify(value)),
      config,
      resources,
      disabledPluginIds,
      activePlugins: pluginCatalog.entries.filter((p) => selected.has(p.id)).map((p) => ({ id: p.id, version: p.version })),
    };
  }
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
  async function sync(
    threadId: string,
    snapshot: ExtensionSnapshot | undefined,
    settings: { provider: string; approval: any; model?: string },
    providerRevision?: string,
  ) {
    if (!snapshot) return;
    if (codex.active.has(threadId))
      throw new PublicError("会话正在执行，稍后再同步扩展");
    const old = workspaces.saved(threadId);
    if (
      old.revision === snapshot.revision &&
      (await currentFiles(old.snapshot))
    )
      return;
    const root = workspaces.root(threadId),
      prepared = await prepare(root, snapshot);
    pending.set(threadId, {
      cwd: root,
      revision: snapshot.revision,
      config: prepared.snapshot.config,
    });
    try {
      if (codex.loaded.has(threadId)) await codex.unload(threadId);
      await codex.resume(
        threadId,
        settings.provider,
        settings.approval,
        settings.model,
        providerRevision,
      );
      workspaces.confirm(threadId, snapshot.revision, prepared.snapshot);
      await prepared.commit();
    } catch (error) {
      await prepared.rollback();
      pending.delete(threadId);
      try {
        await codex.resume(
          threadId,
          settings.provider,
          settings.approval,
          settings.model,
          providerRevision,
        );
      } catch {
        /* Prior confirmed snapshot stays authoritative for a later retry. */
      }
      throw error;
    } finally {
      pending.delete(threadId);
    }
  }
  function inputPaths(threadId: string, inputs: UserInput[]) {
    const resources: ExtensionSnapshot["resources"] =
      workspaces.saved(threadId).snapshot.resources || [];
    return inputs.map((input) =>
      input.type === "skill"
        ? {
            ...input,
            path:
              resources.find((r) => r.path === input.path)?.projectPath ||
              input.path,
          }
        : input,
    );
  }
  return { capture, prepare, sync, context, inputPaths };
}
