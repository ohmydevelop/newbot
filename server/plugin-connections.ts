import { mcpCertificate } from "./mcp-certificate.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { ConfigReadResponse } from "../generated/codex/v2/ConfigReadResponse.js";
import type { Json } from "../shared/types.js";
import {
  pluginConfigurationSave,
  type PluginConnection,
  type PluginConfigurationSave,
} from "../shared/plugin-configuration.js";
import type { Store } from "./db.js";
import type { ExtensionRuntime } from "./extension-runtime.js";
import type { credentialVault } from "./credential-vault.js";
import type { CredentialConsumer } from "./credentials.js";
import {
  fieldKey,
  privateFieldBinding,
  reconcilePrivateRow,
} from "./private-fields.js";
import {
  pluginConnectionId,
  pluginDescriptors,
  resolvePluginConfiguration,
  type PluginDescriptor,
} from "./plugin-descriptor.js";
import { PublicError } from "./public-error.js";
import { certificateRequest } from "../shared/certificates.js";
import type { CertificateObservation } from "../shared/certificates.js";

type Package = { name: string; path: string; digest: string; content: string };
type Setting = {
  revision: string;
  package_digest: string;
  schema_digest: string;
  content: string;
};
type SecretRow = { binding: string; packet: string | null; specs: string };
export function pluginConnections(
  db: Store,
  extensions: ExtensionRuntime | undefined,
  vault?: ReturnType<typeof credentialVault>,
  supportsCustomCa: () => boolean = () => false,
) {
  const owners = new Map<
    string,
    { pluginId: string; server: string; source: string }
  >();
  const packages = () =>
    (
      db.raw
        .prepare(
          "SELECT name,path,digest,content FROM extension_packages WHERE kind='plugin'",
        )
        .all() as Package[]
    ).filter((p) => JSON.parse(p.content).installed !== false);
  const setting = (d: PluginDescriptor) =>
    db.raw
      .prepare(
        "SELECT * FROM plugin_connection_settings WHERE plugin_id=? AND server=?",
      )
      .get(d.pluginId, d.name) as Setting | undefined;
  const secretRow = (id: string) =>
    db.raw
      .prepare(
        "SELECT binding,packet,specs FROM private_field_sets WHERE scope='mcp' AND target=?",
      )
      .get(id) as SecretRow | undefined;
  async function descriptors(pluginId: string): Promise<PluginDescriptor[]> {
    const p = packages().find(
      (p) =>
        (JSON.parse(p.content).pluginId || `${p.name}@newbot-imports`) ===
        pluginId,
    );
    if (!p) return [];
    try {
      return await pluginDescriptors(pluginId, p.path, p.digest);
    } catch (error) {
      // Retain declared ownership on corruption. Never fall back to native startup.
      const servers: string[] = JSON.parse(p.content).mcp || [];
      return (servers.length ? servers : [p.name]).map((name) => ({
        pluginId,
        name,
        id: pluginConnectionId(pluginId, name),
        root: p.path,
        digest: p.digest,
        schemaDigest: p.digest,
        definition: { command: "" },
        fields: [],
        source: "package" as const,
        reason:
          error instanceof PublicError
            ? error.message
            : "插件资源无法读取，请重新导入",
      }));
    }
  }
  function configuration(
    d: PluginDescriptor,
    values: Record<string, unknown>,
    trust?: { address: string; certificate: string },
  ) {
    const resolved = resolvePluginConfiguration(d, values);
    if (
      trust &&
      trust.address === resolved.definition.url &&
      trust.address.startsWith("https://")
    )
      resolved.definition.tls_ca_certificate = mcpCertificate(
        trust.certificate,
      );
    return {
      ...resolved,
      config: {
        mcp_servers: { [d.id]: resolved.definition },
        newbot_plugin_connections: {
          [d.id]: {
            pluginId: d.pluginId,
            server: d.name,
            packageDigest: d.digest,
            schemaDigest: d.schemaDigest,
            packageRoot: d.root,
          },
        },
      } as Json,
    };
  }
  function secrets(d: PluginDescriptor, config: Json) {
    const row = secretRow(d.id);
    if (!row?.packet || !vault) return {} as Record<string, string>;
    // A package upgrade keeps the same destination, so the reconciled row keeps
    // the credential; a changed URL/command/env still yields no secret.
    const reconciled = reconcilePrivateRow(
      db,
      vault,
      { scope: "mcp", target: d.id, binding: row.binding, packet: row.packet },
      config,
    );
    if (!reconciled) return {};
    let bytes: Buffer | undefined;
    try {
      bytes = vault.openPrivate(
        reconciled.packet,
        `fields:mcp:${d.id}:${reconciled.binding}`,
      );
      return JSON.parse(bytes.toString("utf8")) as Record<string, string>;
    } catch {
      return {};
    } finally {
      bytes?.fill(0);
    }
  }
  function ordinary(
    d: PluginDescriptor,
    input: Record<string, unknown>,
    strict: boolean,
  ) {
    const result: Record<string, string | number | boolean> = {};
    if (
      Object.keys(input).some(
        (k) => !d.fields.some((f) => f.id === k && !f.sensitive),
      )
    )
      throw new PublicError("设置包含未声明或敏感字段");
    for (const f of d.fields.filter((f) => !f.sensitive)) {
      const v = input[f.id] ?? f.default;
      if (v === undefined || v === "") {
        if (strict && f.required) throw new PublicError(`请填写${f.title}`);
        continue;
      }
      if (
        typeof v !== f.type ||
        (typeof v === "string" && (v.length > 4096 || /[\0\r\n]/.test(v))) ||
        (typeof v === "number" &&
          (!Number.isFinite(v) ||
            (f.min !== undefined && v < f.min) ||
            (f.max !== undefined && v > f.max)))
      )
        throw new PublicError(`${f.title}格式不正确`);
      result[f.id] = v as string | number | boolean;
    }
    return result;
  }
  function state(d: PluginDescriptor) {
    const row = setting(d);
    const current =
      row?.package_digest === d.digest && row.schema_digest === d.schemaDigest;
    const saved = row ? JSON.parse(row.content) : {};
    // Keep compatible ordinary fields for review after an upgrade. A changed
    // package remains inactive until saved; secrets retain their old binding.
    const compatible: Record<string, unknown> = {};
    for (const f of d.fields.filter((f) => !f.sensitive)) {
      const value = saved.values?.[f.id];
      if (value === undefined) continue;
      try {
        ordinary({ ...d, fields: [f] }, { [f.id]: value }, false);
        compatible[f.id] = value;
      } catch {
        /* Changed field type/range needs fresh input. */
      }
    }
    const values = ordinary(d, compatible, false);
    const enabled = saved.enabled !== false;
    let resolved: ReturnType<typeof configuration> | undefined;
    let stored: Record<string, string> = {};
    let configured = false;
    if (!d.reason) {
      try {
        resolved = configuration(d, values, saved.trust);
        stored = secrets(d, resolved.config);
        ordinary(d, values, true);
        configured =
          (!row || current) &&
          !resolved.secrets.some(
            (f) => f.required && !stored[fieldKey(f.field)],
          );
      } catch {
        /* Missing ordinary values are an unconfigured connection. */
      }
    }
    return {
      row,
      values,
      enabled,
      resolved,
      stored,
      configured,
      changed: !!row && !current,
    };
  }
  async function list(pluginId: string): Promise<PluginConnection[]> {
    return (await descriptors(pluginId)).map((d) => {
      const s = state(d);
      const missing = d.fields.filter(
        (f) =>
          f.required &&
          (f.sensitive
            ? !s.resolved?.secrets.some(
                (x) => x.id === f.id && s.stored[fieldKey(x.field)],
              )
            : s.values[f.id] === undefined || s.values[f.id] === ""),
      );
      return {
        id: d.id,
        pluginId,
        name: d.name,
        revision: s.row?.revision || "absent",
        schemaDigest: d.schemaDigest,
        enabled: s.enabled,
        configured: s.configured,
        transport: d.definition.url ? "http" : "stdio",
        ...(d.definition.url
          ? {
              endpointTemplate: d.definition.url,
              caCertificate: s.resolved?.definition.tls_ca_certificate,
            }
          : {}),
        source: d.source,
        reviewRequired: s.changed && !d.reason,
        reason:
          d.reason ||
          (s.changed
            ? "插件内容已更新，请复核后重新启用（接收方未变化的凭证会保留）"
            : undefined) ||
          (s.enabled && !s.configured
            ? missing.length
              ? `缺少${missing.map((f) => `“${f.title}”`).join("、")}`
              : "连接器配置不完整，请检查配置"
            : undefined),
        fields: d.fields.map(({ default: _default, ...f }) => ({
          ...f,
          ...(f.sensitive
            ? {
                stored: !!s.resolved?.secrets.some(
                  (x) => x.id === f.id && s.stored[fieldKey(x.field)],
                ),
              }
            : { value: s.values[f.id] }),
        })),
      };
    });
  }
  async function requireConfigured(pluginIds: string[], snapshot?: Json) {
    for (const pluginId of new Set(pluginIds)) {
      for (const c of await list(pluginId)) {
        // An intentionally disabled component does not prevent a plugin's other
        // skills/components from being used. Incomplete enabled ones must be explicit.
        if (!c.enabled) continue;
        if (!c.configured || c.reason)
          throw new PublicError(
            `插件“${pluginId.split("@")[0]}”的连接器“${c.name}”未就绪：${c.reason || "配置不完整"}。请在插件设置中补齐后继续。`,
          );
        if (
          snapshot &&
          (!snapshot.mcp_servers?.[c.id] ||
            snapshot.mcp_servers[c.id].enabled === false)
        )
          throw new PublicError(
            `连接器“${c.name}”的本轮配置尚未就绪，请确认插件配置后重新发送。`,
          );
      }
    }
  }
  async function overlay(raw: ConfigReadResponse) {
    const response = structuredClone(raw),
      config = response.config as Json;
    config.mcp_servers ||= {};
    config.plugins ||= {};
    config.newbot_plugin_connections = {};
    for (const p of packages()) {
      const pluginId =
        JSON.parse(p.content).pluginId || `${p.name}@newbot-imports`;
      for (const d of await descriptors(pluginId)) {
        owners.set(d.id, { pluginId, server: d.name, source: "newbot-plugin" });
        const s = state(d);
        const plugin = (config.plugins[pluginId] ||= {
          enabled: extensions?.pluginEnabled(pluginId, true) ?? true,
        });
        const policyBlocked = Object.entries(response.origins || {}).some(
          ([path, origin]) =>
            (path === "mcp_servers" ||
              path === `mcp_servers.${d.id}` ||
              path === "plugins" ||
              path === `plugins.${pluginId}`) &&
            origin &&
            origin.name.type !== "user",
        );
        // The original stays a plugin component, but this fixed core needs the
        // host's top-level runtime adapter for private env/header injection.
        plugin.mcp_servers = {
          ...plugin.mcp_servers,
          [d.name]: { ...plugin.mcp_servers?.[d.name], enabled: false },
        };
        config.mcp_servers[d.id] = {
          ...(s.resolved?.definition || {
            command: "disabled-plugin-connection",
          }),
          enabled:
            !policyBlocked &&
            !d.reason &&
            plugin.enabled !== false &&
            s.enabled &&
            s.configured,
        };
        config.newbot_plugin_connections[d.id] = {
          pluginId,
          server: d.name,
          packageDigest: d.digest,
          schemaDigest: d.schemaDigest,
          packageRoot: d.root,
        };
      }
    }
    return response;
  }
  async function prepare(
    input: PluginConfigurationSave,
  ): Promise<CredentialConsumer> {
    const p = pluginConfigurationSave.parse(input);
    const locate = async () => {
      const d = (await descriptors(p.pluginId)).find(
        (d) => d.id === p.connectionId,
      );
      if (!d || d.reason)
        throw new PublicError(d?.reason || "插件连接器已移除");
      if (
        d.schemaDigest !== p.schemaDigest ||
        (setting(d)?.revision || "absent") !== p.expectedRevision
      )
        throw new PublicError("插件配置已变化，请重新读取");
      return d;
    };
    const before = await locate();
    const values = ordinary(before, p.values, p.enabled);
    const previousTrust = setting(before)
      ? JSON.parse(setting(before)!.content).trust
      : undefined;
    const candidate = resolvePluginConfiguration(before, values);
    let trust =
      previousTrust?.address === candidate.definition.url
        ? previousTrust
        : undefined;
    if (p.caCertificate !== undefined) {
      trust = undefined;
      if (p.caCertificate) {
        if (!supportsCustomCa())
          throw new PublicError(
            "当前运行内核不支持连接器独立证书，请先更新服务",
          );
        if (
          !String(candidate.definition.url).startsWith("https://") ||
          p.certificateAddress !== candidate.definition.url
        )
          throw new PublicError(
            "证书与当前 HTTPS 连接地址不匹配，请重新获取或选择",
          );
        trust = {
          address: p.certificateAddress,
          certificate: mcpCertificate(p.caCertificate),
        };
      }
    }
    const resolved = configuration(before, values, trust);
    if (resolved.secrets.length && !vault)
      throw new PublicError("插件私密配置不可用");
    if (
      p.clearSecrets.some(
        (id) => !before.fields.some((f) => f.id === id && f.sensitive),
      )
    )
      throw new PublicError("清除字段不属于此插件");
    return {
      receiver: before.name,
      targetId: before.id,
      run: async (bytes, _signal, authorized, commit) => {
        const d = await locate();
        if (!authorized()) throw new PublicError("配置请求已失效");
        const decoded = Buffer.from(bytes.toString("ascii"), "base64");
        let supplied: Record<string, string>;
        try {
          supplied = z
            .record(
              z.string(),
              z
                .string()
                .max(4096)
                .refine((v) => !/[\0\r\n]/.test(v)),
            )
            .parse(JSON.parse(decoded.toString("utf8")));
        } finally {
          decoded.fill(0);
        }
        if (
          Object.keys(supplied).some(
            (id) => !d.fields.some((f) => f.id === id && f.sensitive),
          )
        )
          throw new PublicError("私密字段不属于此插件");
        const next = secrets(d, resolved.config);
        const prior = state(d).stored;
        for (const f of resolved.secrets) {
          const key = fieldKey(f.field);
          if (p.clearSecrets.includes(f.id)) delete next[key];
          if (supplied[f.id]) next[key] = supplied[f.id];
        }
        const invalidated = resolved.secrets.filter(
          (f) =>
            prior[fieldKey(f.field)] &&
            !next[fieldKey(f.field)] &&
            !p.clearSecrets.includes(f.id),
        );
        if (invalidated.length)
          throw new PublicError(
            `连接配置已变化，请重新填写${invalidated.map((f) => `“${d.fields.find((v) => v.id === f.id)!.title}”`).join("、")}后保存；原配置和凭证已保留。`,
          );
        const missing = resolved.secrets.filter(
          (f) =>
            f.required &&
            !next[fieldKey(f.field)] &&
            !p.clearSecrets.includes(f.id),
        );
        if (p.enabled && missing.length)
          throw new PublicError(
            `请填写${missing.map((f) => `“${d.fields.find((v) => v.id === f.id)!.title}”`).join("、")}后保存；原配置未修改。`,
          );
        // Clearing a required secret is valid; the connection becomes pending configuration.
        const bound = privateFieldBinding("mcp", d.id, resolved.config);
        const plain = Buffer.from(JSON.stringify(next));
        let packet: string | null;
        try {
          packet = resolved.secrets.length
            ? vault!.sealPrivate(plain, `fields:mcp:${d.id}:${bound}`)
            : null;
        } finally {
          plain.fill(0);
        }
        const specs = resolved.secrets
          .filter((f) => f.required || next[fieldKey(f.field)])
          .map((f) => f.field);
        db.raw.exec("BEGIN IMMEDIATE");
        try {
          if ((setting(d)?.revision || "absent") !== p.expectedRevision)
            throw new PublicError("插件配置已变化，请重新读取");
          commit();
          db.raw
            .prepare(
              "INSERT OR REPLACE INTO plugin_connection_settings VALUES(?,?,?,?,?,?)",
            )
            .run(
              d.pluginId,
              d.name,
              randomUUID(),
              d.digest,
              d.schemaDigest,
              JSON.stringify({
                values,
                enabled: p.enabled,
                ...(trust ? { trust } : {}),
              }),
            );
          db.raw
            .prepare(
              "INSERT OR REPLACE INTO private_field_sets VALUES('mcp',?,?,?,?,?)",
            )
            .run(d.id, randomUUID(), bound, JSON.stringify(specs), packet);
          db.raw
            .prepare(
              "UPDATE private_operations SET result=?,updated=? WHERE id=?",
            )
            .run(
              JSON.stringify({
                id: p.requestId,
                operation: p.operation,
                targetId: d.id,
                state: "succeeded",
                committed: true,
                applied: true,
                expiresAt: Date.now(),
              }),
              Date.now(),
              p.requestId,
            );
          db.raw.exec("COMMIT");
        } catch (e) {
          db.raw.exec("ROLLBACK");
          throw e;
        }
        return { state: "succeeded", applied: true };
      },
    };
  }
  async function certificate(
    input: unknown,
    inspect: (address: string) => Promise<CertificateObservation>,
  ) {
    const p = certificateRequest.parse(input);
    const check = async () => {
      const d = (await descriptors(p.pluginId)).find(
        (d) => d.id === p.connectionId,
      );
      if (!d || d.reason)
        throw new PublicError(d?.reason || "插件连接器已移除");
      if (
        d.schemaDigest !== p.schemaDigest ||
        (setting(d)?.revision || "absent") !== p.expectedRevision
      )
        throw new PublicError("插件配置已变化，请重新打开插件设置");
      if (
        !d.fields.some(
          (f) => f.id === p.fieldId && f.type === "string" && !f.sensitive,
        )
      )
        throw new PublicError("服务地址必须来自插件声明的普通文本字段");
    };
    await check();
    const result = await inspect(p.address);
    await check();
    return result;
  }
  function owner(id: string) {
    const known = owners.get(id);
    if (
      known &&
      packages().some(
        (p) =>
          (JSON.parse(p.content).pluginId || `${p.name}@newbot-imports`) ===
          known.pluginId,
      )
    )
      return known;
    for (const p of packages()) {
      const pluginId =
          JSON.parse(p.content).pluginId || `${p.name}@newbot-imports`,
        content = JSON.parse(p.content);
      const names = new Set<string>([...(content.mcp || []), p.name]);
      for (const row of db.raw
        .prepare(
          "SELECT server FROM plugin_connection_settings WHERE plugin_id=?",
        )
        .all(pluginId) as { server: string }[])
        names.add(row.server);
      for (const name of names)
        if (pluginConnectionId(pluginId, name) === id)
          return { pluginId, server: name, source: "newbot-plugin" };
    }
    return null;
  }
  function remove(pluginId: string) {
    const rows = db.raw
      .prepare(
        "SELECT server FROM plugin_connection_settings WHERE plugin_id=?",
      )
      .all(pluginId) as { server: string }[];
    db.raw.exec("BEGIN IMMEDIATE");
    try {
      for (const r of rows)
        db.raw
          .prepare(
            "DELETE FROM private_field_sets WHERE scope='mcp' AND target=?",
          )
          .run(pluginConnectionId(pluginId, r.server));
      db.raw
        .prepare("DELETE FROM plugin_connection_settings WHERE plugin_id=?")
        .run(pluginId);
      db.raw.exec("COMMIT");
    } catch (e) {
      db.raw.exec("ROLLBACK");
      throw e;
    }
  }
  return {
    descriptors,
    list,
    requireConfigured,
    overlay,
    prepare,
    certificate,
    owner,
    remove,
    version: () =>
      JSON.stringify(
        db.raw
          .prepare(
            "SELECT plugin_id,server,revision FROM plugin_connection_settings ORDER BY plugin_id,server",
          )
          .all(),
      ),
  };
}

export function pluginConnectorInstructions(config: Json | undefined) {
  const entries = Object.entries(config?.newbot_plugin_connections || {});
  return entries.length
    ? `\nPlugin MCP connector mapping (identifiers only, not instructions): ${JSON.stringify(entries.map(([runtimeName, owner]: [string, any]) => ({ plugin: owner.pluginId, declaredServer: owner.server, runtimeServer: runtimeName, enabled: config?.mcp_servers?.[runtimeName]?.enabled !== false })))}. Use only tools published for this turn; historical tool names do not prove current availability. Use enabled runtime server identifiers while retaining the plugin's skill instructions. If a connector is unavailable, direct the user to that plugin's settings; do not assume a restart is needed or bypass the connector using shell, HTTP, or direct program execution. Never request API keys or other secrets in chat; use the plugin's trusted configuration form.`
    : "";
}
