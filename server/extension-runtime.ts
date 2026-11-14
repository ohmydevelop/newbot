import { marketplaceState } from "./marketplace-state.js";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.js";
import type { ConfigReadResponse } from "../generated/codex/v2/ConfigReadResponse.js";
import type { ConfigEdit } from "../generated/codex/v2/ConfigEdit.js";
import type { Skill } from "../shared/types.js";
import { mcpEditable } from "./mcp-policy.js";
import { PublicError } from "./public-error.js";
import { ExtensionResources } from "./extension-resources.js";
const id = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/)
  .refine((v) => !["constructor", "prototype", "__proto__"].includes(v));
const env = z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/);
const mcp = z
  .strictObject({
    command: z.string().min(1).max(4096).optional(),
    args: z.array(z.string().max(4096)).max(64).optional(),
    env_vars: z.array(env).max(32).optional(),
    url: z
      .string()
      .url()
      .max(2048)
      .refine((v) => {
        const u = new URL(v);
        return (
          ["http:", "https:"].includes(u.protocol) &&
          !u.username &&
          !u.password &&
          !u.search &&
          !u.hash
        );
      })
      .optional(),
    bearer_token_env_var: env.optional(),
    env_http_headers: z.record(z.string(), env).optional(),
    enabled: z.boolean().optional(),
    startup_timeout_sec: z.number().positive().optional(),
    tool_timeout_sec: z.number().positive().optional(),
    tls_ca_certificate: z.string().max(32768).optional(),
  })
  .refine((v) => Boolean(v.command) !== Boolean(v.url));
const content = z.strictObject({
  connector_names: z.record(id, z.string().trim().min(1).max(80)).default({}),
  mcp_servers: z.record(id, mcp.nullable()),
  plugins: z.record(
    z.string().min(1).max(300),
    z.strictObject({ enabled: z.boolean(), installed: z.boolean().optional() }),
  ),
  skills: z.strictObject({
    config: z
      .array(
        z.strictObject({
          path: z.string().min(1).max(4096),
          enabled: z.boolean(),
        }),
      )
      .max(1024),
  }),
});
type Values = z.infer<typeof content>;
export const extensionParameter = (path: string) =>
  /^(mcp_servers|plugins|skills|connector_names)(\.|$)/.test(path);
