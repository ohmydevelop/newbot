import { customModelIds } from "../shared/gateways.js";
import { randomUUID } from "node:crypto";
import { PublicError } from "./public-error.js";
import type { ConfigReadResponse } from "../generated/codex/v2/ConfigReadResponse.js";
import type { ConfigEdit } from "../generated/codex/v2/ConfigEdit.js";
import { z } from "zod";

type Values = Record<string, any>;
export type ProviderSnapshot = { revision: string; values: Values };
export type ProviderPersistence = (snapshot: ProviderSnapshot) => void;
class RuntimeConflict extends PublicError {
  readonly statusCode = 409;
}
const record = (v: any): Values =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};
const keys = new Set([
  "model",
  "model_provider",
  "model_reasoning_effort",
  "model_providers",
  "newbot_models",
]);
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/);
const model = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/+\-]*$/);
export const providerRuntimeInput = z.strictObject({
  providers: z
    .array(
      z.strictObject({
        id,
        name: z.string().trim().min(1).max(80),
        baseUrl: z
          .string()
          .url()
          .max(2048)
          .refine((value) => {
            const u = new URL(value);
            return (
              ["http:", "https:"].includes(u.protocol) &&
              !u.username &&
              !u.password &&
              !u.search &&
              !u.hash
            );
          }),
        envKey: z
          .string()
          .regex(/^[A-Z_][A-Z0-9_]{0,127}$/)
          .optional(),
        defaultModel: model.optional(),
        customModels: customModelIds.optional(),
      }),
    )
    .max(64)
    .refine((rows) => new Set(rows.map((p) => p.id)).size === rows.length),
  defaults: z
    .strictObject({
      provider: id,
      model: model.optional(),
      effort: z.string().min(1).max(40).optional(),
    })
    .optional(),
});
export function providerRuntimeValues(
  input: z.infer<typeof providerRuntimeInput>,
) {
  return {
    newbot_models: Object.fromEntries(
      input.providers
        .filter((p) => p.customModels?.length)
        .map((p) => [p.id, p.customModels]),
    ),
    model_providers: Object.fromEntries(
      input.providers.map((p) => [
        p.id,
        {
          name: p.name,
          base_url: p.baseUrl.replace(/\/+$/, ""),
          wire_api: "responses",
          requires_openai_auth: false,
          ...(p.envKey ? { env_key: p.envKey } : {}),
        },
      ]),
    ),
    model_provider: input.defaults?.provider || "openai",
    model: input.defaults?.model || null,
    model_reasoning_effort: input.defaults?.effort || null,
    profiles: Object.fromEntries(
      input.providers
        .filter((p) => p.defaultModel)
        .map((p) => [
          `newbot_gateway_${p.id}`,
          { model_provider: p.id, model: p.defaultModel },
        ]),
    ),
  };
}
export const providerParameter = (path: string) =>
  keys.has(path.split(".")[0]) ||
  /^profiles\.newbot_gateway_[a-z0-9_-]+(?:\.|$)/.test(path);
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function strip(value: Values) {
  for (const key of keys) delete value[key];
  if (value.profiles)
    value.profiles = Object.fromEntries(
      Object.entries(value.profiles).filter(
        ([k]) => !k.startsWith("newbot_gateway_"),
      ),
    );
  return value;
}

