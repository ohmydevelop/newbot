import { confirmedPluginHooks } from "./plugin-hook-trust.js";
import type { PreparedResource } from "./extension-resources.js";
import type { Store } from "./db.js";
import { nativePluginAssets } from "./plugin-assets.js";
import { z } from "zod";
import { Codex } from "./codex.js";
import { join, relative } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileDigest, importTree } from "./import-files.js";
import type { configuration } from "./configuration.js";
import type { PluginSummary } from "../generated/codex/v2/PluginSummary.js";
import type { UserInput } from "../generated/codex/v2/UserInput.js";
import type { PluginReference } from "../shared/types.js";
import { PublicError } from "./public-error.js";
import type { pluginConnections } from "./plugin-connections.js";
import type { skillLibrary } from "./skills.js";
export function pluginLibrary(
  codex: Codex,
  cwd: string,
  config: ReturnType<typeof configuration>,
  db?: Store,
  connections?: ReturnType<typeof pluginConnections>,
  skills?: ReturnType<typeof skillLibrary>,
) {
  type Upgrade = {
    expectedVersion: string;
    targetVersion: string;
    enabled: boolean;
    skills: { name: string; path: string; enabled: boolean }[];
  };
  const upgrading = new Set<string>();
  const migrations = new Map<string, Promise<void>>();
  async function versionLegacy(plugin: PluginSummary, marketplace: string) {
    const extensions = config.extensions;
    if (!extensions || !codex.runtimeCapabilities?.pinnedPluginRoots) return;
    const resources = extensions.resources;
    const prior = resources.plugin(plugin.id);
    if (prior?.path.startsWith(resources.root + "/") || (!prior && !plugin.installed)) return;
    if (prior && JSON.parse(prior.content).installed === false) return;
    const pending = migrations.get(plugin.id);
    if (pending) return pending;
    const operation = resources.exclusive([prior?.id || fileDigest(`native-plugin:${plugin.id}`)], async () => {
      const cached = join(codex.home!, "plugins/cache", marketplace, plugin.name, plugin.localVersion || plugin.version || "");
      const source = prior?.path || cached;
      const prepared = await resources.prepare(prior?.id || fileDigest(`native-plugin:${plugin.id}`), (await importTree(source)).files);
      const state = extensions.snapshot().values;
      const choices = state.skills.config.filter((s) => s.path.startsWith(source + "/") || s.path.startsWith(cached + "/"));
      resources.publish(prepared, {
        kind:"plugin", name:plugin.name,
        content:{ ...(prior ? JSON.parse(prior.content) : {}), pluginId:plugin.id, version:plugin.localVersion || plugin.version },
      }, prior?.digest || null, () => extensions.setSkills(choices.map((s) => ({
        path:join(prepared.path, relative(s.path.startsWith(cached + "/") ? cached : source, s.path)), enabled:s.enabled,
      })), plugin.id, extensions.pluginEnabled(plugin.id,plugin.enabled), choices.map((s) => s.path)), () => extensions.reload());
    });
    migrations.set(plugin.id, operation);
    try { await operation; } finally { migrations.delete(plugin.id); }
  }
  const recovering = new Map<string, Promise<void>>();
  const upgradeKey = (id: string) => `plugin-upgrade:${id}`;
  function clearUpgrade(id: string) {
    db?.raw.prepare("DELETE FROM metadata WHERE key=?").run(upgradeKey(id));
  }
  async function finishUpgrade(id: string, pending: Upgrade) {
    if (!config.extensions) {
      clearUpgrade(id);
      return;
    }
    const after = await installedSkills(id);
    config.extensions.setSkills(
      after.map((s) => ({
        path: s.path,
        enabled:
          pending.skills.find((old) => old.name === s.name)?.enabled ?? false,
      })),
      id,
      pending.enabled,
      pending.skills.map((s) => s.path),
    );
    clearUpgrade(id);
  }
  async function recoverUpgrade(plugin: PluginSummary) {
    if (upgrading.has(plugin.id)) return;
    const active = recovering.get(plugin.id);
    if (active) return active;
    const value = db?.get(upgradeKey(plugin.id));
    const extensions = config.extensions;
    if (!value || !extensions) return;
    const operation = (async () => {
      const pending: Upgrade = JSON.parse(value);
      if (plugin.installed && plugin.localVersion === pending.targetVersion)
        await finishUpgrade(plugin.id, pending);
      else if (
        plugin.installed &&
        plugin.localVersion === pending.expectedVersion
      ) {
        extensions.setPlugin(plugin.id, pending.enabled, true);
        clearUpgrade(plugin.id);
      } else {
        extensions.setPlugin(plugin.id, false, plugin.installed);
        clearUpgrade(plugin.id);
      }
    })();
    recovering.set(plugin.id, operation);
    try {
      await operation;
    } finally {
      if (recovering.get(plugin.id) === operation) recovering.delete(plugin.id);
    }
  }
  const enabled = () =>
    process.env.EXPERIMENTAL_PLUGINS === "true" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.EXPERIMENTAL_PLUGINS !== "false");
  async function native() {
    if (!enabled()) throw new PublicError("实验性插件未启用");
    const result = await codex.call("plugin/list", {
      cwds: [cwd, ...(config.extensions?.marketplaceRoots() || [])],
      marketplaceKinds: ["local"],
    });
    for (const marketplace of result.marketplaces || [])
      for (const plugin of marketplace.plugins) {
        // Native local catalogs report the source manifest as localVersion.
        // Preserve it before overlaying the separately pinned installed version.
        if (plugin.source?.type === "local" && !plugin.version)
          plugin.version = plugin.localVersion;
        await versionLegacy(plugin, marketplace.name);
        const owned = config.extensions?.resources.plugin(plugin.id);
        if (owned && codex.runtimeCapabilities?.pinnedPluginRoots) {
          const metadata = JSON.parse(owned.content);
          plugin.installed = metadata.installed !== false;
          plugin.localVersion = plugin.installed ? metadata.version || null : null;
        }
        await recoverUpgrade(plugin);
        plugin.enabled =
          config.extensions?.pluginEnabled(plugin.id, plugin.enabled) ??
          plugin.enabled;
      }
    return result;
  }
  function publicSummary(p: PluginSummary, marketplace: string) {
    const imported = db?.raw
      .prepare(
        "SELECT content FROM extension_packages WHERE kind='plugin' AND name=?",
      )
      .get(p.name) as { content: string } | undefined;
    const owned =
      marketplace === "newbot-imports" &&
      imported &&
      JSON.parse(imported.content).installed !== false;
    return {
      id: p.id,
      name: p.name,
      displayName: p.interface?.displayName || p.name,
      description: p.interface?.shortDescription || "",
      installed: p.installed,
      enabled: config.extensions?.pluginEnabled(p.id, p.enabled) ?? p.enabled,
      available: p.availability === "AVAILABLE",
      installable: p.installPolicy !== "NOT_AVAILABLE",
      marketplace,
      version: p.localVersion || p.version,
      update: owned
        ? { kind: "import" as const, available: true }
        : {
            kind: "marketplace" as const,
            available: !!(
              p.installed &&
              p.localVersion &&
              p.version &&
              p.localVersion !== p.version
            ),
            currentVersion: p.localVersion,
            latestVersion: p.version,
            reason:
              p.source?.type === "local"
                ? "此插件由来源目录管理，目录更新后读取新内容"
                : "当前市场目录未提供可升级版本",
          },
    };
  }
  async function locate(id: string) {
    const result = await native();
    for (const marketplace of result.marketplaces || []) {
      const plugin = marketplace.plugins.find((p) => p.id === id);
      if (plugin)
        return {
          marketplace,
          plugin,
          params: {
            ...(marketplace.path
              ? { marketplacePath: marketplace.path }
              : { remoteMarketplaceName: marketplace.name }),
            pluginName: plugin.name,
          },
        };
    }
    throw new PublicError("插件不存在，请刷新目录");
  }
  async function list(includeTools = false) {
    if (!enabled())
      return {
        available: false,
        entries: [],
        warnings: 0,
        reason: "实验性插件未启用",
      };
    try {
      const result = await native();
      const entries = (result.marketplaces || []).flatMap((m) =>
        m.plugins.map((p) => ({
          ...publicSummary(p, m.name),
          tools: [] as string[],
        })),
      );
      let next = 0,
        ownershipWarnings = 0;
      if (includeTools)
        await Promise.all(
          Array.from({ length: Math.min(3, entries.length) }, async () => {
            while (next < entries.length) {
              const entry = entries[next++];
              if (!entry.installed) continue;
              try {
                entry.tools = (await read(entry.id)).tools;
              } catch {
                ownershipWarnings++;
              }
            }
          }),
        );
      return {
        available: true,
        entries,
        warnings:
          (result.marketplaceLoadErrors?.length || 0) + ownershipWarnings,
      };
    } catch {
      return {
        available: false,
        entries: [],
        warnings: 0,
        reason: "当前原生运行时未提供插件目录",
      };
    }
  }
  async function read(id: string) {
    const entry = await locate(id);
    const pinned = config.extensions?.resources.plugin(id);
    const params = pinned && codex.runtimeCapabilities?.pinnedPluginRoots
      ? {marketplacePath:await config.extensions!.resources.catalog(pinned,entry.marketplace.name),pluginName:entry.plugin.name}
      : entry.params;
    const detail = await codex.call("plugin/read", params);
    const owned = (await connections?.list(id)) || [];
    // plugin/read describes marketplace source files; execution and saved skill
    // choices use installed cache files. Never use source paths as runtime IDs.
    const installed = entry.plugin.installed
      ? await installedSkills(id)
      : undefined;
    if (installed)
      config.extensions?.reconcileSkillPaths(
        installed.flatMap((s) => {
          const source = detail.plugin.skills.find(
            (d) => d.name === s.name,
          )?.path;
          return source ? [{ source, installed: s.path }] : [];
        }),
      );
    return {
      ...publicSummary({ ...detail.plugin.summary, installed:entry.plugin.installed, localVersion:entry.plugin.localVersion, enabled:entry.plugin.enabled }, entry.marketplace.name),
      description:
        detail.plugin.description ||
        entry.plugin.interface?.longDescription ||
        "",
      skills: (installed || detail.plugin.skills).map((s) => ({
        id: s.path
          ? config.extensions?.asset({
              name: s.name,
              path: s.path,
              pluginId: id,
            })
          : undefined,
        name: s.name,
        description:
          ("shortDescription" in s && s.shortDescription) || s.description,
        enabled: s.path
          ? (config.extensions?.skillEnabled(s.path, s.enabled) ?? s.enabled)
          : s.enabled,
      })),
      tools: [
        ...new Set([
          ...detail.plugin.mcpServers.filter(
            (name) => !owned.some((c) => c.name === name),
          ),
          ...owned.map((c) => c.id),
        ]),
      ],
      connections: owned,
      extensionRevision: config.extensions?.revision,
      hooks: (detail.plugin.hooks || []).map((h) => h.eventName),
    };
  }
  async function installedSkills(pluginId: string) {
    const params = { cwds: [cwd], forceReload: true };
    const result =
      typeof codex.inspectExtensions === "function"
        ? await codex.inspectExtensions("skills/list", params, {
            [pluginId]: { enabled: true },
          })
        : await codex.call("skills/list", params);
    return result.data
      .flatMap((d) => d.skills)
      .filter((s) => s.pluginId === pluginId);
  }
  async function skill(action: string, input: Record<string, unknown>) {
    const p = z
      .object({
        pluginId: z.string().min(1).max(300),
        id: z.string().regex(/^[a-f0-9]{64}$/),
        expectedRevision: z.string().optional(),
        enabled: z.boolean().optional(),
      })
      .parse(input);
    const entry = await locate(p.pluginId);
    if (
      !entry.plugin.installed ||
      entry.plugin.availability !== "AVAILABLE" ||
      !skills
    )
      throw new PublicError("插件不可用");
    const component = (await installedSkills(p.pluginId)).find(
      (s) =>
        config.extensions?.asset(s) ===
        (config.extensions?.resolveAlias(p.id) || p.id),
    );
    if (!component) throw new PublicError("技能不属于此插件");
    const document = await skills.readCurrent({
      ...component,
      id: config.extensions?.asset(component) || p.id,
      enabled:
        config.extensions?.skillEnabled(component.path, component.enabled) ??
        component.enabled,
    });
    if (action === "plugin/skill/read") return document;
    if (
      !config.extensions ||
      p.expectedRevision !== config.extensions.revision ||
      p.enabled === undefined
    )
      throw new PublicError("插件技能状态已变化，请重新读取");
    config.extensions.setSkill(document.skill.path, p.enabled);
    return read(p.pluginId);
  }
  async function mutate(action: string, p: Record<string, unknown>) {
    const data = z
      .object({
        id: z.string().min(1).max(300),
        enabled: z.boolean().optional(),
        expectedRevision: z.string().optional(),
        expectedVersion: z.string().max(200).optional(),
        targetVersion: z.string().max(200).optional(),
      })
      .parse(p);
    const entry = await locate(data.id);
    if (entry.plugin.availability !== "AVAILABLE")
      throw new PublicError("当前策略不允许使用此插件");
    if (action !== "plugin/enabled" && config.extensions && db && codex.runtimeCapabilities?.pinnedPluginRoots) {
      const extensions = config.extensions, resources = extensions.resources;
      const prior = resources.plugin(data.id);
      const resourceId = prior?.id || fileDigest(`native-plugin:${data.id}`);
      await resources.collect();
      return resources.exclusive([resourceId], async () => {
        if (action === "plugin/uninstall") {
          if (prior) resources.retire(prior.id);
          extensions.setPlugin(data.id, false, false);
          connections?.remove(data.id);
          return list();
        }
        if (entry.plugin.installPolicy === "NOT_AVAILABLE") throw new PublicError("当前策略不允许安装此插件");
        if (action === "plugin/update" && (!prior || !data.targetVersion || entry.plugin.version !== data.targetVersion || entry.plugin.localVersion !== data.expectedVersion))
          throw new PublicError("插件版本与确认时不同，请刷新后重新选择");
        const previous = prior ? await installedSkills(data.id) : [];
        const preferences = () => JSON.stringify([
          extensions.pluginEnabled(data.id, entry.plugin.enabled),
          previous.map((s) => [s.name, extensions.skillEnabled(s.path,s.enabled)]),
        ]);
        const expectedPreferences = preferences();
        const staging = join(db.directory,"extensions","installers",randomUUID());
        const work = join(staging,"work");
        await mkdir(work,{recursive:true,mode:0o700});
        const installer = new Codex(work,()=>({CODEX_HOME:join(staging,"codex")}));
        let prepared: PreparedResource | undefined;
        try {
          // The native installer materializes Git/npm/local sources in its own cache.
          // It never owns the files used by conversations; npm lifecycle scripts are disabled upstream.
          await installer.start();
          if (installer.state !== "ready") throw new PublicError("隔离安装器未就绪");
          await installer.call("plugin/install",entry.params);
          const found = (await installer.call("plugin/list",{cwds:[cwd,...extensions.marketplaceRoots()],marketplaceKinds:["local"]}))
            .marketplaces.flatMap((m) => m.plugins).find((plugin) => plugin.id === data.id);
          if (!found?.installed || (data.targetVersion && found.localVersion !== data.targetVersion))
            throw new PublicError("原生安装器未确认目标版本");
          const source = join(installer.home!,"plugins/cache",entry.marketplace.name,entry.plugin.name,found.localVersion || found.version || "");
          prepared = await resources.prepare(resourceId,(await importTree(source)).files);
          const preparedPath = prepared.path;
          const hookTrust = await confirmedPluginHooks(db.directory,data.id,prepared.path);
          const actual = (await installer.call("skills/list",{cwds:[work],forceReload:true})).data.flatMap((d)=>d.skills).filter((s)=>s.pluginId === data.id);
          if (preferences() !== expectedPreferences) throw new PublicError("插件的启停或技能选择已变化，请重新确认");
          const detail = (await installer.call("plugin/read",entry.params)).plugin;
          resources.publish(prepared, {
            kind:"plugin",name:entry.plugin.name,content:{pluginId:data.id,version:found.localVersion || found.version,mcp:detail.mcpServers,source:entry.plugin.source,hookTrust},
          }, prior && JSON.parse(prior.content).installed !== false ? prior.digest : null, () => {
            extensions.setSkills(actual.map((s)=>({
              path:join(preparedPath,relative(source,s.path)),
              enabled: prior ? previous.some((old)=>old.name===s.name && extensions.skillEnabled(old.path,old.enabled)) : s.enabled,
            })),data.id,prior ? extensions.pluginEnabled(data.id,entry.plugin.enabled) : true,previous.map((s)=>s.path));
          }, () => extensions.reload());
        } finally {
          await installer.stopAndWait();
          await rm(staging,{recursive:true,force:true});
          if (prepared) await resources.discardPrepared(prepared);
        }
        return list();
      });
    }
    if (action === "plugin/update") {
      if (
        !entry.plugin.installed ||
        !data.expectedVersion ||
        !data.targetVersion ||
        entry.plugin.version !== data.targetVersion ||
        entry.plugin.installPolicy === "NOT_AVAILABLE"
      )
        throw new PublicError("市场版本或安装权限已变化，请刷新后重新确认升级");
      if (entry.plugin.localVersion === data.targetVersion) return list();
      if (entry.plugin.localVersion !== data.expectedVersion)
        throw new PublicError("已安装版本已变化，请刷新后重新确认升级");
      await read(data.id);
      const beforeEnabled = entry.plugin.enabled;
      const previousSkills = (await installedSkills(data.id)).map((s) => ({
        name: s.name,
        path: s.path,
        enabled:
          config.extensions?.skillEnabled(s.path, s.enabled) ?? s.enabled,
      }));
      const pending: Upgrade = {
        expectedVersion: data.expectedVersion,
        targetVersion: data.targetVersion,
        enabled: beforeEnabled,
        skills: previousSkills,
      };
      db?.set(upgradeKey(data.id), JSON.stringify(pending));
      config.extensions?.setPlugin(data.id, false, true);
      upgrading.add(data.id);
      try {
        try {
          await (config.extensions && db
            ? nativePluginAssets(codex, db, () =>
                codex.call("plugin/install", entry.params),
              )
            : codex.call("plugin/install", entry.params));
        } catch {
          // A missing native reply is not evidence that install failed. Read the
          // authoritative version once and finish preferences only if confirmed.
        }
        const actual = await locate(data.id);
        if (
          !actual.plugin.installed ||
          actual.plugin.localVersion !== data.targetVersion
        ) {
          config.extensions?.setPlugin(
            data.id,
            actual.plugin.localVersion === data.expectedVersion
              ? beforeEnabled
              : false,
            actual.plugin.installed,
          );
          clearUpgrade(data.id);
          throw new PublicError(
            "原生运行时尚未确认目标版本，请刷新插件状态；不会自动重复安装",
          );
        }
        await finishUpgrade(data.id, pending);
      } finally {
        upgrading.delete(data.id);
      }
    } else if (action === "plugin/install") {
      if (entry.plugin.installPolicy === "NOT_AVAILABLE")
        throw new PublicError("当前策略不允许安装此插件");
      await (config.extensions && db
        ? nativePluginAssets(codex, db, () =>
            codex.call("plugin/install", entry.params),
          )
        : codex.call("plugin/install", entry.params));
      if (config.extensions)
        config.extensions.setPlugin(entry.plugin.id, true, true);
    } else if (action === "plugin/uninstall") {
      await (config.extensions && db
        ? nativePluginAssets(codex, db, () =>
            codex.call("plugin/uninstall", { pluginId: entry.plugin.id }),
          )
        : codex.call("plugin/uninstall", { pluginId: entry.plugin.id }));
      if (config.extensions)
        config.extensions.setPlugin(entry.plugin.id, false, false);
      connections?.remove(entry.plugin.id);
    } else {
      if (
        !entry.plugin.installed ||
        data.enabled === undefined ||
        !data.expectedRevision
      )
        throw new PublicError("请刷新插件状态后重试");
      await config.mutate(data.expectedRevision, async () => ({
        edits: [
          {
            keyPath: `plugins.${JSON.stringify(entry.plugin.id)}.enabled`,
            value: data.enabled!,
            mergeStrategy: "replace",
          },
        ],
        effective: (after) =>
          (after.response.config.plugins as any)?.[entry.plugin.id]?.enabled ===
          data.enabled,
      }));
    }
    if (config.extensions) return list();
    await codex.call("config/mcpServer/reload", undefined);
    for (const id of [...codex.loaded]) await codex.unload(id);
    const actual = await locate(data.id);
    if (action === "plugin/enabled" && actual.plugin.enabled !== data.enabled)
      throw new PublicError("插件启停未生效，请重新读取状态");
    return list();
  }
  async function prepare(ids: string[]) {
    const results: UserInput[] = [],
      refs: PluginReference[] = [];
    for (const id of new Set(ids)) {
      const { plugin, params } = await locate(id);
      if (
        !plugin.installed ||
        !plugin.enabled ||
        plugin.availability !== "AVAILABLE"
      )
        throw new PublicError("所选插件已停用或不可用");
      refs.push({
        id: plugin.id,
        name: plugin.name,
        displayName: plugin.interface?.displayName || plugin.name,
      });
      results.push({
        type: "mention",
        name: plugin.name,
        path: `plugin://${plugin.id}`,
      });
    }
    return { inputs: results, references: refs };
  }
  async function inputs(ids: string[]) {
    return (await prepare(ids)).inputs;
  }
  return { list, read, mutate, inputs, prepare, enabled, skill };
}
