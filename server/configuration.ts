import { extensionParameter } from "./extension-runtime.js";
import { credentialBinding, type credentialVault } from "./credential-vault.js";
import { configFail as fail } from "./configuration-error.js";
import { providerParameter, type ProviderRuntime } from "./provider-runtime.js";
import { mcpEditable } from "./mcp-policy.js";
import {
  providerEditable,
  privateProviderReceiver,
} from "./provider-policy.js";
import { createHmac, randomBytes } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { Codex } from "./codex.js";
import type { ConfigEdit } from "../generated/codex/v2/ConfigEdit.js";
import type { ConfigReadResponse } from "../generated/codex/v2/ConfigReadResponse.js";
import type { ConfigLayerSource } from "../generated/codex/v2/ConfigLayerSource.js";
import type {
  ConfigurationView,
  ConfigSource,
  DefaultsSaveResult,
} from "../shared/configuration.js";
export const defaultsEdit = z
  .object({
    action: z.literal("settings/defaults").optional(),
    expectedRevision: z.string().regex(/^cfg1\.[a-f0-9]{64}$/),
    model: z.string().trim().min(1).max(200),
    effort: z.string().trim().min(1).max(40),
  })
  .strict();
function canonical(value: unknown): string {
  if (typeof value === "bigint") return JSON.stringify(value.toString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) || "null";
}
const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.length <= 200 ? value : null;
const envName = (value: unknown) =>
  typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(value);
