import { customModelIds } from "../shared/gateways.js";
import { z } from "zod";
import type { Store } from "./db.js";
import { configFail } from "./configuration-error.js";
import { PublicError } from "./public-error.js";
import type {
  ProviderPersistence,
  ProviderSnapshot,
} from "./provider-runtime.js";
import { providerReserved } from "./provider-policy.js";

const id = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/)
  .refine((v) => !["constructor", "prototype", "__proto__"].includes(v));
const model = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/+\-]*$/);
const env = z
  .string()
  .regex(/^[A-Z_][A-Z0-9_]{0,127}$/)
  .refine(
    (v) =>
      ![
        "ADMIN_PASSWORD",
        "HOME",
        "CODEX_HOME",
        "NODE_OPTIONS",
        "NEWBOT_RUNTIME_CONFIG_TOKEN",
      ].includes(v),
  );
const endpoint = z
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
  });
const definition = z.strictObject({
  name: z
    .string()
    .min(1)
    .max(80)
    .refine((v) => v.trim().length > 0),
  base_url: endpoint,
  wire_api: z.literal("responses"),
  requires_openai_auth: z.boolean().optional(),
  env_key: env.optional(),
  env_key_instructions: z.string().max(1000).optional(),
  env_http_headers: z.record(z.string().min(1).max(100), env).optional(),
  request_max_retries: z.number().int().nonnegative().optional(),
  stream_max_retries: z.number().int().nonnegative().optional(),
  stream_idle_timeout_ms: z.number().int().nonnegative().optional(),
  supports_websockets: z.boolean().optional(),
});
const values = z
  .strictObject({
    newbot_models: z.record(id, customModelIds).optional(),
    model_provider: id.optional(),
    model: model.nullable().optional(),
    model_reasoning_effort: z.string().min(1).max(40).nullable().optional(),
    model_providers: z
      .record(id, definition)
      .refine((v) => Object.keys(v).length <= 64),
    profiles: z.record(
      z.string().regex(/^newbot_gateway_[a-z][a-z0-9_-]{0,63}$/),
      z.strictObject({ model_provider: id, model }),
    ),
  })
  .superRefine((v, ctx) => {
    if (
      v.model_provider &&
      !providerReserved.has(v.model_provider) &&
      !Object.hasOwn(v.model_providers, v.model_provider)
    )
      ctx.addIssue({ code: "custom", message: "Unknown default gateway" });
    for (const [key, profile] of Object.entries(v.profiles)) {
      if (
        key !== `newbot_gateway_${profile.model_provider}` ||
        (!providerReserved.has(profile.model_provider) &&
          !Object.hasOwn(v.model_providers, profile.model_provider))
      )
        ctx.addIssue({ code: "custom", message: "Invalid gateway profile" });
    }
  });

/** Only non-secret, supported Provider parameters may enter the ordinary configuration row. */
export function providerStateContent(value: unknown) {
  const parsed = values.safeParse(value);
  if (!parsed.success)
    throw new PublicError(
      "网关配置包含不能持久化的参数，请通过受支持的设置或私密入口管理",
    );
  const serialized = JSON.stringify(parsed.data);
  if (Buffer.byteLength(serialized) > 262144)
    throw new PublicError("网关配置超过存储大小限制");
  return serialized;
}

export function providerState(db: Store) {
  function read(): ProviderSnapshot | undefined {
    const row = db.raw
      .prepare(
        "SELECT format,revision,content FROM provider_configuration WHERE id=1",
      )
      .get() as
      | { format: number; revision: string; content: string }
      | undefined;
    if (!row) return undefined;
    try {
      if (
        row.format !== 1 ||
        !z.uuid().safeParse(row.revision).success ||
        Buffer.byteLength(row.content) > 262144
      )
        throw Error();
      const parsed = JSON.parse(row.content);
      providerStateContent(parsed);
      return { revision: row.revision, values: parsed };
    } catch {
      throw new PublicError(
        "已保存的网关配置无法读取，请检查数据库或恢复备份；原配置未被覆盖",
      );
    }
  }
  function writer(expected: string | null): ProviderPersistence {
    return (snapshot) => {
      const serialized = providerStateContent(snapshot.values);
      let changes: number | bigint;
      try {
        const result =
          expected === null
            ? db.raw
                .prepare(
                  "INSERT INTO provider_configuration(id,format,revision,content,updated) VALUES(1,1,?,?,?) ON CONFLICT(id) DO NOTHING",
                )
                .run(snapshot.revision, serialized, Date.now())
            : db.raw
                .prepare(
                  "UPDATE provider_configuration SET format=1,revision=?,content=?,updated=? WHERE id=1 AND revision=?",
                )
                .run(snapshot.revision, serialized, Date.now(), expected);
        changes = result.changes;
      } catch {
        configFail(
          "网关配置写入 SQLite 失败，当前参数未改变，请检查存储后重试",
          502,
          "write_failed",
          "unchanged",
        );
      }
      if (changes !== 1 && changes !== 1n)
        configFail(
          "SQLite 中的网关配置已变化，请重新启动服务载入最新配置",
          409,
          "conflict",
          "unchanged",
          "reconnect",
        );
      expected = snapshot.revision;
    };
  }
  return { read, writer };
}
