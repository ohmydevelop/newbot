import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Store } from "./db.js";
import type { credentialVault } from "./credential-vault.js";
import type { configuration } from "./configuration.js";
import type { CredentialConsumer } from "./credentials.js";
import { PublicError } from "./public-error.js";
import { providerEditable } from "./provider-policy.js";
import { mcpEditable } from "./mcp-policy.js";
import {
  privateFieldSave,
  privateFieldAuthorize,
  type PrivateField,
  type PrivateFieldView,
} from "../shared/credentials.js";
import type { Json } from "../shared/types.js";
type Scope = "provider" | "mcp";
type Row = {
  scope: Scope;
  target: string;
  revision: string;
  binding: string;
  specs: string;
  packet: string | null;
};
type Context = {
  runId: string;
  threadId?: string;
  provider: string;
  config: Json;
  force?: string;
  only?: string;
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const fieldKey = (field: PrivateField) => `${field.kind}:${field.name}`;
export function privateFieldBinding(
  scope: Scope,
  target: string,
  config: Json,
) {
  const def =
    config[scope === "provider" ? "model_providers" : "mcp_servers"]?.[target];
  if (!def) throw new PublicError("凭证接收方不存在");
  const values: unknown[] = [
    scope,
    target,
    def.base_url || def.url || null,
    def.command || null,
    def.args || [],
    def.wire_api || null,
  ];
  const plugin = config.newbot_plugin_connections?.[target];
  if (plugin)
    values.push(plugin, def.env || {}, def.cwd || null, def.http_headers || {});
  return digest(values);
}
export function privateFields(
  db: Store,
  vault: ReturnType<typeof credentialVault>,
  core: ReturnType<typeof configuration>,
) {
  const contexts = new Map<string, Context>();
  const grants = new Map<
    string,
    { packet: string; binding: string; revision: string; context: string }
  >();
  const threadRuns = new Map<string, string>();
  let onReady: (runId: string) => void = () => {};
  const row = (scope: Scope, target: string) =>
    db.raw
      .prepare("SELECT * FROM private_field_sets WHERE scope=? AND target=?")
      .get(scope, target) as Row | undefined;
  const rows = () =>
    db.raw.prepare("SELECT * FROM private_field_sets").all() as Row[];
  const definition = (scope: Scope, target: string, config: Json) =>
    config[scope === "provider" ? "model_providers" : "mcp_servers"]?.[
      target
    ] as Json | undefined;
  const binding = privateFieldBinding;
  function readPacket(packet: string, context: string): Record<string, string> {
    const bytes = vault.openPrivate(packet, context);
    try {
      return JSON.parse(bytes.toString("utf8"));
    } finally {
      bytes.fill(0);
    }
  }
  function seal(values: Record<string, string>, context: string) {
    const bytes = Buffer.from(JSON.stringify(values));
    try {
      return vault.sealPrivate(bytes, context);
    } finally {
      bytes.fill(0);
    }
  }
  function saved(r: Row, config: Json) {
    if (r.binding !== binding(r.scope, r.target, config) || !r.packet)
      return {};
    return readPacket(r.packet, `fields:${r.scope}:${r.target}:${r.binding}`);
  }
  function info(scope: Scope, target: string, config: Json): PrivateFieldView {
    const r = row(scope, target);
    if (!r) return { revision: "absent", fields: [], valid: true };
    let values: Record<string, string> = {},
      valid = false;
    try {
      valid = r.binding === binding(scope, target, config);
      values = saved(r, config);
    } catch {}
    return {
      revision: r.revision,
      valid,
      fields: (JSON.parse(r.specs) as PrivateField[]).map((f) => ({
        ...f,
        stored: !!values[fieldKey(f)],
      })),
    };
  }
  function validateFields(
    scope: Scope,
    target: string,
    config: Json,
    fields: PrivateField[],
  ) {
    const def = definition(scope, target, config)!;
    const names = new Set<string>();
    for (const f of fields) {
      if (names.has(fieldKey(f).toLowerCase()))
        throw new PublicError("凭证字段不能重复");
      names.add(fieldKey(f).toLowerCase());
      if (f.kind === "env") {
        if (
          scope !== "mcp" ||
          !def.command ||
          !/^[A-Z_][A-Z0-9_]{0,127}$/.test(f.name) ||
          /^(HOME|PATH|CODEX_HOME|NODE_OPTIONS|LD_.*|DYLD_.*|PYTHONPATH|PYTHONHOME|BASH_ENV|ENV|ADMIN_PASSWORD|NEWBOT_.*)$/.test(
            f.name,
          )
        )
          throw new PublicError("环境变量名无效或属于受保护的运行参数");
      } else {
        const url = new URL(def.base_url || def.url);
        if (
          def.command ||
          (url.protocol !== "https:" &&
            !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
        )
          throw new PublicError("私密请求头需要 HTTPS 或本机回环地址");
        if (f.kind === "bearer" && f.name !== "Authorization")
          throw new PublicError("Bearer 字段无效");
        if (
          f.kind === "header" &&
          (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(f.name) ||
            /^(host|connection|content-length|transfer-encoding|cookie|set-cookie|proxy-authorization|upgrade|trailer)$/i.test(
              f.name,
            ))
        )
          throw new PublicError("请求头名称无效或由系统管理");
      }
    }
    if (
      fields.some((f) => f.kind === "bearer") &&
      fields.some(
        (f) => f.kind === "header" && f.name.toLowerCase() === "authorization",
      )
    )
      throw new PublicError("Bearer 与 Authorization 请求头不能重复配置");
  }
  function decode(bytes: Buffer, fields: PrivateField[]) {
    let values: Record<string, string>;
    try {
      values = z
        .record(
          z.string(),
          z
            .string()
            .max(4096)
            .refine((v) => !/[\0\r\n]/.test(v)),
        )
        .parse(
          JSON.parse(
            Buffer.from(bytes.toString("ascii"), "base64").toString("utf8"),
          ),
        );
    } catch {
      throw new PublicError("私密字段格式无效");
    }
    const allowed = new Set(fields.map(fieldKey));
    if (Object.keys(values).some((k) => !allowed.has(k)))
      throw new PublicError("私密字段不属于已确认的接收方");
    return values;
  }
  function available(r: Row, context: Context) {
    let values: Record<string, string> = {};
    try {
      values = saved(r, context.config);
    } catch {}
    for (const prefix of [
      context.threadId ? `thread:${context.threadId}` : "",
      `pending-thread:${context.runId}`,
      `run:${context.runId}`,
    ]) {
      const grant = grants.get(`${prefix}:${r.scope}:${r.target}`);
      if (
        grant &&
        grant.binding === binding(r.scope, r.target, context.config) &&
        grant.revision === r.revision
      )
        Object.assign(values, readPacket(grant.packet, grant.context));
    }
    return values;
  }
  function selected(context: Context) {
    return rows().filter(
      (r) =>
        (!(context.only || context.force) ||
          (context.only || context.force) === `${r.scope}:${r.target}`) &&
        (r.scope === "provider"
          ? r.target === context.provider
          : !!definition("mcp", r.target, context.config) &&
            definition("mcp", r.target, context.config)?.enabled !== false),
    );
  }
  function pending(runId: string) {
    const context = contexts.get(runId);
    if (!context) return [];
    return selected(context).flatMap((r) => {
      const values = available(r, context),
        fields = (JSON.parse(r.specs) as PrivateField[]).filter(
          (f) => context.force || !values[fieldKey(f)],
        );
      return fields.length
        ? [
            {
              scope: r.scope,
              targetId: r.target,
              revision: r.revision,
              fields,
              receiver: receiver(r.scope, r.target, context.config),
            },
          ]
        : [];
    });
  }
  function receiver(scope: Scope, target: string, config: Json) {
    const def = definition(scope, target, config)!;
    return def.command
      ? `服务端程序：${def.command}`
      : new URL(def.base_url || def.url).origin;
  }
  async function prepare(
    input:
      | z.infer<typeof privateFieldSave>
      | z.infer<typeof privateFieldAuthorize>,
  ): Promise<CredentialConsumer> {
    const before = await core.read();
    const old = row(input.scope, input.targetId);
    if ((old?.revision || "absent") !== input.expectedFieldsRevision)
      throw new PublicError("凭证字段已变化，请刷新后重试");
    const context =
      input.operation === "credential.authorize"
        ? contexts.get(input.runId)
        : undefined;
    const config = context?.config || before.response.config;
    const bound = binding(input.scope, input.targetId, config);
    let fields =
      input.operation === "credential.fields.save"
        ? input.fields
        : (JSON.parse(old?.specs || "[]") as PrivateField[]);
    if (input.operation === "credential.fields.save") {
      // Missing fields are not a deletion command. Older clients or partial views
      // must not accidentally turn an authenticated receiver into an anonymous one.
      const existing: PrivateField[] = old
        ? JSON.parse(old.specs)
        : vault.info(input.scope, input.targetId, config).stored
          ? [{ kind: "bearer", name: "Authorization" }]
          : [];
      const removed = new Set((input.removeFields || []).map(fieldKey));
      fields = [
        ...fields,
        ...existing.filter(
          (field) =>
            !removed.has(fieldKey(field)) &&
            !fields.some((next) => fieldKey(next) === fieldKey(field)),
        ),
      ];
      if (fields.length > 32) throw new PublicError("最多配置 32 个私密字段");
      if (
        !core.matches(
          before,
          input.expectedRevision,
          `${input.scope}:${input.targetId}`,
        )
      )
        throw new PublicError("连接配置已变化");
      if (
        !(input.scope === "provider"
          ? providerEditable(before.response, input.targetId)
          : mcpEditable(before.response, input.targetId))
      )
        throw new PublicError("此接收方由其他来源管理");
    } else if (
      !context ||
      !pending(input.runId).some(
        (p) => p.scope === input.scope && p.targetId === input.targetId,
      )
    )
      throw new PublicError("任务已结束或不需要该凭证");
    validateFields(input.scope, input.targetId, config, fields);
    return {
      receiver: receiver(input.scope, input.targetId, config),
      targetId: input.targetId,
      run: async (bytes, _signal, authorized, commit) => {
        const actual = await core.read();
        if (
          !authorized() ||
          binding(input.scope, input.targetId, actual.response.config) !==
            bound ||
          (row(input.scope, input.targetId)?.revision || "absent") !==
            input.expectedFieldsRevision
        )
          throw new PublicError("接收方或凭证已变化");
        const values = decode(bytes, fields);
        if (input.operation === "credential.fields.save") {
          let previous: Record<string, string> = {};
          try {
            if (old && !input.clearValues) previous = saved(old, config);
          } catch {}
          if (
            !old &&
            !input.clearValues &&
            fields.some((f) => f.kind === "bearer")
          ) {
            try {
              vault.useCredential(
                input.scope,
                input.targetId,
                config,
                (value) => {
                  previous["bearer:Authorization"] = value.toString("ascii");
                },
              );
            } catch {
              /* No legacy value to migrate. */
            }
          }
          const next = Object.fromEntries(
            fields.flatMap((f) => {
              const k = fieldKey(f),
                v = values[k] || previous[k];
              return v ? [[k, v]] : [];
            }),
          );
          const packet = seal(
            next,
            `fields:${input.scope}:${input.targetId}:${bound}`,
          );
          commit();
          db.raw.exec("BEGIN");
          try {
            db.raw
              .prepare(
                "INSERT OR REPLACE INTO private_field_sets VALUES(?,?,?,?,?,?)",
              )
              .run(
                input.scope,
                input.targetId,
                randomUUID(),
                bound,
                JSON.stringify(fields),
                packet,
              );
            db.raw
              .prepare(
                "UPDATE private_operations SET result=?,updated=? WHERE id=?",
              )
              .run(
                JSON.stringify({
                  id: input.requestId,
                  operation: input.operation,
                  targetId: input.targetId,
                  state: "succeeded",
                  committed: true,
                  applied: true,
                  expiresAt: Date.now(),
                }),
                Date.now(),
                input.requestId,
              );
            db.raw.exec("COMMIT");
          } catch (error) {
            db.raw.exec("ROLLBACK");
            throw error;
          }
        } else {
          const still = contexts.get(input.runId);
          if (!still || still !== context) throw new PublicError("任务已失效");
          if (
            fields.some(
              (f) =>
                !values[fieldKey(f)] && !available(old!, still)[fieldKey(f)],
            )
          )
            throw new PublicError("请填写所需凭证");
          const prefix =
            input.duration === "thread"
              ? context!.threadId
                ? `thread:${context!.threadId}`
                : `pending-thread:${input.runId}`
              : `run:${input.runId}`;
          const grantContext = `grant:${prefix}:${input.scope}:${input.targetId}:${old!.revision}`;
          const packet = seal(values, grantContext);
          commit();
          grants.set(`${prefix}:${input.scope}:${input.targetId}`, {
            packet,
            binding: bound,
            revision: old!.revision,
            context: grantContext,
          });
          if (still.force) delete still.force;
          queueMicrotask(() => {
            if (!pending(input.runId).length) onReady(input.runId);
          });
        }
        return { state: "succeeded", applied: true };
      },
    };
  }
  return {
    info,
    prepare,
    pending,
    targets(context: Context) {
      return selected(context)
        .filter((r) => JSON.parse(r.specs).length)
        .map((r) => ({
          scope: r.scope,
          targetId: r.target,
          receiver: receiver(r.scope, r.target, context.config),
        }));
    },
    version(threadId?: string) {
      return digest([
        rows().map((r) => [r.scope, r.target, r.revision]),
        [...grants]
          .filter(
            ([key]) =>
              key.startsWith(`thread:${threadId}:`) ||
              key.startsWith(`run:${threadRuns.get(threadId || "")}:`),
          )
          .map(([key, g]) => [key, g.packet]),
      ]);
    },
    set onReady(fn: (runId: string) => void) {
      onReady = fn;
    },
    bind(context: Context) {
      contexts.set(context.runId, context);
      if (context.threadId && !context.only)
        threadRuns.set(context.threadId, context.runId);
    },
    assign(runId: string, threadId: string) {
      const c = contexts.get(runId);
      if (c) {
        c.threadId = threadId;
        threadRuns.set(threadId, runId);
        for (const [key, value] of grants)
          if (key.startsWith(`pending-thread:${runId}:`)) {
            grants.set(
              key.replace(`pending-thread:${runId}:`, `thread:${threadId}:`),
              value,
            );
            grants.delete(key);
          }
      }
    },
    finish(runId: string) {
      const context = contexts.get(runId);
      contexts.delete(runId);
      if (context?.threadId && threadRuns.get(context.threadId) === runId)
        threadRuns.delete(context.threadId);
      let ephemeral = false;
      for (const key of grants.keys())
        if (
          key.startsWith(`run:${runId}:`) ||
          key.startsWith(`pending-thread:${runId}:`)
        ) {
          grants.delete(key);
          ephemeral = true;
        }
      return ephemeral ? context?.threadId : undefined;
    },
    revoke(threadId: string) {
      for (const key of grants.keys())
        if (key.startsWith(`thread:${threadId}:`)) grants.delete(key);
    },
    hasThreadGrant(threadId: string) {
      return [...grants.keys()].some((k) =>
        k.startsWith(`thread:${threadId}:`),
      );
    },
    async inject(params: Json) {
      const config = structuredClone(params.config || {}),
        context = contexts.get(
          params.privateRunId || threadRuns.get(params.threadId) || "",
        );
      const base =
        (!params.privateRouteOnly && context?.config) ||
        (await core.read()).response.config;
      const provider =
        params.modelProvider || context?.provider || base.model_provider;
      // Existing single-key vault entries remain compatible without child-process environment rotation.
      const legacy = (scope: Scope, target: string, def: Json | undefined) => {
        if (row(scope, target)) {
          if (def) {
            for (const key of ["env_key", "bearer_token_env_var"])
              if (
                typeof def[key] === "string" &&
                def[key].startsWith("NEWBOT_CREDENTIAL_KEY_")
              )
                delete def[key];
          }
          return;
        }
        const ref =
          def?.[scope === "provider" ? "env_key" : "bearer_token_env_var"];
        if (
          !def ||
          typeof ref !== "string" ||
          !ref.startsWith("NEWBOT_CREDENTIAL_KEY_")
        )
          return;
        assertReceiver(scope, target);
        vault.useCredential(scope, target, base, (value) => {
          def.http_headers = {
            ...def.http_headers,
            Authorization: `Bearer ${value.toString("ascii")}`,
          };
          delete def.env_key;
          delete def.bearer_token_env_var;
        });
      };
      // Decrypt only for the exact receiver captured by the caller. A concurrent
      // edit must never move a freshly read credential into an older endpoint.
      function assertReceiver(scope: Scope, target: string) {
        const captured = {
          ...config,
          newbot_plugin_connections: base.newbot_plugin_connections,
        };
        if (binding(scope, target, captured) !== binding(scope, target, base))
          throw new PublicError("凭证接收方已变化，请重新读取配置后重试");
      }
      legacy("provider", provider, config.model_providers?.[provider]);
      for (const [id, def] of Object.entries(config.mcp_servers || {}) as [
        string,
        Json,
      ][])
        if (def.enabled !== false) legacy("mcp", id, def);
      // Decrypt only at the native transport boundary, after durable snapshot capture.
      const temporary: Context = params.privateRouteOnly
        ? {
            runId: context?.runId || "",
            threadId: params.threadId,
            provider,
            config: base,
          }
        : context || {
            runId: "",
            threadId: params.threadId,
            provider,
            config: base,
          };
      for (const r of selected(temporary)) {
        if (
          params.privateRouteOnly &&
          (r.scope !== "provider" || r.target !== provider)
        )
          continue;
        const fields = JSON.parse(r.specs) as PrivateField[],
          values = available(r, temporary);
        if (fields.some((f) => !values[fieldKey(f)])) {
          if (params.privateRouteOnly && r.scope === "provider")
            throw new PublicError("此网关需要先完成私密授权");
          if (r.scope === "mcp")
            config.mcp_servers = {
              ...config.mcp_servers,
              [r.target]: { ...config.mcp_servers?.[r.target], enabled: false },
            };
          continue;
        }
        const collection =
          r.scope === "provider" ? "model_providers" : "mcp_servers";
        const def = config[collection]?.[r.target];
        if (!def) continue;
        assertReceiver(r.scope, r.target);
        for (const f of fields) {
          if (f.kind === "env")
            def.env = { ...def.env, [f.name]: values[fieldKey(f)] };
          else {
            def.http_headers = {
              ...def.http_headers,
              [f.kind === "bearer" ? "Authorization" : f.name]:
                f.kind === "bearer"
                  ? `Bearer ${values[fieldKey(f)]}`
                  : values[fieldKey(f)],
            };
            if (f.kind === "bearer") {
              delete def.env_key;
              delete def.bearer_token_env_var;
            }
          }
        }
      }
      const { privateRunId: _, privateRouteOnly: __, ...rest } = params;
      delete config.newbot_plugin_connections;
      return { ...rest, config };
    },
  };
}