function endpointOrigin(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
}
function source(name: ConfigLayerSource | undefined): ConfigSource | null {
  return name
    ? { type: name.type, profile: name.type === "user" && !!name.profile }
    : null;
}
export function configuration(
  codex: Codex,
  cwd: string,
  runtime?: ProviderRuntime,
  vault?: ReturnType<typeof credentialVault>,
) {
  const key = randomBytes(32);
  let pendingWrites = 0;
  let writes: Promise<void> = Promise.resolve();
  let nativeSnapshot: ConfigReadResponse | undefined;
  const revisionOf = (value: unknown) =>
    `cfg1.${createHmac("sha256", key).update(canonical(value)).digest("hex")}`;
  async function read(refreshNative = false) {
    if (codex.state !== "ready" && (!runtime || !nativeSnapshot))
      fail(
        "配置暂不可用，请等待 Codex 就绪后重试",
        503,
        "read_failed",
        "unconfirmed",
        "reconnect",
      );
    let response: ConfigReadResponse;
    try {
      if (!runtime || !nativeSnapshot || refreshNative) {
        nativeSnapshot = await codex.call("config/read", {
          cwd,
          includeLayers: true,
        });
      }
      response = structuredClone(nativeSnapshot!);
    } catch {
      fail(
        "配置读取失败，请检查服务端配置后重试",
        503,
        "read_failed",
        "unconfirmed",
      );
    }
    if (runtime) response = runtime.overlay(response);
    if (codex.extensionRuntime)
      response = codex.extensionRuntime.overlay(response);
    if (codex.pluginConfiguration)
      response = await codex.pluginConfiguration(response);
    const layers = response.layers || [];
    const users = layers.filter(
      (l) =>
        l.name.type === "user" && l.name.profile == null && !l.disabledReason,
    );
    const layer = users.length === 1 ? users[0] : null;
    const target =
      layer?.name.type === "user" &&
      isAbsolute(layer.name.file) &&
      layer.version
        ? { filePath: layer.name.file, expectedVersion: layer.version }
        : null;
    const revision = revisionOf(response);
    const config = response.config;
    const policy = (scope: string) =>
      Object.fromEntries(
        Object.entries(response.origins || {}).filter(
          ([path]) => path === scope || path.startsWith(scope + "."),
        ),
      );
    const revisions: Record<string, string> = {
      defaults: revisionOf([
        config.model_provider,
        config.model,
        config.model_reasoning_effort,
      ]),
    };
    for (const [id, value] of Object.entries(object(config.model_providers))) {
      revisions[`provider:${id}`] = revisionOf([
        value,
        object((config as any).newbot_models)[id],
        policy(`model_providers.${id}`),
      ]);
      revisions[`gateway-default:${id}`] = revisionOf([
        value,
        object(config.profiles)[`newbot_gateway_${id}`],
        revisions.defaults,
      ]);
    }
    revisions["gateway-default:openai"] ||= revisionOf([
      object(config.profiles).newbot_gateway_openai,
      revisions.defaults,
    ]);
    for (const [id, value] of Object.entries(object(config.mcp_servers)))
      revisions[`mcp:${id}`] = revisionOf([
        value,
        (response as any).connectorNames?.[id],
        policy(`mcp_servers.${id}`),
      ]);
    const publicView: ConfigurationView = {
      revision,
      revisions,
      writable: !!runtime || !!target,
      nativeWritable: !!codex.extensionRuntime || !!target,
      providerStorage: runtime?.storage || "native",
      ...(runtime
        ? {
            providerSourceStatus: runtime.sourceStatus,
            providerSourceConfigured: !!process.env.NEWBOT_RUNTIME_CONFIG_URL,
          }
        : {}),
      reason:
        runtime || target
          ? null
          : "当前运行时未提供可写的用户配置版本，请在服务端检查配置后重新读取。",
      defaults: {
        model: text(config.model),
        effort: text(config.model_reasoning_effort),
        provider: text(config.model_provider) || "openai",
      },
      sources: {
        model: runtime
          ? { type: runtime.storage, profile: false }
          : source(response.origins?.model?.name),
        effort: runtime
          ? { type: runtime.storage, profile: false }
          : source(response.origins?.model_reasoning_effort?.name),
      },
      providers: Object.entries(object(config.model_providers)).map(
        ([id, raw]) => {
          const provider = object(raw);
          return {
            id,
            privateFields: codex.privateFieldInfo?.("provider", id, config),
            editable: providerEditable(response, id),
            customModels: object((config as any).newbot_models)[id] || [],
            requiresAccountAuth: provider.requires_openai_auth === true,
            temporaryCredentialTest: !!privateProviderReceiver(provider),
            name: text(provider.name) || id,
            endpointOrigin: endpointOrigin(provider.base_url),
            // Only our validated, managed definitions have an editable URL contract.
            ...(runtime && providerEditable(response, id)
              ? { editableEndpoint: safeEndpoint(provider.base_url) }
              : {}),
            wireApi:
              provider.wire_api === "responses"
                ? "responses"
                : provider.wire_api
                  ? "other"
                  : null,
            credentials:
              provider.api_key ||
              provider.experimental_bearer_token ||
              Object.keys(object(provider.http_headers)).length
                ? "inline"
                : envName(provider.env_key) ||
                    Object.keys(object(provider.env_http_headers)).length
                  ? "environment"
                  : "none",
          };
        },
      ),
      mcp: Object.entries(object(config.mcp_servers))
        .filter(([id]) => !(config as any).newbot_plugin_connections?.[id])
        .map(([id, raw]) => {
          const server = object(raw);
          return {
            id,
            name: (response as any).connectorNames?.[id] || id,
            privateFields: codex.privateFieldInfo?.("mcp", id, config),
            ...(codex.extensionRuntime?.snapshot().values.mcp_servers[id]
              ? {
                  definition: {
                    command: server.command,
                    args: server.args,
                    url: server.url,
                  },
                }
              : {}),
            editable: mcpEditable(response, id),
            hasEnvReferences:
              Array.isArray(server.env_vars) && server.env_vars.length > 0,
            startupTimeout:
              typeof server.startup_timeout_sec === "number"
                ? server.startup_timeout_sec
                : null,
            toolTimeout:
              typeof server.tool_timeout_sec === "number"
                ? server.tool_timeout_sec
                : null,
            transport:
              typeof server.command === "string"
                ? "stdio"
                : typeof server.url === "string"
                  ? "http"
                  : "unknown",
            enabled: server.enabled !== false,
            endpointOrigin: endpointOrigin(server.url),
            credentials: !!(
              server.bearer_token ||
              envName(server.bearer_token_env_var) ||
              Object.keys(object(server.http_headers)).length ||
              Object.keys(object(server.env_http_headers)).length
            ),
            hasArguments: Array.isArray(server.args) && server.args.length > 0,
            hasEnvironment: Object.keys(object(server.env)).length > 0,
          };
        }),
    };
    if (vault) {
      const refs = codex.privateConfiguration
        ? vault.validRefs(config)
        : codex.credentialRefs;
      for (const [scope, targets] of [
        ["provider", publicView.providers],
        ["mcp", publicView.mcp],
      ] as const)
        for (const target of targets) {
          target.managedCredential = vault.info(scope, target.id, config, refs);
          target.credentialEditable =
            target.editable && !!credentialBinding(scope, target.id, config);
        }
    }
    for (const [scope, targets] of [
      ["provider", publicView.providers],
      ["mcp", publicView.mcp],
    ] as const) {
      for (const entry of targets) {
        const raw = object(object(scope === "provider" ? config.model_providers : config.mcp_servers)[entry.id]);
        const fieldSet = entry.privateFields;
        const ref = scope === "provider" ? raw.env_key : raw.bearer_token_env_var;
        const legacyManaged = typeof ref === "string" && ref.startsWith("NEWBOT_CREDENTIAL_KEY_");
        const legacySaved = (!fieldSet || fieldSet.revision === "absent") && entry.managedCredential?.stored;
        // A saved field set, including an explicitly empty one, supersedes the
        // legacy credential reference. The injector follows the same precedence.
        const fieldsOwned = !!fieldSet && fieldSet.revision !== "absent";
        const managed = fieldsOwned ? !!fieldSet.fields.length : legacyManaged || legacySaved;
        const external = scope === "provider"
          ? entry.credentials !== "none" && !legacyManaged
          : !!(entry.credentials || ("hasEnvironment" in entry && entry.hasEnvironment)) && !legacyManaged;
        entry.authentication = managed
          ? {
              source: "managed",
              state: fieldSet?.fields.length
                ? !fieldSet.valid ? "invalid" : fieldSet.fields.every((f) => f.stored) ? "saved" : "missing"
                : ["binding_changed", "locked"].includes(entry.managedCredential?.state || "") || (legacySaved && entry.managedCredential?.state === "none")
                  ? "invalid" : entry.managedCredential?.stored ? "saved" : "missing",
            }
          : external
            ? { source: "external", state: "external" }
            : { source: "none", state: "none" };
      }
    }
    return { response, target, publicView };
  }
  async function mutate(
    expectedRevision: string,
    prepare: (before: Awaited<ReturnType<typeof read>>) => Promise<{
      edits: ConfigEdit[];
      effective: (after: Awaited<ReturnType<typeof read>>) => boolean;
    }>,
    scope?: string,
  ) {
    if (!expectedRevision)
      fail("请刷新页面并重新读取配置，再确认并保存修改", 409, "conflict");
    const previous = writes;
    let release!: () => void;
    writes = new Promise<void>((resolve) => {
      release = resolve;
    });
    pendingWrites++;
    await previous;
    try {
      const before = await read();
      if (!matches(before, expectedRevision, scope))
        fail(expectedRevision === "absent" ? "目标已存在，请读取最新配置后编辑" : "配置已被其他操作修改，请读取最新配置并重新确认", 409, "conflict");
      const change = await prepare(before);
      if (runtime && change.edits.some((e) => providerParameter(e.keyPath))) {
        if (!change.edits.every((e) => providerParameter(e.keyPath)))
          fail("不能同时修改内存参数和原生文件配置", 409, "conflict");
        const actual = await read();
        if (!unchangedTarget(before, actual, scope))
          fail("配置在提交前发生变化，请重新读取", 409, "conflict");
        runtime.apply(
          (actual.response as any).runtimeProviderRevision,
          change.edits,
        );
        const after = await read();
        return {
          state: change.effective(after)
            ? ("applied" as const)
            : ("overridden" as const),
          configuration: after.publicView,
          before,
          after,
        };
      }
      if (
        codex.extensionRuntime &&
        change.edits.every((e) => extensionParameter(e.keyPath))
      ) {
        const actual = await read();
        if (!unchangedTarget(before, actual, scope))
          fail("配置在提交前发生变化，请重新读取", 409, "conflict");
        codex.extensionRuntime.apply(
          (actual.response as any).runtimeExtensionRevision,
          change.edits,
        );
        const after = await read();
        return {
          state: change.effective(after)
            ? ("applied" as const)
            : ("overridden" as const),
          configuration: after.publicView,
          before,
          after,
        };
      }
      if (!before.target)
        fail("当前用户配置不可写，请在服务端检查后重试", 409, "read_only");
      let status: "ok" | "okOverridden";
      try {
        const result = await codex.call("config/batchWrite", {
          ...before.target,
          reloadUserConfig: false,
          edits: change.edits,
        });
        status = result.status;
        if (!["ok", "okOverridden"].includes(status))
          fail(
            "配置保存结果未确认，请重新读取后检查",
            502,
            "write_unconfirmed",
            "unconfirmed",
          );
      } catch {
        let after;
        try {
          after = await read();
        } catch {
          fail(
            "配置保存结果未确认，请恢复连接后重新读取",
            502,
            "write_unconfirmed",
            "unconfirmed",
            "reconnect",
          );
        }
        if (after.publicView.revision !== before.publicView.revision)
          fail(
            "配置在保存期间发生变化，请重新读取并检查结果",
            409,
            "write_unconfirmed",
            "unconfirmed",
          );
        fail(
          "配置保存失败，原有修改仍保留，请重新读取后重试",
          502,
          "write_failed",
        );
      }
      let after;
      try {
        after = await read();
      } catch {
        fail(
          "配置已提交，但读取结果失败，请恢复连接后重新读取",
          502,
          "readback_failed",
          "saved",
          "reconnect",
        );
      }
      const context = (snapshot: typeof before) =>
        canonical(
          (snapshot.response.layers || [])
            .filter(
              (layer) =>
                layer.name.type !== "user" ||
                layer.name.file !== before.target!.filePath,
            )
            .map(({ name, version, disabledReason }) => ({
              name,
              version,
              disabledReason,
            })),
        );
      if (context(before) !== context(after))
        fail(
          "配置来源在保存期间发生变化，修改可能已写入，请重新读取并确认",
          409,
          "conflict",
          "saved",
        );
      return {
        state:
          status === "okOverridden" || !change.effective(after)
            ? ("overridden" as const)
            : ("applied" as const),
        configuration: after.publicView,
        before,
        after,
      };
    } finally {
      pendingWrites--;
      release();
    }
  }
  async function writeDefaults(
    params: unknown,
    validate: (model: string, effort: string) => Promise<void>,
  ): Promise<DefaultsSaveResult> {
    if (!object(params).expectedRevision)
      fail("请刷新页面并重新读取配置，再确认并保存修改", 409, "conflict");
    const data = defaultsEdit.parse(params);
    const result = await mutate(data.expectedRevision, async () => {
      await validate(data.model, data.effort);
      return {
        edits: [
          { keyPath: "model", value: data.model, mergeStrategy: "replace" },
          {
            keyPath: "model_reasoning_effort",
            value: data.effort,
            mergeStrategy: "replace",
          },
        ],
        effective: (after) =>
          after.publicView.defaults.model === data.model &&
          after.publicView.defaults.effort === data.effort,
      };
    });
    return {
      state: result.state,
      configuration: result.configuration,
      ...(result.state === "overridden"
        ? {
            configurationIssue: {
              code: "overridden" as const,
              persistence: "saved" as const,
              recovery: "read" as const,
            },
          }
        : {}),
    };
  }
  return {
    runtime,
    extensions: codex.extensionRuntime,
    read,
    writeDefaults,
    mutate,
    matches,
    get saving() {
      return pendingWrites > 0;
    },
  };
  function matches(
    snapshot: Awaited<ReturnType<typeof read>>,
    expected: string,
    scope?: string,
  ) {
    return (
      (expected === "absent" &&
        !!scope &&
        !Object.hasOwn(snapshot.publicView.revisions || {}, scope)) ||
      snapshot.publicView.revision === expected ||
      (!!scope && snapshot.publicView.revisions?.[scope] === expected)
    );
  }
  function unchangedTarget(
    before: Awaited<ReturnType<typeof read>>,
    after: Awaited<ReturnType<typeof read>>,
    scope?: string,
  ) {
    return scope
      ? before.publicView.revisions?.[scope] ===
          after.publicView.revisions?.[scope]
      : before.publicView.revision === after.publicView.revision;
  }
}

function safeEndpoint(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? value
      : null;
  } catch {
    return null;
  }
}
