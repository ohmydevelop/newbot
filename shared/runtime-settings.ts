export type InteractionMode = "chat" | "plan" | "work";
export const modeLabels: Record<InteractionMode, string> = {
  chat: "聊天",
  plan: "规划",
  work: "工作",
};
export const modeDescriptions: Record<InteractionMode, string> = {
  chat: "回答问题，查询已允许的只读资料",
  plan: "只读调查，制定方案",
  work: "按执行权限完成任务",
};
export function interactionMode(value: unknown): InteractionMode {
  if (value === undefined) return "work";
  if (value === "chat" || value === "plan" || value === "work") return value;
  throw new Error("无效的会话模式");
}
export type ApprovalPreset = "ask" | "review" | "full";
export type RuntimeConfiguration = {
  revision: number;
  provider: string;
  model: string;
  effort: string;
  approval: ApprovalPreset;
  mode?: InteractionMode;
};
export type SessionRuntime = RuntimeConfiguration & {
  version?: number;
  applied?: RuntimeConfiguration;
  pending?: {
    state: "pending" | "applying" | "accepted" | "unknown" | "failed";
    error?: string;
  };
};
export function runtimeIsNewer(next: SessionRuntime, prior?: SessionRuntime) {
  return (
    (next.version ?? next.revision) >= (prior?.version ?? prior?.revision ?? 0)
  );
}
export const approvalLabels: Record<ApprovalPreset, string> = {
  ask: "请求批准",
  review: "帮我批准",
  full: "完全访问权限",
};
// Only implicit defaults may be normalized. Explicit choices still require validation.
export function compatibleDefaultEffort(
  model:
    | {
        supportedReasoningEfforts?: { reasoningEffort: string }[];
        defaultReasoningEffort?: string | null;
      }
    | undefined,
  preferred?: string | null,
) {
  const supported = model?.supportedReasoningEfforts || [];
  return [preferred, model?.defaultReasoningEffort].find(
    (value): value is string =>
      !!value && supported.some((e) => e.reasoningEffort === value),
  );
}
export function approvalParameters(preset: ApprovalPreset, cwd: string) {
  return {
    approvalPolicy:
      preset === "full" ? ("never" as const) : ("on-request" as const),
    approvalsReviewer:
      preset === "review" ? ("auto_review" as const) : ("user" as const),
    sandbox:
      preset === "full"
        ? ("danger-full-access" as const)
        : ("workspace-write" as const),
    sandboxPolicy:
      preset === "full"
        ? { type: "dangerFullAccess" as const }
        : {
            type: "workspaceWrite" as const,
            writableRoots: [cwd],
            networkAccess: false,
            excludeTmpdirEnvVar: true,
            excludeSlashTmp: true,
          },
  };
}

export function executionParameters(
  mode: InteractionMode,
  preset: ApprovalPreset,
  cwd: string,
) {
  if (mode === "work") return approvalParameters(preset, cwd);
  return {
    approvalPolicy: "never" as const,
    approvalsReviewer: "user" as const,
    sandbox: "read-only" as const,
    sandboxPolicy: { type: "readOnly" as const, networkAccess: false },
  };
}
