export type AppIssueCode =
  | "expired"
  | "unavailable"
  | "history"
  | "resource"
  | "runtime"
  | "busy"
  | "permission"
  | "limit"
  | "approval_expired";
export type AppIssue = { code: AppIssueCode };
export function appIssue(value: unknown): AppIssue | null {
  if (!value || typeof value !== "object") return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" &&
    [
      "expired",
      "unavailable",
      "history",
      "resource",
      "runtime",
      "busy",
      "permission",
      "limit",
      "approval_expired",
    ].includes(code)
    ? { code: code as AppIssueCode }
    : null;
}
export type AppSource = {
  threadId: string;
  turnId?: string;
  itemId: string;
  server: string;
  tool: string;
};
