import { z } from "zod";
import type { Codex } from "./codex.js";
import type { configuration } from "./configuration.js";
import type { PluginSummary } from "../generated/codex/v2/PluginSummary.js";
import type { UserInput } from "../generated/codex/v2/UserInput.js";
import type { PluginReference } from "../shared/types.js";
import { PublicError } from "./public-error.js";
export function pluginLibrary(
  codex: Codex,
  cwd: string,
  config: ReturnType<typeof configuration>,
) {
  const enabled = () =>
    process.env.EXPERIMENTAL_PLUGINS === "true" ||
    (process.env.NODE_ENV !== "production" &&
      process.env.EXPERIMENTAL_PLUGINS !== "false");
  async function native() {
    if (!enabled()) throw new PublicError("实验性插件未启用");
    return codex.call("plugin/list", {
      cwds: [cwd],
      marketplaceKinds: ["local"],
    });
  }
  function publicSummary(p: PluginSummary, marketplace: string) {
    return {
      id: p.id,
      name: p.name,
      displayName: p.interface?.displayName || p.name,
      description: p.interface?.shortDescription || "",
      installed: p.installed,
      enabled: p.enabled,
      available: p.availability === "AVAILABLE",
      installable: p.installPolicy !== "NOT_AVAILABLE",
      marketplace,
      version: p.localVersion || p.version,
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
    const detail = await codex.call("plugin/read", entry.params);
    return {
      ...publicSummary(detail.plugin.summary, entry.marketplace.name),
      description:
        detail.plugin.description ||
        entry.plugin.interface?.longDescription ||
        "",
      skills: detail.plugin.skills.map((s) => ({
        name: s.name,
        description: s.shortDescription || s.description,
        enabled: s.enabled,
      })),
      tools: detail.plugin.mcpServers,
    };
  }
  async function mutate(action: string, p: Record<string, unknown>) {
    const data = z
      .object({
        id: z.string().min(1).max(300),
        enabled: z.boolean().optional(),
        expectedRevision: z.string().optional(),
      })
      .parse(p);
    const entry = await locate(data.id);
    if (entry.plugin.availability !== "AVAILABLE")
      throw new PublicError("当前策略不允许使用此插件");
    if (action === "plugin/install") {
      if (entry.plugin.installPolicy === "NOT_AVAILABLE")
        throw new PublicError("当前策略不允许安装此插件");
      await codex.call("plugin/install", entry.params);
    } else if (action === "plugin/uninstall") {
      await codex.call("plugin/uninstall", { pluginId: entry.plugin.id });
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
  return { list, read, mutate, inputs, prepare, enabled };
}
