export type ActivityState =
  | "idle"
  | "preparing"
  | "running"
  | "waiting"
  | "completed"
  | "failed"
  | "interrupted"
  | "unknown";
export type ThreadActivity = {
  state: ActivityState;
  turnId: string | null;
  revision: number;
  updated: number;
  seenRevision: number;
  waiting?: WaitingSummary;
};
export type WaitingSummary = {
  reason: "approval" | "input" | "mixed";
  count: number;
  target: { kind: "approval" | "a2ui"; id: string };
};
export function waitingLabel(waiting?: WaitingSummary) {
  return waiting?.reason === "approval"
    ? "需要批准"
    : waiting?.reason === "input"
      ? "需要输入"
      : "需要处理";
}
export const activityLabels: Record<ActivityState, string> = {
  idle: "尚未开始",
  preparing: "正在准备",
  running: "正在运行",
  waiting: "等待处理",
  completed: "已完成",
  failed: "执行失败",
  interrupted: "已停止",
  unknown: "状态待确认",
};
