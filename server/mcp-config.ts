import {
  managedCredential,
  MANAGED_CREDENTIAL_PREFIX,
  type credentialVault,
} from "./credential-vault.js";
import { configFail } from "./configuration-error.js";
import { z } from "zod";
import { mcpEditable } from "./mcp-policy.js";
import { record, providerError as fail } from "./providers.js";
import type { configuration } from "./configuration.js";
import type { Codex } from "./codex.js";
import type { ConfigEdit } from "../generated/codex/v2/ConfigEdit.js";
import type { McpServerStatus } from "../generated/codex/v2/McpServerStatus.js";
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
  revision = z.string().regex(/^cfg1\.[a-f0-9]{64}$/);
const envName = z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/);
const value = z
  .string()
  .max(4096)
  .refine((s) => !/[\0\r\n]/.test(s));
const endpoint = z
  .string()
  .max(2048)
  .url()
  .refine((s) => {
    const u = new URL(s);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  }, "端点仅支持无凭证、查询和片段的 HTTP/HTTPS URL");
export const mcpSave = z
  .object({
    action: z.literal("mcp/save").optional(),
    expectedRevision: revision,
    id,
    create: z.boolean(),
    rebindCredentials: z.boolean().optional(),
    transport: z.enum(["stdio", "http"]),
    patch: z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        command: value.refine((s) => s.trim().length > 0).optional(),
        args: z.array(value).max(64).optional(),
        envRefs: z.array(envName).max(32).optional(),
        url: endpoint.optional(),
        bearerEnv: envName.nullable().optional(),
        enabled: z.boolean().optional(),
        startupTimeout: z.number().int().min(1).max(120).optional(),
        toolTimeout: z.number().int().min(1).max(600).optional(),
      })
      .strict()
      .refine((p) => Object.keys(p).length > 0),
  })
  .strict();
export const mcpDelete = z
  .object({
    action: z.literal("mcp/delete").optional(),
    expectedRevision: revision,
    id,
  })
  .strict();
export const mcpEnabled = z
  .object({
    action: z.literal("mcp/enabled").optional(),
    expectedRevision: revision,
    id,
    enabled: z.boolean(),
  })
  .strict();
export const mcpControl = z
  .object({
    action: z.enum(["mcp/test", "mcp/reload"]).optional(),
    expectedRevision: revision,
    id: id.optional(),
  })
  .strict();
