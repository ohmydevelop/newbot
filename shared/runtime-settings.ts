export type ApprovalPreset = "ask" | "review" | "full";
export type SessionRuntime = {
  revision: number;
  provider: string;
  model: string;
  effort: string;
  approval: ApprovalPreset;
};
export const approvalLabels: Record<ApprovalPreset, string> = {
  ask: "请求批准",
  review: "帮我批准",
  full: "完全访问权限",
};
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
