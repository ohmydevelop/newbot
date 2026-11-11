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
  compatibleDefaultEffort,
  type ApprovalPreset,
  type SessionRuntime,
  type RuntimeConfiguration,
} from "../shared/runtime-settings.js";
import { PublicError } from "./public-error.js";
import { effortSupport } from "../shared/reasoning.js";
export function sessionRuntime(
  codex: Codex,
  db: Store,
  cwd: string,
  config: ReturnType<typeof configuration>,
  providers: ReturnType<typeof providerManager>,
  nativeCatalog: () => Promise<Json[]>,
  threadCwd: (id: string) => string = () => cwd,
  changed: (threadId: string, runtime: SessionRuntime) => void = () => {},
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
  const directories = new Map<
    string,
    { key: string; at: number; models: string[]; error: string | null }
  >();
  const knownModels = new Map<string, Json[]>();
  const profile = (id: string) => `newbot_gateway_${id}`;
  async function catalog(refresh = false, refreshId?: string) {
    const snapshot = await config.read();
    const catalogRevision = JSON.stringify([
      snapshot.publicView.revision,
      snapshot.publicView.providers.map((p) => p.privateFields?.revision),
    ]);
    if (
      !refresh &&
      cache?.revision === catalogRevision &&
      Date.now() - cache.at < 60000
    )
      return cache.entries;
    if (pending?.revision === catalogRevision) return pending.promise;
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
          const directoryKey = JSON.stringify([
            (snapshot.response.config.model_providers as Json)?.[p.id] || p.id,
            p.privateFields?.revision,
          ]);
          const cached = directories.get(p.id);
          if (
            cached &&
            cached.key === directoryKey &&
            Date.now() - cached.at < 60000 &&
            !(refresh && (!refreshId || refreshId === p.id))
          ) {
            list = [...cached.models];
            error = cached.error;
          } else {
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
            }
            directories.set(p.id, {
              key: directoryKey,
              at: Date.now(),
              models: [...list],
              error,
            });
          }
          const discovered = new Set(list);
          const manual = new Set(p.customModels || []);
          for (const id of manual) if (!list.includes(id)) list.push(id);
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
            defaultRevision: config.runtime
              ? snapshot.publicView.revisions?.[`gateway-default:${p.id}`] ||
                owned.revision
              : owned.revision,
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
              source: manual.has(id)
                ? "manual"
                : discovered.has(id)
                  ? "discovered"
                  : "history",
              compatibility: "unverified",
              reasoningCapability: {
                status:
                  p.id === "openai" &&
                  !p.endpointOrigin &&
                  native.find((m) => m.model === id)?.supportedReasoningEfforts
                    ?.length
                    ? "supported"
                    : "unknown",
                source:
                  p.id === "openai" && !p.endpointOrigin
                    ? "codex-catalog"
                    : "gateway-unverified",
                provider: p.id,
                revision: snapshot.publicView.revision,
              },
            })),
            error,
          };
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(3, summaries.length) }, () => worker()),
      );
      cache = {
        revision: catalogRevision,
        at: Date.now(),
        entries,
      };
      for (const entry of entries) knownModels.set(entry.id, entry.models);
      return entries;
    })();
    pending = { revision: catalogRevision, promise: operation };
    try {
      return await operation;
    } finally {
      if (pending?.promise === operation) pending = undefined;
    }
  }
  function applied(threadId: string): RuntimeConfiguration {
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
  function candidate(threadId: string) {
    const row = db.raw
      .prepare(
        "SELECT revision,candidate,state,error FROM session_runtime_pending WHERE thread_id=?",
      )
      .get(threadId) as
      | {
          revision: number;
          candidate: string;
          state: NonNullable<SessionRuntime["pending"]>["state"];
          error: string | null;
        }
      | undefined;
    return row
      ? { ...row, value: JSON.parse(row.candidate) as RuntimeConfiguration }
      : undefined;
  }
  function get(threadId: string): SessionRuntime {
    const current = applied(threadId),
      next = candidate(threadId);
    const version =
      (
        db.raw
          .prepare(
            "SELECT version FROM session_runtime_versions WHERE thread_id=?",
          )
          .get(threadId) as { version: number } | undefined
      )?.version || 0;
    return next
      ? {
          ...next.value,
          version,
          applied: current,
          pending: {
            state: next.state,
            ...(next.error ? { error: next.error } : {}),
          },
        }
      : { ...current, version, applied: current };
  }
  function announce(threadId: string) {
    db.raw
      .prepare(
        "INSERT INTO session_runtime_versions VALUES(?,1) ON CONFLICT(thread_id) DO UPDATE SET version=version+1",
      )
      .run(threadId);
    changed(threadId, get(threadId));
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
    if (model && !selected) throw new PublicError("请从该网关的模型目录中选择");
    if (effort && effortSupport(selected, effort) === "unsupported")
      throw new PublicError("模型不支持该推理强度");
    return selected;
  }
  async function implicitEffort(
    provider: string,
    model?: string,
    preferred?: string | null,
  ) {
    const gateway = (await catalog()).find((g) => g.id === provider);
    return compatibleDefaultEffort(
      gateway?.models.find(
        (m: Json) => m.model === (model || gateway.defaultModel),
      ),
      preferred,
    );
  }
  async function check(next: RuntimeConfiguration) {
    const model = await validate(
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
    return model;
  }
  async function update(p: Json, defer = false) {
    const data = z
      .object({
        threadId: z.string().min(1).max(200),
        expectedRevision: z.number().int().nonnegative(),
        provider: z.string().optional(),
        model: z.string().optional(),
        effort: z.string().optional(),
        approval: z.enum(["ask", "review", "full"]).optional(),
        cancel: z.boolean().optional(),
      })
      .parse(p);
    if (!db.owns(data.threadId)) throw new PublicError("会话不存在");
    const before = get(data.threadId);
    const priorCandidate = candidate(data.threadId);
    if (before.revision !== data.expectedRevision)
      throw new PublicError("会话配置已变化，请重新读取");
    const base = data.cancel ? applied(data.threadId) : before;
    const next: RuntimeConfiguration = {
      revision:
        Math.max(
          before.revision,
          (
            db.raw
              .prepare(
                "SELECT MAX(revision) AS revision FROM session_runtime_requests WHERE thread_id=?",
              )
              .get(data.threadId) as { revision: number | null }
          )?.revision || 0,
        ) + 1,
      provider: data.provider ?? base.provider,
      model: data.model ?? base.model,
      effort: data.effort ?? base.effort,
      approval: data.approval ?? base.approval,
    };
    if (
      !data.cancel &&
      data.effort === undefined &&
      (next.model !== before.model || next.provider !== before.provider)
    )
      next.effort =
        (await implicitEffort(next.provider, next.model, before.effort)) || "";
    await check(next);
    // Validation is asynchronous. Reserve the revision before touching the runtime.
    if (get(data.threadId).revision !== before.revision)
      throw new PublicError("会话配置已变化，请重新读取");
    db.raw
      .prepare(
        "INSERT OR REPLACE INTO session_runtime_pending VALUES(?,?,?,'pending',NULL)",
      )
      .run(data.threadId, next.revision, JSON.stringify(next));
    db.audit("session/update", data.threadId, "saved");
    announce(data.threadId);
    const liveTurn = codex.activeTurns?.get(data.threadId);
    if (
      liveTurn &&
      codex.runtimeCapabilities?.liveModelRoutes &&
      next.approval === applied(data.threadId).approval
    ) {
      await applyLive(data.threadId, liveTurn, next, priorCandidate);
      return get(data.threadId);
    }
    if (!defer) {
      try {
        await apply(data.threadId, next.revision);
      } catch {
        /* Saved intent and a safe error remain visible for retry or cancellation. */
      }
    }
    return get(data.threadId);
  }
  async function nativeSettings(
    threadId: string,
    next: RuntimeConfiguration,
    before: RuntimeConfiguration,
    providerRevision?: string,
    force = false,
  ) {
    const policy = approvalParameters(next.approval, threadCwd(threadId));
    const model = await check(next);
    const reload =
      force ||
      next.provider !== before.provider ||
      (!next.effort && !!before.effort);
    if (reload) {
      await codex.unload(threadId);
      const r = await codex.call("thread/resume", {
        threadId,
        cwd: threadCwd(threadId),
        modelProvider: next.provider,
        model: next.model || undefined,
        ...(next.effort
          ? { config: { model_reasoning_effort: next.effort } }
          : {}),
        approvalPolicy: policy.approvalPolicy,
        approvalsReviewer: policy.approvalsReviewer,
        sandbox: policy.sandbox,
        excludeTurns: true,
        ...(providerRevision
          ? { providerConfigRevision: providerRevision }
          : {}),
      } as any);
      if (r.modelProvider !== next.provider)
        throw new PublicError("原生线程未切换到选定网关");
      codex.loaded.add(threadId);
    } else
      await codex.resume(
        threadId,
        before.provider,
        before.approval,
        before.model || undefined,
        providerRevision,
      );
    await codex.call("thread/settings/update", {
      threadId,
      model: next.model || undefined,
      effort: (next.effort ||
        model?.defaultReasoningEffort ||
        undefined) as any,
      approvalPolicy: policy.approvalPolicy,
      approvalsReviewer: policy.approvalsReviewer,
      sandboxPolicy: policy.sandboxPolicy,
    });
  }
  const liveQueues = new Map<string, Promise<void>>();
  function appliedLive(threadId: string, turnId: string, event: Json) {
    const receipt = db.raw
      .prepare(
        "SELECT configuration,turn_id FROM session_runtime_requests WHERE thread_id=? AND revision=?",
      )
      .get(threadId, event.revision) as
      | { configuration: string; turn_id: string }
      | undefined;
    if (!receipt || receipt.turn_id !== turnId || !db.owns(threadId)) return;
    const value = JSON.parse(receipt.configuration) as RuntimeConfiguration;
    if (
      event.providerId !== value.provider ||
      event.model !== value.model ||
      applied(threadId).revision >= value.revision
    )
      return;
    db.raw
      .prepare("INSERT OR REPLACE INTO session_runtime VALUES(?,?,?,?,?,?)")
      .run(
        threadId,
        value.revision,
        value.provider,
        value.model,
        value.effort,
        value.approval,
      );
    db.raw
      .prepare("UPDATE threads SET provider=? WHERE id=?")
      .run(value.provider, threadId);
    db.raw
      .prepare(
        "UPDATE session_runtime_requests SET state='applied' WHERE thread_id=? AND revision=?",
      )
      .run(threadId, value.revision);
    db.raw
      .prepare(
        "DELETE FROM session_runtime_pending WHERE thread_id=? AND revision=?",
      )
      .run(threadId, value.revision);
    // Live settings belong to this turn. Future turns must resume with the
    // persisted selection instead of reusing the old thread defaults.
    codex.threadConfigRevisions.delete(threadId);
    db.audit("session/live-used", threadId, String(value.revision));
    announce(threadId);
  }
  codex.on("event", (event: Json) => {
    if (event.method === "turn/settings/applied")
      appliedLive(event.params.threadId, event.params.turnId, event.params);
  });
  async function applyLive(
    threadId: string,
    turnId: string,
    next: RuntimeConfiguration,
    prior?: ReturnType<typeof candidate>,
  ) {
    const operation = (liveQueues.get(threadId) || Promise.resolve())
      .catch(() => {})
      .then(async () => {
        if (candidate(threadId)?.revision !== next.revision) return;
        // A finished/replaced turn cannot become the target of a late setting.
        if (codex.activeTurns.get(threadId) !== turnId) return;
        let requestSent = false;
        db.raw
          .prepare(
            "INSERT OR REPLACE INTO session_runtime_requests VALUES(?,?,?,?,'prepared')",
          )
          .run(threadId, next.revision, turnId, JSON.stringify(next));
        try {
          const runtime = config.runtime;
          if (!runtime)
            throw new PublicError("任务内网关更新需要服务端配置存储");
          const destination = await check(next);
          const snapshot = runtime.threadConfig(next.provider);
          const privateRevision = codex.privateVersion?.(threadId);
          const captured: Json = {
            threadId,
            modelProvider: next.provider,
            config: snapshot.config,
            privateRouteOnly: true,
          };
          const hydrated = codex.privateConfiguration
            ? await codex.privateConfiguration(captured)
            : captured;
          if (
            runtime.revision !== snapshot.revision ||
            codex.privateVersion?.(threadId) !== privateRevision
          )
            throw new PublicError("网关或凭证配置已变化，请重新选择");
          if (
            candidate(threadId)?.revision !== next.revision ||
            codex.activeTurns.get(threadId) !== turnId
          )
            return;
          db.raw
            .prepare(
              "UPDATE session_runtime_pending SET state='applying',error=NULL WHERE thread_id=? AND revision=?",
            )
            .run(threadId, next.revision);
          announce(threadId);
          requestSent = true;
          const result = await codex.call("turn/settings/update", {
            threadId,
            turnId,
            model: next.model,
            effort:
              next.effort || destination?.defaultReasoningEffort || undefined,
            modelRoute: {
              providerId: next.provider,
              provider:
                hydrated.config.model_providers?.[next.provider] || null,
              revision: BigInt(next.revision),
            },
          });
          if (result.status === "targetUnavailable") {
            db.raw
              .prepare(
                "UPDATE session_runtime_pending SET state='pending' WHERE thread_id=? AND revision=?",
              )
              .run(threadId, next.revision);
            announce(threadId);
            return;
          }
          if (result.status !== "applied")
            throw new PublicError("内核未确认本次设置更新");
          db.raw
            .prepare(
              "UPDATE session_runtime_requests SET state='accepted' WHERE thread_id=? AND revision=? AND state!='applied'",
            )
            .run(threadId, next.revision);
          db.raw
            .prepare(
              "UPDATE session_runtime_pending SET state='accepted',error=NULL WHERE thread_id=? AND revision=?",
            )
            .run(threadId, next.revision);
          codex.threadConfigRevisions.delete(threadId);
          announce(threadId);
        } catch (error) {
          if (applied(threadId).revision >= next.revision) return;
          if (requestSent && !(error instanceof PublicError)) {
            db.raw
              .prepare(
                "UPDATE session_runtime_pending SET state='unknown',error=? WHERE thread_id=? AND revision=?",
              )
              .run("正在核对运行设置是否已采用", threadId, next.revision);
          } else {
            if (candidate(threadId)?.revision === next.revision) {
              if (prior && applied(threadId).revision < prior.revision)
                db.raw
                  .prepare(
                    "INSERT OR REPLACE INTO session_runtime_pending VALUES(?,?,?,?,?)",
                  )
                  .run(
                    threadId,
                    prior.revision,
                    prior.candidate,
                    prior.state,
                    prior.error,
                  );
              else
                db.raw
                  .prepare(
                    "DELETE FROM session_runtime_pending WHERE thread_id=? AND revision=?",
                  )
                  .run(threadId, next.revision);
            }
            db.raw
              .prepare(
                "UPDATE session_runtime_requests SET state='rejected' WHERE thread_id=? AND revision=?",
              )
              .run(threadId, next.revision);
          }
          announce(threadId);
          throw error;
        }
      });
    liveQueues.set(threadId, operation);
    try {
      await operation;
    } finally {
      if (liveQueues.get(threadId) === operation) liveQueues.delete(threadId);
    }
  }
  // Called only while the Bridge owns the thread's start/settings lock. Later edits
  // may save a newer candidate, but cannot alter this frozen native application.
  async function apply(
    threadId: string,
    expectedRevision: number,
    providerRevision?: string,
  ) {
    const next = get(threadId),
      before = applied(threadId);
    if (next.revision !== expectedRevision)
      throw new PublicError("会话配置已变化，请重新读取后发送");
    if (!next.pending) return before;
    db.raw
      .prepare(
        "UPDATE session_runtime_pending SET state='applying',error=NULL WHERE thread_id=? AND revision=?",
      )
      .run(threadId, next.revision);
    announce(threadId);
    try {
      await nativeSettings(
        threadId,
        next,
        before,
        providerRevision,
        next.pending.state === "failed",
      );
      db.raw
        .prepare("INSERT OR REPLACE INTO session_runtime VALUES(?,?,?,?,?,?)")
        .run(
          threadId,
          next.revision,
          next.provider,
          next.model,
          next.effort,
          next.approval,
        );
      db.raw
        .prepare("UPDATE threads SET provider=? WHERE id=?")
        .run(next.provider, threadId);
      db.raw
        .prepare(
          "DELETE FROM session_runtime_pending WHERE thread_id=? AND revision=?",
        )
        .run(threadId, next.revision);
      db.audit("session/apply", threadId, next.approval);
      announce(threadId);
      return applied(threadId);
    } catch {
      // Reload the last confirmed settings, including effort; do not restart the
      // shared process or approve any pending request. Next send must apply again.
      await nativeSettings(threadId, before, next, undefined, true).catch(
        () => {},
      );
      db.raw
        .prepare(
          "UPDATE session_runtime_pending SET state='failed',error=? WHERE thread_id=? AND revision=?",
        )
        .run("设置已保存，应用失败。请重试或撤销。", threadId, next.revision);
      announce(threadId);
      throw new PublicError("下一轮设置应用失败，消息未发送，请重试或撤销设置");
    }
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
    if (!/^[A-Za-z0-9][A-Za-z0-9._:/+\-]*$/.test(data.model))
      throw new PublicError("模型 ID 格式无效");
    const selectedModel = config.runtime
      ? knownModels.get(data.id)?.find((m) => m.model === data.model)
      : await validate(data.id, data.model);
    const before = await config.read();
    const scope = `gateway-default:${data.id}`;
    if (
      !config.matches(before, data.expectedRevision, scope) &&
      !config.matches(before, data.expectedDefaultRevision, scope)
    )
      throw new PublicError("默认设置已变化，请刷新后重试");
    if (!before.publicView.writable)
      configFail("当前用户配置不可写，请重新读取配置", 409, "read_only");
    if (config.runtime) {
      if (
        config.runtime.revision !== data.expectedDefaultRevision &&
        !config.matches(before, data.expectedDefaultRevision, scope)
      )
        throw new PublicError("网关默认设置已变化，请刷新后重试");
      if (
        data.id !== "openai" &&
        !(before.response.config.model_providers as Json)?.[data.id]
      )
        throw new PublicError("网关已不存在");
      const result = await config.mutate(
        before.publicView.revisions?.[scope] || data.expectedRevision,
        async () => ({
          edits: [
            ...(data.makeDefault &&
            before.publicView.defaults.provider &&
            before.publicView.defaults.provider !== data.id &&
            before.publicView.defaults.model &&
            !(before.response.config.profiles as Json | undefined)?.[
              profile(before.publicView.defaults.provider)
            ]?.model
              ? [
                  {
                    keyPath: `profiles.${profile(before.publicView.defaults.provider)}`,
                    value: {
                      model: before.publicView.defaults.model,
                      model_provider: before.publicView.defaults.provider,
                    },
                    mergeStrategy: "replace" as const,
                  },
                ]
              : []),
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
                  {
                    keyPath: "model_reasoning_effort",
                    value:
                      compatibleDefaultEffort(
                        selectedModel,
                        before.publicView.defaults.effort,
                      ) || null,
                    mergeStrategy: "replace" as const,
                  },
                ]
              : []),
          ],
          effective: (after) =>
            (after.response.config.profiles as any)?.[profile(data.id)]
              ?.model === data.model,
        }),
        scope,
      );
      cache = undefined;
      return { state: result.state, configuration: result.configuration };
    }
    if (
      data.makeDefault &&
      before.publicView.defaults.provider &&
      before.publicView.defaults.provider !== data.id &&
      before.publicView.defaults.model
    ) {
      const prior = await profiles.read(before.publicView.defaults.provider);
      if (!prior.model)
        await profiles.write(
          before.publicView.defaults.provider,
          before.publicView.defaults.model,
          prior.revision,
        );
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
            {
              keyPath: "model_reasoning_effort",
              value:
                compatibleDefaultEffort(
                  selectedModel,
                  before.publicView.defaults.effort,
                ) || null,
              mergeStrategy: "replace",
            },
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
      if (
        (p.runtimeRevision !== undefined || session.pending) &&
        ((p.runtimeRevision !== undefined &&
          p.runtimeRevision !== session.revision) ||
          (p.model !== undefined && p.model !== session.model) ||
          (p.effort !== undefined && p.effort !== session.effort))
      )
        throw new PublicError("会话配置已变化，请重新读取后发送");
      config.runtime?.threadConfig(session.provider, providerConfigRevision);
      if (p.provider && p.provider !== session.provider)
        throw new PublicError("会话网关已变化，请重新读取后发送");
      return {
        provider: session.provider,
        model: p.model || session.model || undefined,
        effort: p.effort || session.effort || undefined,
        approval: session.approval,
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
      const model =
        p.model ||
        snapshot.values.profiles?.[profile(selectedProvider)]?.model ||
        (selectedProvider === snapshot.values.model_provider
          ? snapshot.values.model
          : undefined) ||
        undefined;
      return {
        provider: selectedProvider,
        model,
        effort:
          p.effort ||
          (await implicitEffort(
            selectedProvider,
            model,
            selectedProvider === snapshot.values.model_provider &&
              model === snapshot.values.model
              ? snapshot.values.model_reasoning_effort
              : undefined,
          )),
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
    const model =
      p.model ||
      profileDefaults?.model ||
      (selectedProvider === snapshot.publicView.defaults.provider
        ? snapshot.publicView.defaults.model
        : undefined) ||
      undefined;
    return {
      provider: selectedProvider,
      model,
      effort:
        p.effort ||
        (await implicitEffort(
          selectedProvider || "openai",
          model,
          selectedProvider === snapshot.publicView.defaults.provider &&
            model === snapshot.publicView.defaults.model
            ? snapshot.publicView.defaults.effort
            : undefined,
        )),
      approval: p.approval || "ask",
    };
  }
  return {
    get,
    applied,
    apply,
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
