import type { UserInput } from "../generated/codex/v2/UserInput.js";
import { createHash, randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { Codex } from "./codex.js";
import type { Workspaces } from "./workspaces.js";
import type { configuration } from "./configuration.js";
import type { skillLibrary } from "./skills.js";
import type { pluginLibrary } from "./plugins.js";
import type { Json } from "../shared/types.js";
import { PublicError } from "./public-error.js";
import type { ExtensionSnapshot } from "../shared/extension-snapshot.js";
import { localExtensionFiles, type RunnerExtensionFiles } from "./runner/extension-files.js";
export type { ExtensionSnapshot } from "../shared/extension-snapshot.js";
const digest = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
export function sessionExtensions(
  codex: Codex,
  workspaces: Workspaces,
  core: ReturnType<typeof configuration>,
  library: ReturnType<typeof skillLibrary>,
  plugins: ReturnType<typeof pluginLibrary>,
  files: RunnerExtensionFiles = localExtensionFiles(),
) {
  const { tree, prepare, currentFiles } = files;
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
  async function refresh(
    threadId: string,
    settings: { provider: string; approval: any; model?: string },
    providerRevision?: string,
  ) {
    const prior = workspaces.saved(threadId).snapshot.activePlugins || [];
    const catalog = await plugins.list();
    // Settings edits retain the last turn's usable selection. They must not
    // consume the next-input draft or re-enable removed/disabled plugins.
    const selected = prior
      .map((p: { id: string }) => p.id)
      .filter((id: string) => catalog.entries.some(
        (p) => p.id === id && p.installed && p.enabled && p.available,
      ));
    await sync(threadId, await capture(selected), settings, providerRevision);
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
  return { capture, prepare, sync, refresh, context, inputPaths };
}
