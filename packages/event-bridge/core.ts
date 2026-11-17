import { createHash } from "node:crypto";
export type FailureCode =
  | "retry"
  | "auth_required"
  | "gap"
  | "capacity"
  | "conflict";
export class SourceFailure extends Error {
  constructor(
    public code: FailureCode,
    public retryAfterMs = 1000,
  ) {
    super(code);
  }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");

export function eventFailure(error: unknown): SourceFailure {
  if (error instanceof SourceFailure) return error;
  const remote = error as { code?: number; data?: Record<string, unknown> };
  const code = remote?.data?.["io.newbot/failure"];
  if (
    remote?.code === -32000 &&
    typeof code === "string" &&
    ["retry", "auth_required", "gap", "capacity", "conflict"].includes(code)
  )
    return new SourceFailure(
      code as FailureCode,
      Math.max(
        1000,
        Math.min(3600000, Number(remote.data?.retryAfterMs) || 1000),
      ),
    );
  return new SourceFailure(
    remote?.code === -32024
      ? "auth_required"
      : remote?.code === -32025
        ? "capacity"
        : [-32601, -32602, -32023, -32026].includes(remote?.code || 0)
          ? "conflict"
          : "retry",
  );
}