/** Immutable execution snapshots; the product persists them before publishing updates. */
export class ProviderRuntime {
  private value: Readonly<Values>;
  revision: string;
  private persistence?: ProviderPersistence;
  private versions = new Map<
    string,
    { values: Readonly<Values>; references: number }
  >();
  get storage(): "memory" | "sqlite" {
    return this.persistence ? "sqlite" : "memory";
  }
  sourceStatus: "manual" | "loaded" | "unavailable" | "migrated" | "restored" =
    "manual";
  constructor(seed: Values = {}, revision: string = randomUUID()) {
    this.revision = revision;
    this.value = freeze(
      structuredClone({
        model_provider: seed.model_provider || "openai",
        model: seed.model || null,
        model_reasoning_effort: seed.model_reasoning_effort || null,
        model_providers: record(seed.model_providers),
        newbot_models: record(seed.newbot_models),
        profiles: Object.fromEntries(
          Object.entries(record(seed.profiles)).filter(([k]) =>
            k.startsWith("newbot_gateway_"),
          ),
        ),
      }),
    );
    this.versions.set(this.revision, { values: this.value, references: 0 });
  }
  persist(persistence: ProviderPersistence, initialize = false) {
    if (this.persistence)
      throw new Error("Provider persistence is already attached");
    if (initialize) persistence(this.snapshot());
    this.persistence = persistence;
    return this;
  }
  snapshot(revision = this.revision) {
    const held = this.versions.get(revision);
    if (!held)
      throw new RuntimeConflict("任务绑定的运行配置已失效，请重新读取后发送");
    return { revision, values: structuredClone(held.values) };
  }
  retain(revision = this.revision) {
    this.snapshot(revision);
    this.versions.get(revision)!.references++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const held = this.versions.get(revision);
      if (held) held.references--;
      this.prune();
    };
  }
  private prune() {
    for (const [id, held] of this.versions)
      if (id !== this.revision && held.references === 0)
        this.versions.delete(id);
  }
  effective(native: Values) {
    const base = strip(structuredClone(native));
    return {
      ...base,
      ...structuredClone(this.value),
      profiles: { ...record(base.profiles), ...record(this.value.profiles) },
    };
  }
  overlay(raw: ConfigReadResponse): ConfigReadResponse {
    const response = structuredClone(raw);
    response.config = this.effective(response.config) as any;
    response.layers =
      response.layers?.map((layer) => ({
        ...layer,
        config: strip(record(layer.config)) as any,
      })) || null;
    response.origins = Object.fromEntries(
      Object.entries(response.origins || {}).filter(
        ([path]) => !providerParameter(path),
      ),
    );
    Object.assign(response, {
      runtimeProviders: true,
      runtimeProviderRevision: this.revision,
    });
    return response;
  }
  apply(expected: string, edits: ConfigEdit[]) {
    if (this.revision !== expected)
      throw new RuntimeConflict("运行配置已变化，请重新读取");
    const value: Values = structuredClone(this.value);
    for (const edit of edits) {
      if (!providerParameter(edit.keyPath) || edit.mergeStrategy !== "replace")
        throw new PublicError("不支持的运行配置参数");
      const parts = edit.keyPath.split(".");
      if (
        parts.some(
          (p) =>
            !/^[a-zA-Z0-9_-]+$/.test(p) ||
            ["__proto__", "prototype", "constructor"].includes(p),
        )
      )
        throw new PublicError("运行配置参数无效");
      let target = value;
      for (const part of parts.slice(0, -1))
        target = target[part] = record(target[part]);
      const key = parts.at(-1)!;
      if (edit.value === null) delete target[key];
      else target[key] = structuredClone(edit.value);
    }
    // Clearing a default has the same canonical shape before and after a restart.
    value.model_provider ||= "openai";
    value.model ??= null;
    value.model_reasoning_effort ??= null;
    const next = { values: freeze(value), revision: randomUUID() };
    this.persistence?.(next);
    this.value = next.values;
    this.revision = next.revision;
    this.versions.set(this.revision, { values: this.value, references: 0 });
    this.prune();
  }
  threadConfig(provider: string, revision = this.revision) {
    const definitions = record(this.snapshot(revision).values.model_providers);
    if (provider !== "openai" && !definitions[provider])
      throw new RuntimeConflict(
        "此会话的网关配置尚未下发，请先添加网关或等待配置恢复",
      );
    return {
      revision,
      config: { model_providers: structuredClone(definitions) },
    };
  }
}