function parts(path: string) {
  const plugin = /^plugins\.("(?:[^"\\]|\\.)+")\.enabled$/.exec(path);
  const result = plugin
    ? ["plugins", JSON.parse(plugin[1]), "enabled"]
    : path.split(".");
  if (result.some((p) => ["__proto__", "constructor", "prototype"].includes(p)))
    throw new PublicError("扩展配置参数无效");
  return result;
}
/** Desired non-secret configuration. Native package files remain Codex-owned assets. */
export class ExtensionRuntime {
  readonly resources: ExtensionResources;
  revision = "";
  private value: Values = {
    connector_names: {},
    mcp_servers: {},
    plugins: {},
    skills: { config: [] },
  };
  private initialized = false;
  constructor(private db: Store) {
    this.resources = new ExtensionResources(db);
    const row = db.raw
      .prepare(
        "SELECT revision,content FROM extension_configuration WHERE id=1",
      )
      .get() as { revision: string; content: string } | undefined;
    if (row) {
      try {
        this.value = content.parse(JSON.parse(row.content));
        this.revision = row.revision;
        this.initialized = true;
      } catch {
        throw new PublicError("扩展配置无法读取，原数据未被覆盖");
      }
    }
  }
  private save(value: Values) {
    const validated = content.parse(value),
      serialized = JSON.stringify(validated);
    if (Buffer.byteLength(serialized) > 512 * 1024)
      throw new PublicError("扩展配置超过大小限制");
    const next = randomUUID();
    const result = this.initialized
      ? this.db.raw
          .prepare(
            "UPDATE extension_configuration SET revision=?,content=?,updated=? WHERE id=1 AND revision=?",
          )
          .run(next, serialized, Date.now(), this.revision)
      : this.db.raw
          .prepare(
            "INSERT INTO extension_configuration VALUES(1,?,?,?) ON CONFLICT(id) DO NOTHING",
          )
          .run(next, serialized, Date.now());
    if (Number(result.changes) !== 1)
      throw new PublicError(
        "扩展配置已由其他进程修改，请重新启动服务载入最新状态",
      );
    this.value = validated;
    this.revision = next;
    this.initialized = true;
  }
  snapshot() {
    return { revision: this.revision, values: structuredClone(this.value) };
  }
  reload() {
    const row = this.db.raw
      .prepare(
        "SELECT revision,content FROM extension_configuration WHERE id=1",
      )
      .get() as { revision: string; content: string } | undefined;
    if (!row) throw new PublicError("扩展配置恢复失败，请重启服务读取实际状态");
    this.value = content.parse(JSON.parse(row.content));
    this.revision = row.revision;
  }
  nativePlugins() {
    const pins = this.resources.pins();
    return Object.fromEntries(
      Object.entries(this.value.plugins).map(([id, p]) => [
        id,
        {
          enabled: p.installed !== false && p.enabled,
          ...(p.installed !== false ? pins[id] : {}),
        },
      ]),
    );
  }
  overlay(raw: ConfigReadResponse) {
    if (!this.initialized) {
      const value = structuredClone(this.value);
      for (const [key, def] of Object.entries(
        (raw.config as any).mcp_servers || {},
      )) {
        const parsed = mcp.safeParse(
          Object.fromEntries(
            Object.entries(def as object).filter(
              ([key, value]) =>
                value != null &&
                !(key === "environment_id" && value === "local"),
            ),
          ),
        );
        if (
          id.safeParse(key).success &&
          parsed.success &&
          mcpEditable(raw, key)
        )
          value.mcp_servers[key] = parsed.data;
      }
      for (const [key, def] of Object.entries(
        (raw.config as any).plugins || {},
      ))
        if (typeof (def as any)?.enabled === "boolean")
          value.plugins[key] = { enabled: (def as any).enabled };
      value.skills.config = ((raw.config as any).skills?.config || []).filter(
        (s: any) =>
          typeof s.path === "string" && typeof s.enabled === "boolean",
      );
      this.save(value);
    }
    const r = structuredClone(raw),
      config = r.config as any;
    config.mcp_servers = { ...(config.mcp_servers || {}) };
    const managed: string[] = [];
    for (const [key, def] of Object.entries(this.value.mcp_servers)) {
      const blocked = Object.entries(r.origins || {}).some(
        ([path, source]) =>
          (path === "mcp_servers" ||
            path === `mcp_servers.${key}` ||
            path.startsWith(`mcp_servers.${key}.`)) &&
          source &&
          (source.name.type !== "user" || source.name.profile != null),
      );
      if (blocked) continue;
      managed.push(key);
      if (def === null) delete config.mcp_servers[key];
      else config.mcp_servers[key] = structuredClone(def);
    }
    config.marketplaces = {
      ...(config.marketplaces || {}),
      ...this.marketplaceConfig(),
    };
    config.plugins = { ...(config.plugins || {}) };
    for (const [id, p] of Object.entries(this.value.plugins)) {
      if (p.installed === false) delete config.plugins[id];
      else
        config.plugins[id] = {
          ...config.plugins[id],
          enabled: p.enabled,
          ...this.resources.pins()[id],
        };
    }
    config.skills = {
      ...(config.skills || {}),
      config: structuredClone(this.value.skills.config),
    };
    Object.assign(r, {
      runtimeExtensionRevision: this.revision,
      runtimeMcpIds: managed,
      connectorNames: structuredClone(this.value.connector_names),
    });
    return r;
  }
  apply(expected: string, edits: ConfigEdit[]) {
    if (expected !== this.revision)
      throw new PublicError("扩展配置已变化，请重新读取");
    const value: any = structuredClone(this.value);
    for (const edit of edits) {
      if (!extensionParameter(edit.keyPath) || edit.mergeStrategy !== "replace")
        throw new PublicError("不支持的扩展配置参数");
      const keys = parts(edit.keyPath);
      let target = value;
      for (const key of keys.slice(0, -1)) target = target[key] ||= {};
      const key = keys.at(-1)!;
      if (edit.value === null && keys.length > 2) delete target[key];
      else target[key] = structuredClone(edit.value);
    }
    this.save(value);
  }
  invalidate() {
    this.save(structuredClone(this.value));
  }
  marketplaceRoots() {
    const path = this.db.get("imports:marketplace");
    return [
      ...(path ? [path] : []),
      ...marketplaceState(this.db).entries.map((e) => e.root),
    ];
  }
  marketplaceConfig() {
    const root = this.db.get("imports:marketplace");
    return {
      ...(root
        ? { "newbot-imports": { source_type: "local", source: root } }
        : {}),
      ...Object.fromEntries(
        marketplaceState(this.db).entries.map((e) => [
          e.name,
          { source_type: "local", source: e.root },
        ]),
      ),
    };
  }
  packageRoot(path: string) {
    const rows = this.db.raw
      .prepare("SELECT path FROM extension_packages WHERE kind='skills'")
      .all() as { path: string }[];
    return rows.find((row) => path.startsWith(row.path + "/"))?.path;
  }
  setPlugin(id: string, enabled: boolean, installed: boolean) {
    const value = structuredClone(this.value);
    value.plugins[id] = { enabled, installed };
    this.save(value);
    if (id.endsWith("@newbot-imports")) {
      const name = id.slice(0, -"@newbot-imports".length),
        rows = this.db.raw
          .prepare(
            "SELECT id,content FROM extension_packages WHERE kind='plugin' AND name=?",
          )
          .all(name) as { id: string; content: string }[];
      for (const r of rows)
        this.db.raw
          .prepare("UPDATE extension_packages SET content=? WHERE id=?")
          .run(JSON.stringify({ ...JSON.parse(r.content), installed }), r.id);
    }
  }
  setSkills(
    choices: { path: string; enabled: boolean }[],
    pluginId?: string,
    enabled = true,
    replacedPaths: string[] = [],
  ) {
    const value = structuredClone(this.value),
      paths = new Set([...choices.map((s) => s.path), ...replacedPaths]);
    value.skills.config = value.skills.config
      .filter((s) => !paths.has(s.path))
      .concat(choices);
    if (pluginId)
      value.plugins[pluginId] = {
        ...value.plugins[pluginId],
        enabled,
        installed: true,
      };
    this.save(value);
  }
  setSkill(path: string, enabled: boolean) {
    const value = structuredClone(this.value);
    value.skills.config = value.skills.config.filter((s) => s.path !== path);
    value.skills.config.push({ path, enabled });
    this.save(value);
  }
  reconcileSkillPaths(pairs: { source: string; installed: string }[]) {
    const value = structuredClone(this.value);
    let changed = false;
    for (const { source, installed } of pairs) {
      if (
        source === installed ||
        !value.skills.config.some((s) => s.path === source)
      )
        continue;
      // Earlier clients saved marketplace paths. Last explicit choice wins;
      // move that choice to the runtime path without altering other plugins.
      const chosen = value.skills.config
        .filter((s) => s.path === source || s.path === installed)
        .at(-1)!;
      value.skills.config = value.skills.config.filter(
        (s) => s.path !== source && s.path !== installed,
      );
      value.skills.config.push({ path: installed, enabled: chosen.enabled });
      changed = true;
    }
    if (changed) this.save(value);
  }
  skillEnabled(path: string, fallback: boolean) {
    return (
      this.value.skills.config.find((s) => s.path === path)?.enabled ?? fallback
    );
  }
  pluginEnabled(id: string, fallback: boolean) {
    return this.value.plugins[id]?.enabled ?? fallback;
  }
  /** Only controlled overrides enter a run snapshot; never copy arbitrary native settings/secrets. */
  config(raw: ConfigReadResponse) {
    const config: any = {
      marketplaces: this.marketplaceConfig(),
      plugins: Object.fromEntries(
        Object.entries(this.value.plugins)
          .filter(([, p]) => p.installed !== false)
          .map(([id, p]) => [id, { enabled: p.enabled }]),
      ),
      skills: structuredClone(this.value.skills),
      mcp_servers: {},
    };
    const native = (raw.config as any).mcp_servers || {};
    for (const [key, def] of Object.entries(this.value.mcp_servers)) {
      if (def) config.mcp_servers[key] = structuredClone(def);
      else if (native[key]) config.mcp_servers[key] = { enabled: false };
    }
    const owned = (raw.config as any).newbot_plugin_connections;
    if (owned) {
      config.newbot_plugin_connections = structuredClone(owned);
      for (const [id, owner] of Object.entries(owned) as [string, any][]) {
        config.mcp_servers[id] = structuredClone(native[id]);
        config.plugins[owner.pluginId] = structuredClone(
          (raw.config as any).plugins[owner.pluginId],
        );
      }
    }
    return config;
  }
  asset(skill: Pick<Skill, "path" | "name" | "pluginId">) {
    const identity = skill.pluginId
      ? `plugin:${skill.pluginId}:${skill.name}`
      : this.resources.logicalIdentity(skill.path) || `file:${skill.path}`;
    const old = this.db.raw
      .prepare("SELECT id,path,aliases FROM extension_assets WHERE identity=?")
      .get(identity) as
      | { id: string; path: string; aliases: string }
      | undefined;
    const hash = (v: string) => createHash("sha256").update(v).digest("hex");
    if (old) {
      this.db.raw
        .prepare("UPDATE extension_assets SET identity=? WHERE id=?")
        .run(identity, old.id);
      if (old.path !== skill.path) {
        const aliases = [
          ...new Set([...JSON.parse(old.aliases), hash(skill.path)]),
        ];
        this.db.raw
          .prepare("UPDATE extension_assets SET path=?,aliases=? WHERE id=?")
          .run(skill.path, JSON.stringify(aliases), old.id);
      }
      return old.id;
    }
    const assetId = hash(skill.path);
    this.db.raw
      .prepare("INSERT INTO extension_assets VALUES(?,?,?,?)")
      .run(assetId, identity, skill.path, JSON.stringify([assetId]));
    return assetId;
  }
  resolveAlias(id: string) {
    const rows = this.db.raw
      .prepare("SELECT id,aliases FROM extension_assets")
      .all() as { id: string; aliases: string }[];
    return (
      rows.find((r) => r.id === id || JSON.parse(r.aliases).includes(id))?.id ||
      id
    );
  }
}
