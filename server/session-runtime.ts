import { gatewayProfiles } from "./gateway-profiles.js";
import { configFail } from "./configuration-error.js";
import { z } from "zod";
import type { Codex } from "./codex.js";
import type { Store } from "./db.js";
import type { configuration } from "./configuration.js";
import type { providerManager } from "./providers.js";
import type { Json } from "../shared/types.js";
import {
  approvalParameters,
  type ApprovalPreset,
  type SessionRuntime,
} from "../shared/runtime-settings.js";
import { PublicError } from "./public-error.js";
export function sessionRuntime(
  codex: Codex,
  db: Store,
  cwd: string,
  config: ReturnType<typeof configuration>,
  providers: ReturnType<typeof providerManager>,
  nativeCatalog: () => Promise<Json[]>,
) {
  const profiles = gatewayProfiles(() => codex.home);
  const readProfile = async (id: string) =>
    config.runtime
      ? {
          model:
            config.runtime.snapshot().values.profiles?.[`newbot_gateway_${id}`]
              ?.model || "",
          revision: config.runtime.revision,
        }
      : profiles.read(id);
  let cache: { revision: string; at: number; entries: Json[] } | undefined;
  let pending: { revision: string; promise: Promise<Json[]> } | undefined;
  const profile = (id: string) => `newbot_gateway_${id}`;
  async function catalog(refresh = false) {
    const snapshot = await config.read();
    if (
      !refresh &&
      cache?.revision === snapshot.publicView.revision &&
      Date.now() - cache.at < 60000
    )
      return cache.entries;
    if (pending?.revision === snapshot.publicView.revision)
      return pending.promise;
    const operation = (async () => {
      const native = await nativeCatalog(),
        entries: Json[] = [];
      const summaries = [...snapshot.publicView.providers];
      const current = snapshot.publicView.defaults.provider || "openai";
      if (!summaries.some((p) => p.id === current))
        summaries.push({
          id: current,
          name: current,
          editable: false,
          requiresAccountAuth: true,
          endpointOrigin: null,
          wireApi: null,
          credentials: "none",
        });
      let next = 0;
      async function worker() {
        while (next < summaries.length) {
          const index = next++,
            p = summaries[index];
          let owned = { model: "", revision: "absent" },
            profileError: string | null = null;
          try {
            owned = await readProfile(p.id);
          } catch {
            profileError = "默认配置读取失败，请检查服务端配置文件";
          }
          const defaults = owned.model
            ? { model: owned.model }
            : (snapshot.response.config.profiles as Json | undefined)?.[
                profile(p.id)
              ] || {};
          let list: string[] = [],
            error: string | null = null;
          try {
            list = (
              await providers.probe(
                { id: p.id, expectedRevision: snapshot.publicView.revision },
                async () => native,
                false,
                !!p.endpointOrigin &&
                  !p.requiresAccountAuth &&
                  p.wireApi === "responses",
              )
            ).models;
          } catch {
            error = "目录读取失败，请刷新重试";
            if (p.id === current) list = native.map((m) => m.model);
          }
          const model =
            defaults.model ||
            (p.id === snapshot.publicView.defaults.provider
              ? snapshot.publicView.defaults.model
              : null);
          const prior = db.raw
            .prepare(
              "SELECT DISTINCT model FROM session_runtime WHERE provider=? AND model!=''",
            )
            .all(p.id) as { model: string }[];
          for (const entry of prior)
            if (!list.includes(entry.model)) list.push(entry.model);
          if (model && !list.includes(model)) list.push(model);
          entries[index] = {
            id: p.id,
            name: p.name,
            current: p.id === snapshot.publicView.defaults.provider,
            defaultModel: model || "",
            defaultRevision: owned.revision,
            profileError,
            models: list.map((id) => ({
              ...native.find((m) => m.model === id),
              id,
              model: id,
              displayName:
                native.find((m) => m.model === id)?.displayName || id,
              supportedReasoningEfforts:
                native.find((m) => m.model === id)?.supportedReasoningEfforts ||
                [],
              defaultReasoningEffort:
                native.find((m) => m.model === id)?.defaultReasoningEffort ||
                "",
              compatibility: "unverified",
            })),
            error,
          };
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(3, summaries.length) }, () => worker()),
      );
      cache = {
        revision: snapshot.publicView.revision,
        at: Date.now(),
        entries,
      };
      return entries;
    })();
    pending = { revision: snapshot.publicView.revision, promise: operation };
    try {
      return await operation;
    } finally {
      if (pending?.promise === operation) pending = undefined;
    }
  }
  function get(threadId: string): SessionRuntime {
    const row = db.raw
      .prepare(
        "SELECT revision,provider,model,effort,approval FROM session_runtime WHERE thread_id=?",
      )
      .get(threadId) as SessionRuntime | undefined;
    return (
      row || {
        revision: 0,
        provider: db.provider(threadId) || "",
        model: "",
        effort: "",
        approval: "ask",
      }
    );
  }
  function adopt(
    threadId: string,
    response:
      | {
          model?: string;
          modelProvider?: string;
          reasoningEffort?: string | null;
        }
      | undefined,
  ) {
    if (response?.model && response.modelProvider) {
      db.raw
        .prepare(
          `INSERT INTO session_runtime VALUES(?,0,?,?,?,?)
            ON CONFLICT(thread_id) DO UPDATE SET provider=excluded.provider, model=excluded.model, effort=excluded.effort
            WHERE session_runtime.model=''`,
        )
        .run(
          threadId,
          response.modelProvider,
          response.model,
          response.reasoningEffort || "",
          "ask",
        );
      cache = undefined;
    }
  }
  async function presets(model?: string) {
    try {
      const response = await codex.call("configRequirements/read", undefined);
      const r = response.requirements as Json | undefined;
      return (["ask", "review", "full"] as ApprovalPreset[]).map((id) => {
        const p = approvalParameters(id, cwd);
        const requiredAuto =
          !!model && !!r?.autoReview?.requiredOnModels?.includes(model);
        const allowed =
          (!requiredAuto || id === "review") &&
          (!r?.allowedApprovalPolicies ||
            r.allowedApprovalPolicies.includes(p.approvalPolicy)) &&
          (!r?.allowedApprovalsReviewers ||
            r.allowedApprovalsReviewers.includes(p.approvalsReviewer)) &&
          (!r?.allowedSandboxModes ||
            r.allowedSandboxModes.includes(p.sandbox));
        return {
          id,
          allowed,
          reason: allowed ? null : "当前运行策略不允许此权限",
        };
      });
    } catch {
      return [
        { id: "ask", allowed: true, reason: null },
        { id: "review", allowed: false, reason: "未能确认原生审批能力" },
        { id: "full", allowed: false, reason: "未能确认原生审批能力" },
      ];
    }
  }
  async function validate(provider: string, model?: string, effort?: string) {
    const gateway = (await catalog()).find((g) => g.id === provider);
    if (!gateway) throw new PublicError("未知模型网关，请刷新配置");
    const selected = gateway.models.find(
      (m: Json) => m.model === (model || gateway.defaultModel),
    );
    if (model && !selected)
      throw new PublicError("请从该网关已发现的模型中选择");
    if (
      effort &&
      !selected?.supportedReasoningEfforts.some(
        (e: Json) => e.reasoningEffort === effort,
      )
    )
      throw new PublicError("模型不支持该推理强度");
    return selected;
  }
  async function update(p: Json) {
    const data = z
      .object({
        threadId: z.string().min(1).max(200),
        expectedRevision: z.number().int().nonnegative(),
        provider: z.string().optional(),
        model: z.string().optional(),
        effort: z.string().optional(),
        approval: z.enum(["ask", "review", "full"]).optional(),
      })
      .parse(p);
    if (!db.owns(data.threadId)) throw new PublicError("会话不存在");
    const before = get(data.threadId);
    if (before.revision !== data.expectedRevision)
      throw new PublicError("会话配置已变化，请重新读取");
    const next = { ...before, ...data, revision: before.revision + 1 };
    const selectedModel = await validate(
      next.provider,
      next.model || undefined,
      next.effort || undefined,
    );
    if (
      !(await presets(next.model)).some(
        (v) => v.id === next.approval && v.allowed,
      )
    )
      throw new PublicError("当前运行策略不允许此权限");
    const policy = approvalParameters(next.approval, cwd);
    try {
      if (next.provider !== before.provider) {
        await codex.unload(data.threadId);
        const r = await codex.call("thread/resume", {
          threadId: data.threadId,
          modelProvider: next.provider,
          model: next.model || undefined,
          approvalPolicy: policy.approvalPolicy,
          approvalsReviewer: policy.approvalsReviewer,
          sandbox: policy.sandbox,
          excludeTurns: true,
        });
        if (r.modelProvider !== next.provider)
          throw new PublicError("原生线程未切换到选定网关");
        codex.loaded.add(data.threadId);
      } else {
        await codex.resume(
          data.threadId,
          before.provider,
          before.approval,
          before.model || undefined,
        );
      }
      await codex.call("thread/settings/update", {
        threadId: data.threadId,
        model: next.model || undefined,
        effort: (next.effort ||
          selectedModel?.defaultReasoningEffort ||
          undefined) as any,
        approvalPolicy: policy.approvalPolicy,
        approvalsReviewer: policy.approvalsReviewer,
        sandboxPolicy: policy.sandboxPolicy,
      });
    } catch (error) {
      if (next.provider !== before.provider) {
        await codex.unload(data.threadId).catch(() => {});
        await codex
          .resume(
            data.threadId,
            before.provider,
            before.approval,
            before.model || undefined,
          )
          .catch(() => {});
      }
      throw error;
    }
    db.raw
      .prepare("INSERT OR REPLACE INTO session_runtime VALUES(?,?,?,?,?,?)")
      .run(
        data.threadId,
        next.revision,
        next.provider,
        next.model,
        next.effort,
        next.approval,
      );
    db.raw
      .prepare("UPDATE threads SET provider=? WHERE id=?")
      .run(next.provider, data.threadId);
    db.audit("session/update", data.threadId, next.approval);
    return get(data.threadId);
  }
  async function defaults(p: Json) {
    const data = z
      .object({
        id: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
        model: z.string().min(1).max(200),
        expectedRevision: z.string(),
        expectedDefaultRevision: z.string().min(1),
        makeDefault: z.boolean().default(false),
      })
      .parse(p);
    await validate(data.id, data.model);
    const before = await config.read();
    if (before.publicView.revision !== data.expectedRevision)
      throw new PublicError("配置已变化，请刷新后重试");
    if (!before.publicView.writable)
      configFail("当前用户配置不可写，请重新读取配置", 409, "read_only");
    if (config.runtime) {
      if (config.runtime.revision !== data.expectedDefaultRevision)
        throw new PublicError("网关默认设置已变化，请刷新后重试");
      const result = await config.mutate(data.expectedRevision, async () => ({
        edits: [
          {
            keyPath: `profiles.${profile(data.id)}`,
            value: { model: data.model, model_provider: data.id },
            mergeStrategy: "replace",
          },
          ...(data.makeDefault ||
          before.publicView.defaults.provider === data.id
            ? [
                {
                  keyPath: "model_provider",
                  value: data.id,
                  mergeStrategy: "replace" as const,
                },
                {
                  keyPath: "model",
                  value: data.model,
                  mergeStrategy: "replace" as const,
                },
              ]
            : []),
        ],
        effective: (after) =>
          (after.response.config.profiles as any)?.[profile(data.id)]?.model ===
          data.model,
      }));
      cache = undefined;
      return { state: result.state, configuration: result.configuration };
    }
    await profiles.write(data.id, data.model, data.expectedDefaultRevision);
    cache = undefined;
    try {
      if (data.makeDefault || before.publicView.defaults.provider === data.id) {
        const result = await config.mutate(data.expectedRevision, async () => ({
          edits: [
            {
              keyPath: "model_provider",
              value: data.id,
              mergeStrategy: "replace",
            },
            { keyPath: "model", value: data.model, mergeStrategy: "replace" },
          ],
          effective: (after) =>
            after.response.config.model_provider === data.id &&
            after.response.config.model === data.model,
        }));
        return { state: result.state, configuration: result.configuration };
      }
      return {
        state: "applied",
        configuration: (await config.read()).publicView,
      };
    } catch {
      configFail(
        "网关默认模型已保存，但全局默认状态尚未确认，请重新读取",
        502,
        "write_unconfirmed",
        "saved",
        "read",
      );
    }
  }
  async function capture(p: Json, providerConfigRevision?: string) {
    if (p.threadId) {
      const session = get(p.threadId);
      config.runtime?.threadConfig(session.provider, providerConfigRevision);
      if (p.provider && p.provider !== session.provider)
        throw new PublicError("会话网关已变化，请重新读取后发送");
      return {
        provider: session.provider,
        model: p.model || session.model || undefined,
        effort: p.effort || session.effort || undefined,
        runtimeRevision: p.runtimeRevision ?? session.revision,
        ...(config.runtime
          ? {
              providerConfigRevision:
                providerConfigRevision || config.runtime.revision,
            }
          : {}),
      };
    }
    if (config.runtime) {
      const snapshot = config.runtime.snapshot(providerConfigRevision);
      const selectedProvider = p.provider || snapshot.values.model_provider;
      config.runtime.threadConfig(selectedProvider, snapshot.revision);
      return {
        provider: selectedProvider,
        model:
          p.model ||
          snapshot.values.profiles?.[profile(selectedProvider)]?.model ||
          (selectedProvider === snapshot.values.model_provider
            ? snapshot.values.model
            : undefined) ||
          undefined,
        effort:
          p.effort ||
          (selectedProvider === snapshot.values.model_provider &&
          (!p.model || p.model === snapshot.values.model)
            ? snapshot.values.model_reasoning_effort
            : undefined) ||
          undefined,
        approval: p.approval || "ask",
        providerConfigRevision: snapshot.revision,
      };
    }
    const snapshot = await config.read();
    const selectedProvider =
      p.provider || snapshot.publicView.defaults.provider;
    const owned = await readProfile(selectedProvider || "openai");
    const profileDefaults = owned.model
      ? owned
      : (snapshot.response.config.profiles as Json | undefined)?.[
          profile(selectedProvider || "")
        ];
    return {
      provider: selectedProvider,
      model:
        p.model ||
        profileDefaults?.model ||
        (selectedProvider === snapshot.publicView.defaults.provider
          ? snapshot.publicView.defaults.model
          : undefined) ||
        undefined,
      effort: p.effort || snapshot.publicView.defaults.effort || undefined,
      approval: p.approval || "ask",
    };
  }
  return {
    get,
    adopt,
    update,
    catalog,
    validate,
    presets,
    defaults,
    capture,
    invalidate: () => {
      cache = undefined;
    },
  };
}
