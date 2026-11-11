import { customModelIds } from "../shared/gateways.js";
import { PublicError } from "./public-error.js";
import type { credentialVault } from "./credential-vault.js";
import {
  managedCredential,
  MANAGED_CREDENTIAL_PREFIX,
} from "./credential-vault.js";
import { configFail } from "./configuration-error.js";
import {
  providerReserved as reserved,
  providerEditable,
  privateProviderReceiver,
} from "./provider-policy.js";
import { z } from "zod";
import type { Codex } from "./codex.js";
import type { Store } from "./db.js";
import type { configuration } from "./configuration.js";
import type { ConfigEdit } from "../generated/codex/v2/ConfigEdit.js";
export const providerId = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const revision = z.string().regex(/^cfg1\.[a-f0-9]{64}$/);
const envKey = z.string().regex(/^[A-Z_][A-Z0-9_]{0,127}$/);
const name = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((s) => !/[\x00-\x1f\x7f]/.test(s));
const baseUrl = z
  .string()
  .max(2048)
  .url()
  .refine((s) => {
    const u = new URL(s);
    return (
      ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  }, "端点仅支持不含凭证、查询或片段的 HTTP/HTTPS URL");
export const providerSave = z
  .object({
    action: z.literal("provider/save").optional(),
    expectedRevision: revision,
    id: providerId,
    create: z.boolean(),
    rebindCredentials: z.boolean().optional(),
    patch: z
      .object({
        customModels: customModelIds.optional(),
        name: name.optional(),
        baseUrl: baseUrl.optional(),
        envKey: envKey.nullable().optional(),
      })
      .strict()
      .refine((p) => Object.keys(p).length > 0),
  })
  .strict();
export const providerDelete = z
  .object({
    action: z.literal("provider/delete").optional(),
    expectedRevision: revision,
    id: providerId,
  })
  .strict();
export const providerProbe = z
  .object({
    action: z.enum(["provider/models", "provider/test"]).optional(),
    expectedRevision: revision,
    id: providerId,
    model: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:/+\-]*$/)
      .optional(),
  })
  .strict();
const blockedEnv = new Set([
  "NEWBOT_RUNTIME_CONFIG_TOKEN",
  "ADMIN_PASSWORD",
  "NODE_OPTIONS",
  "CODEX_HOME",
  "HOME",
]);
export const record = (v: unknown): Record<string, any> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, any>)
    : {};
export function providerError(message: string, statusCode = 409): never {
  throw Object.assign(new PublicError(message), { statusCode });
}
type ConfigStore = ReturnType<typeof configuration>;
type Snapshot = Awaited<ReturnType<ConfigStore["read"]>>;
export const editableProvider = (snapshot: Snapshot, id: string) =>
  providerEditable(snapshot.response, id);
