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
) {
  const key = randomBytes(32);
  let saving = false;
  async function read() {
    if (codex.state !== "ready")
      fail(
        "配置暂不可用，请等待 Codex 就绪后重试",
        503,
        "read_failed",
        "unconfirmed",
        "reconnect",
      );
    let response: ConfigReadResponse;
    try {
      response = await codex.call("config/read", { cwd, includeLayers: true });
    } catch {
      fail(
        "配置读取失败，请检查服务端配置后重试",
        503,
        "read_failed",
        "unconfirmed",
      );
    }
    if (runtime) response = runtime.overlay(response);
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
    const revision = `cfg1.${createHmac("sha256", key).update(canonical(response)).digest("hex")}`;
    const config = response.config;
    const publicView: ConfigurationView = {
      revision,
      writable: !!runtime || !!target,
      nativeWritable: !!target,
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
            editable: providerEditable(response, id),
            requiresAccountAuth: provider.requires_openai_auth === true,
            temporaryCredentialTest: !!privateProviderReceiver(provider),
            name: text(provider.name) || id,
            endpointOrigin: endpointOrigin(provider.base_url),
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
      mcp: Object.entries(object(config.mcp_servers)).map(([id, raw]) => {
        const server = object(raw);
        return {
          id,
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
    return { response, target, publicView };
  }
  async function mutate(
    expectedRevision: string,
    prepare: (before: Awaited<ReturnType<typeof read>>) => Promise<{
      edits: ConfigEdit[];
      effective: (after: Awaited<ReturnType<typeof read>>) => boolean;
    }>,
  ) {
    if (!expectedRevision)
      fail("请刷新页面并重新读取配置，再确认并保存修改", 409, "conflict");
    if (saving)
      fail(
        "其他配置正在保存，请重新读取后再保存",
        409,
        "busy",
        "unchanged",
        "wait",
      );
    saving = true;
    try {
      const before = await read();
      if (before.publicView.revision !== expectedRevision)
        fail("配置已被其他操作修改，请读取最新配置并重新确认", 409, "conflict");
      const change = await prepare(before);
      if (runtime && change.edits.some((e) => providerParameter(e.keyPath))) {
        if (!change.edits.every((e) => providerParameter(e.keyPath)))
          fail("不能同时修改内存参数和原生文件配置", 409, "conflict");
        const actual = await read();
        if (actual.publicView.revision !== before.publicView.revision)
          fail("配置在提交前发生变化，请重新读取", 409, "conflict");
        runtime.apply(
          (before.response as any).runtimeProviderRevision,
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
      saving = false;
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
    read,
    writeDefaults,
    mutate,
    get saving() {
      return saving;
    },
  };
}