type Core = ReturnType<typeof configuration>;
export function publicMcpStatus(raw: McpServerStatus) {
  const states = [
    "notStarted",
    "starting",
    "connected",
    "authenticationRequired",
    "failed",
    "cancelled",
    "disabled",
  ];
  const auth = [
    "unknown",
    "unsupported",
    "notLoggedIn",
    "bearerToken",
    "oAuth",
  ];
  return {
    name: raw.name,
    pluginId: raw.pluginId || null,
    runtimeStatus: states.includes(raw.runtimeStatus || "")
      ? raw.runtimeStatus
      : null,
    authStatus: auth.includes(raw.authStatus) ? raw.authStatus : "unknown",
    toolCount: Object.keys(record(raw.tools)).length,
    tools: Object.fromEntries(
      Object.keys(record(raw.tools))
        .slice(0, 512)
        .map((name) => [name, { name }]),
    ),
    resourceCount: Array.isArray(raw.resources) ? raw.resources.length : 0,
    toolsError: raw.toolsError
      ? "工具目录读取失败，请检查服务端连接或授权后重试"
      : null,
    plugin: !!raw.pluginId,
  };
}
export function mcpManager(
  codex: Codex,
  core: Core,
  vault?: ReturnType<typeof credentialVault>,
) {
  const transport = (def: Record<string, any>) =>
    typeof def.command === "string"
      ? "stdio"
      : typeof def.url === "string"
        ? "http"
        : "unknown";
  function checkEnv(snapshot: Awaited<ReturnType<Core["read"]>>, ref: string) {
    if (
      [
        "ADMIN_PASSWORD",
        "HOME",
        "CODEX_HOME",
        "NODE_OPTIONS",
        "NEWBOT_RUNTIME_CONFIG_TOKEN",
      ].includes(ref)
    )
      fail("此环境变量不能用于 MCP 凭证引用");
    const allowed = new Set(
      (process.env.MCP_CREDENTIAL_ENV_ALLOWLIST || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    for (const raw of Object.values(
      record(snapshot.response.config.mcp_servers),
    )) {
      const def = record(raw);
      if (typeof def.bearer_token_env_var === "string")
        allowed.add(def.bearer_token_env_var);
      for (const r of [
        ...(Array.isArray(def.env_vars) ? def.env_vars : []),
        ...Object.values(record(def.env_http_headers)),
      ])
        if (typeof r === "string") allowed.add(r);
    }
    if (!allowed.has(ref)) fail("MCP 凭证引用未授权，请先在服务端配置允许列表");
  }
  async function save(params: unknown) {
    const data = mcpSave.parse(params);
    return core.mutate(
      data.create ? "absent" : data.expectedRevision,
      async (before) => {
        const definitions = record(before.response.config.mcp_servers),
          def = record(definitions[data.id]);
        if (data.create && Object.hasOwn(definitions, data.id))
          fail("MCP 标识已存在，请使用其他标识");
        if (!data.create && !mcpEditable(before.response, data.id))
          fail("此 MCP 不属于可编辑用户配置，请在其来源中修改");
        if (!data.create && transport(def) !== data.transport)
          fail("不能切换现有 MCP 的传输类型，请另建连接");
        const p = data.patch;
        if (
          (data.transport === "stdio" &&
            (p.url !== undefined || p.bearerEnv !== undefined)) ||
          (data.transport === "http" &&
            (p.command !== undefined ||
              p.args !== undefined ||
              p.envRefs !== undefined))
        )
          fail("字段与 MCP 传输类型不符", 400);
        if (
          [...(p.envRefs || []), p.bearerEnv].some((v) =>
            v?.startsWith(MANAGED_CREDENTIAL_PREFIX),
          )
        )
          fail("托管凭证引用请通过私密入口管理");
        if (
          managedCredential(def.bearer_token_env_var) &&
          (p.bearerEnv !== undefined ||
            (p.url !== undefined &&
              p.url !== def.url &&
              !data.rebindCredentials))
        )
          fail("请先通过私密入口清除托管凭证，再修改接收方或引用");
        for (const ref of [
          ...(p.envRefs || []),
          ...(p.bearerEnv ? [p.bearerEnv] : []),
        ])
          checkEnv(before, ref);
        const fields: Record<string, any> = {
          ...(data.rebindCredentials &&
          p.url !== undefined &&
          p.url !== def.url &&
          managedCredential(def.bearer_token_env_var)
            ? { bearer_token_env_var: null }
            : {}),
          ...(p.command !== undefined ? { command: p.command } : {}),
          ...(p.args !== undefined ? { args: p.args } : {}),
          ...(p.envRefs !== undefined
            ? { env_vars: [...new Set(p.envRefs)] }
            : {}),
          ...(p.url !== undefined ? { url: p.url } : {}),
          ...(p.bearerEnv !== undefined
            ? { bearer_token_env_var: p.bearerEnv }
            : {}),
          ...(p.enabled !== undefined ? { enabled: p.enabled } : {}),
          ...(p.startupTimeout !== undefined
            ? { startup_timeout_sec: p.startupTimeout }
            : {}),
          ...(p.toolTimeout !== undefined
            ? { tool_timeout_sec: p.toolTimeout }
            : {}),
        };
        let edits: ConfigEdit[];
        if (data.create) {
          if (
            (data.transport === "stdio" && !fields.command) ||
            (data.transport === "http" && !fields.url)
          )
            fail("新增 MCP 需要命令或 HTTP 端点", 400);
          if (fields.bearer_token_env_var === null)
            delete fields.bearer_token_env_var;
          Object.assign(fields, {
            enabled: p.enabled ?? true,
            startup_timeout_sec: p.startupTimeout ?? 10,
            tool_timeout_sec: p.toolTimeout ?? 60,
          });
          edits = [
            {
              keyPath: `mcp_servers.${data.id}`,
              value: fields,
              mergeStrategy: "replace",
            },
          ];
        } else
          edits = Object.entries(fields).map(([key, value]) => ({
            keyPath: `mcp_servers.${data.id}.${key}`,
            value,
            mergeStrategy: "replace",
          }));
        if (p.name !== undefined) {
          if (!core.extensions) fail("此来源不支持修改显示名称");
          edits.push({
            keyPath: `connector_names.${data.id}`,
            value: p.name,
            mergeStrategy: "replace",
          });
        }
        return {
          edits,
          effective: (after) => {
            const actual = record(
              record(after.response.config.mcp_servers)[data.id],
            );
            return Object.entries(fields).every(([key, value]) =>
              value === null
                ? actual[key] == null
                : JSON.stringify(actual[key]) === JSON.stringify(value),
            );
          },
        };
      },
      `mcp:${data.id}`,
    );
  }
  async function remove(params: unknown) {
    const p = mcpDelete.parse(params);
    return core.mutate(
      p.expectedRevision,
      async (before) => {
        if (!mcpEditable(before.response, p.id))
          fail("此 MCP 不能从用户配置中删除");
        if (
          managedCredential(
            record(record(before.response.config.mcp_servers)[p.id])
              .bearer_token_env_var,
          ) ||
          vault?.info("mcp", p.id, before.response.config).stored
        )
          fail("请先清除托管凭证，再删除 MCP");
        return {
          edits: [
            {
              keyPath: `mcp_servers.${p.id}`,
              value: null,
              mergeStrategy: "replace",
            },
          ],
          effective: (after) =>
            !Object.hasOwn(record(after.response.config.mcp_servers), p.id),
        };
      },
      `mcp:${p.id}`,
    );
  }
  async function enabled(params: unknown) {
    const p = mcpEnabled.parse(params);
    return core.mutate(
      p.expectedRevision,
      async (before) => {
        if (!mcpEditable(before.response, p.id))
          fail("此 MCP 不属于可编辑用户配置");
        return {
          edits: [
            {
              keyPath: `mcp_servers.${p.id}.enabled`,
              value: p.enabled,
              mergeStrategy: "replace",
            },
          ],
          effective: (after) =>
            record(record(after.response.config.mcp_servers)[p.id]).enabled ===
            p.enabled,
        };
      },
      `mcp:${p.id}`,
    );
  }
  async function check(params: unknown, requireId = false) {
    const p = mcpControl.parse(params);
    if (requireId && !p.id) fail("请选择要测试的 MCP", 400);
    const before = await core.read();
    if (
      !core.matches(
        before,
        p.expectedRevision,
        p.id ? `mcp:${p.id}` : undefined,
      )
    )
      configFail("配置已变化，请重新读取后再操作", 409, "conflict");
    if (
      p.id &&
      !Object.hasOwn(record(before.response.config.mcp_servers), p.id)
    )
      fail("MCP 已不存在或由插件管理，请重新读取");
    return { data: p, before };
  }
  async function test(params: unknown, threadId?: string) {
    const { data: p, before } = await check(params, true);
    const def = record(record(before.response.config.mcp_servers)[p.id!]);
    if (def.enabled === false)
      return {
        state: "disabled",
        toolCount: 0,
        note: "此 MCP 已停用，请启用后再测试。",
      };
    let response;
    try {
      response = await codex.call("mcpServerStatus/list", {
        ...(threadId ? { threadId } : {}),
        limit: 100,
        serverName: p.id!,
        detail: "full",
      });
    } catch {
      fail("MCP 原生发现失败，请检查命令、端点、凭证或超时后重试", 502);
    }
    const raw = response.data?.find((s) => s.name === p.id);
    if (!raw) fail("原生发现未返回此 MCP，请重新加载后重试", 502);
    const status = publicMcpStatus(raw);
    if (
      raw.runtimeStatus === "authenticationRequired" ||
      raw.authStatus === "notLoggedIn"
    )
      return {
        state: "authenticationRequired",
        toolCount: 0,
        note: "此 MCP 需要授权，请完成 OAuth 或检查服务端凭证。",
      };
    if (
      raw.toolsError ||
      ["failed", "cancelled"].includes(raw.runtimeStatus || "")
    )
      return {
        state: "failed",
        toolCount: 0,
        note: "MCP 连接或目录读取失败，请检查服务端配置、凭证和超时后重试。",
      };
    if (
      !raw.tools ||
      typeof raw.tools !== "object" ||
      ["notStarted", "starting", "disabled"].includes(raw.runtimeStatus || "")
    )
      return {
        state: "unconfirmed",
        toolCount: 0,
        note: "连接状态尚未确认，请稍后重试；未执行工具。",
      };
    return {
      state: "discovered",
      toolCount: status.toolCount,
      note: "原生 MCP 目录读取成功，未执行工具；此结果不代表会话已使用该连接。",
    };
  }
  return { save, remove, enabled, check, test };
}