function usedInConfig(value: unknown, id: string): boolean {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, child]) =>
      (key === "model_provider" && child === id) || usedInConfig(child, id),
  );
}
export function allowedEnv(snapshot: Snapshot, key: string) {
  if (blockedEnv.has(key)) return false;
  const allowed = new Set([
    "OPENAI_API_KEY",
    ...(process.env.PROVIDER_CREDENTIAL_ENV_ALLOWLIST || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
  ]);
  for (const p of Object.values(
    record(snapshot.response.config.model_providers),
  )) {
    if (typeof record(p).env_key === "string") allowed.add(record(p).env_key);
    for (const ref of Object.values(record(record(p).env_http_headers)))
      if (typeof ref === "string") allowed.add(ref);
  }
  return allowed.has(key);
}
async function boundedJson(response: Response) {
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    providerError(
      `连接测试失败（HTTP ${response.status}），请检查端点、凭证和模型`,
      502,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) providerError("上游没有返回可读取的响应", 502);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 256 * 1024) providerError("连接测试响应超过大小限制", 502);
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    providerError("上游未返回有效 JSON，请检查 Responses 兼容端点", 502);
  }
}
export function providerManager(
  codex: Codex,
  db: Store,
  config: ConfigStore,
  vault?: ReturnType<typeof credentialVault>,
) {
  async function checked(expectedRevision: string, id: string) {
    const snapshot = await config.read();
    if (!config.matches(snapshot, expectedRevision, `provider:${id}`))
      configFail("配置已变化，请重新读取后再操作", 409, "conflict");
    if (
      !(
        id === "openai" ||
        id === (snapshot.response.config.model_provider || "openai") ||
        Object.hasOwn(record(snapshot.response.config.model_providers), id)
      )
    )
      providerError("Provider 已不存在，请重新读取");
    return snapshot;
  }
  async function save(params: unknown) {
    const data = providerSave.parse(params);
    if (reserved.has(data.id))
      providerError("内置 Provider 由 Codex 管理，不能通过此入口修改");
    return config.mutate(
      data.create ? "absent" : data.expectedRevision,
      async (snapshot) => {
        const definitions = record(snapshot.response.config.model_providers);
        const exists =
          Object.hasOwn(definitions, data.id) ||
          snapshot.publicView.defaults.provider === data.id;
        if (data.create && exists)
          providerError("Provider 标识已存在，请使用其他标识");
        if (!data.create && !editableProvider(snapshot, data.id))
          providerError("此 Provider 不属于可编辑用户配置，请在其来源中修改");
        if (data.patch.envKey && !allowedEnv(snapshot, data.patch.envKey))
          providerError("凭证引用未授权，请先在服务端配置允许列表");
        const previous = record(definitions[data.id]);
        const retarget =
          data.patch.baseUrl !== undefined &&
          data.patch.baseUrl.replace(/\/+$/, "") !==
            previous.base_url?.replace(/\/+$/, "");
        if (data.patch.envKey?.startsWith(MANAGED_CREDENTIAL_PREFIX))
          providerError("托管凭证引用请通过私密入口管理");
        if (
          managedCredential(previous.env_key) &&
          (data.patch.envKey !== undefined ||
            (retarget && !data.rebindCredentials))
        )
          providerError("请先通过私密入口清除托管凭证，再修改接收方或引用");
        if (
          retarget &&
          (previous.api_key ||
            previous.experimental_bearer_token ||
            previous.auth ||
            Object.keys(record(previous.http_headers)).length ||
            Object.keys(record(previous.env_http_headers)).length ||
            (previous.env_key && !managedCredential(previous.env_key)))
        )
          providerError("此网关含外部管理的认证配置，请为新地址另建网关");
        const root = `model_providers.${data.id}`;
        const fields = {
          ...(retarget &&
          data.rebindCredentials &&
          managedCredential(previous.env_key)
            ? { env_key: null }
            : {}),
          ...(data.patch.name !== undefined ? { name: data.patch.name } : {}),
          ...(data.patch.baseUrl !== undefined
            ? { base_url: data.patch.baseUrl.replace(/\/+$/, "") }
            : {}),
          ...(data.patch.envKey !== undefined
            ? { env_key: data.patch.envKey }
            : {}),
        };
        if (data.create && fields.env_key === null) delete fields.env_key;
        const edits: ConfigEdit[] = [];
        if (data.patch.customModels !== undefined) {
          if (!config.runtime && data.patch.customModels.length)
            providerError("自定义模型需要 SQLite 配置模式");
          if (config.runtime)
            edits.push({
              keyPath: `newbot_models.${data.id}`,
              value: data.patch.customModels,
              mergeStrategy: "replace",
            });
        }
        if (data.create) {
          if (!fields.name || !fields.base_url)
            providerError("新增 Provider 需要名称和端点", 400);
          const definition = {
            ...fields,
            wire_api: "responses",
            requires_openai_auth: false,
          };
          vault?.restoreProviderReferences({
            model_providers: { [data.id]: definition },
          });
          edits.push({
            keyPath: root,
            value: definition,
            mergeStrategy: "replace",
          });
        } else
          for (const [key, value] of Object.entries(fields))
            edits.push({
              keyPath: `${root}.${key}`,
              value,
              mergeStrategy: "replace",
            });
        return {
          edits,
          effective: (after) => {
            const actual = record(
              record(after.response.config.model_providers)[data.id],
            );
            return Object.entries(fields).every(([key, value]) =>
              value === null ? actual[key] == null : actual[key] === value,
            );
          },
        };
      },
      `provider:${data.id}`,
    );
  }
  async function remove(params: unknown) {
    const data = providerDelete.parse(params);
    return config.mutate(
      data.expectedRevision,
      async (snapshot) => {
        if (!editableProvider(snapshot, data.id))
          providerError("此 Provider 不能从用户配置中删除");
        if (
          managedCredential(
            record(record(snapshot.response.config.model_providers)[data.id])
              .env_key,
          ) ||
          vault?.info("provider", data.id, snapshot.response.config).stored
        )
          providerError("请先清除托管凭证，再删除 Provider");
        if (snapshot.publicView.defaults.provider === data.id)
          providerError("请先切换到其他 Provider，再删除当前 Provider");
        if (
          db.raw
            .prepare("SELECT 1 FROM threads WHERE provider=? LIMIT 1")
            .get(data.id) ||
          db.raw
            .prepare(
              "SELECT 1 FROM session_runtime_pending WHERE json_extract(candidate,'$.provider')=? LIMIT 1",
            )
            .get(data.id)
        )
          providerError("历史会话仍引用此 Provider，暂不能删除");
        const referenceConfig = structuredClone(snapshot.response.config);
        if (config.runtime && referenceConfig.profiles)
          delete (referenceConfig.profiles as any)[`newbot_gateway_${data.id}`];
        if (
          usedInConfig(referenceConfig, data.id) ||
          snapshot.response.layers?.some((l) => usedInConfig(l.config, data.id))
        )
          providerError("其他配置仍引用此 Provider，请先处理引用");
        for (const archived of [false, true]) {
          let result;
          try {
            result = await codex.call("thread/list", {
              modelProviders: [data.id],
              archived,
              limit: 1,
              sourceKinds: [
                "cli",
                "vscode",
                "exec",
                "appServer",
                "subAgent",
                "subAgentReview",
                "subAgentCompact",
                "subAgentThreadSpawn",
                "subAgentOther",
                "unknown",
              ],
            });
          } catch {
            providerError("无法核对原生历史引用，请恢复连接后重试");
          }
          if (!Array.isArray(result.data))
            providerError("无法核对原生历史引用，请稍后重试");
          if (result.data.length)
            providerError("Codex 历史会话仍引用此 Provider，暂不能删除");
        }
        return {
          edits: [
            ...(config.runtime
              ? [
                  {
                    keyPath: `profiles.newbot_gateway_${data.id}`,
                    value: null,
                    mergeStrategy: "replace" as const,
                  },
                  {
                    keyPath: `newbot_models.${data.id}`,
                    value: null,
                    mergeStrategy: "replace" as const,
                  },
                ]
              : []),
            {
              keyPath: `model_providers.${data.id}`,
              value: null,
              mergeStrategy: "replace",
            },
          ],
          effective: (after) =>
            !Object.hasOwn(
              record(after.response.config.model_providers),
              data.id,
            ),
        };
      },
      `provider:${data.id}`,
    );
  }
  async function probe(
    params: unknown,
    nativeCatalog: () => Promise<any[]>,
    responseTest = false,
    preferUpstream = false,
  ) {
    const data = providerProbe.parse(params);
    const snapshot = await checked(data.expectedRevision, data.id);
    const current = snapshot.publicView.defaults.provider === data.id;
    const source = codex.privateConfiguration
      ? (
          await codex.privateConfiguration({
            modelProvider: data.id,
            config: snapshot.response.config,
          })
        ).config
      : snapshot.response.config;
    const definition = record(record(source.model_providers)[data.id]);
    if (!responseTest && current && !preferUpstream)
      return {
        source: "codex" as const,
        models: (await nativeCatalog()).map((m) => m.model),
        note: "已读取 Codex 模型目录；实际连接与工具能力需分别验证。",
      };
    if (!Object.keys(definition).length || definition.requires_openai_auth)
      return {
        source: "account" as const,
        models: [],
        note: "此 Provider 使用 Codex 账户授权。请切换后读取原生模型目录，并通过实际对话验证连接。",
      };
    const url = baseUrl.safeParse(definition.base_url);
    if (!url.success)
      providerError("当前端点不支持安全诊断，请先检查服务端 URL 配置", 400);
    if (definition.wire_api && definition.wire_api !== "responses")
      providerError("此入口仅诊断 Responses Provider", 400);
    const headers = new Headers();
    const secrets: string[] = [];
    for (const [key, value] of Object.entries(record(definition.http_headers)))
      if (typeof value === "string") {
        headers.set(key, value);
        secrets.push(value.replace(/^Bearer\s+/i, ""));
      }
    for (const [key, value] of Object.entries(
      record(definition.env_http_headers),
    ))
      if (typeof value === "string") {
        if (!allowedEnv(snapshot, value) || !process.env[value])
          providerError("服务端凭证环境变量不可用，请检查引用", 400);
        headers.set(key, process.env[value]!);
        secrets.push(process.env[value]!);
      }
    if (typeof definition.env_key === "string") {
      if (managedCredential(definition.env_key)) {
        if (!vault) providerError("托管凭证暂不可用，请重新连接");
        vault.useCredential(
          "provider",
          data.id,
          snapshot.response.config,
          (value) => {
            const key = value.toString("ascii");
            headers.set("Authorization", `Bearer ${key}`);
            secrets.push(key);
          },
        );
      } else {
        if (
          !allowedEnv(snapshot, definition.env_key) ||
          !process.env[definition.env_key]
        )
          providerError("服务端凭证环境变量不可用，请检查引用", 400);
        headers.set(
          "Authorization",
          `Bearer ${process.env[definition.env_key]}`,
        );
        secrets.push(process.env[definition.env_key]!);
      }
    } else if (typeof definition.experimental_bearer_token === "string") {
      headers.set(
        "Authorization",
        `Bearer ${definition.experimental_bearer_token}`,
      );
      secrets.push(definition.experimental_bearer_token);
    }
    headers.set("Accept", "application/json");
    try {
      if (!responseTest) {
        const response = await fetch(`${url.data.replace(/\/+$/, "")}/models`, {
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        });
        const json = await boundedJson(response);
        if (!Array.isArray(json.data))
          providerError("上游未提供兼容的模型目录", 502);
        const models = [
          ...new Set<string>(
            json.data
              .slice(0, 100)
              .flatMap((m: any) =>
                typeof m?.id === "string" &&
                /^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,199}$/.test(m.id) &&
                !secrets.some((s) => s.length > 0 && m.id.includes(s))
                  ? [m.id]
                  : [],
              ),
          ),
        ];
        return {
          source: "upstream" as const,
          models,
          note: "上游模型目录已响应；兼容性未验证。切换后由 Codex 决定聊天可选模型。",
        };
      }
      if (!data.model) providerError("请输入要测试的模型 ID", 400);
      headers.set("Content-Type", "application/json");
      const response = await fetch(
        `${url.data.replace(/\/+$/, "")}/responses`,
        {
          method: "POST",
          headers,
          redirect: "error",
          signal: AbortSignal.timeout(15000),
          body: JSON.stringify({
            model: data.model,
            input: "Reply OK.",
            stream: false,
            store: false,
            max_output_tokens: 64,
            tools: [],
          }),
        },
      );
      const json = await boundedJson(response);
      if (
        json.object !== "response" ||
        typeof json.id !== "string" ||
        !json.id ||
        !["completed", "incomplete"].includes(json.status) ||
        !Array.isArray(json.output) ||
        json.error
      )
        providerError("上游未返回有效的 Responses 结果", 502);
      return {
        source: "responses" as const,
        models: [data.model],
        note: "基础 Responses 请求已响应；流式输出、上下文和 Agent 工具能力仍需单独验证。",
      };
    } catch (error) {
      if (error instanceof Error && "statusCode" in error) throw error;
      providerError("连接诊断失败或超时，请检查端点、凭证与网络", 502);
    }
  }
  async function preparePrivateProbe(expectedRevision: string, id: string) {
    const snapshot = await checked(expectedRevision, id);
    const definition = record(
      record(snapshot.response.config.model_providers)[id],
    );
    const receiver = privateProviderReceiver(definition);
    if (!receiver)
      providerError(
        "此操作仅支持已配置的 HTTPS Bearer Responses Provider",
        400,
      );
    return {
      receiver,
      checked: async () => {
        const after = await checked(expectedRevision, id);
        const actual = record(
          record(after.response.config.model_providers)[id],
        );
        if (actual.base_url !== definition.base_url)
          providerError("配置已变化，请重新发起");
      },
    };
  }
  return { save, remove, probe, checked, preparePrivateProbe };
}
