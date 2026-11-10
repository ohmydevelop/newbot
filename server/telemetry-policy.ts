import { createHash } from "node:crypto";
const operations = new Set([
  "bridge.config.read",
  "bridge.agent.run",
  "bridge.agent.action",
  "bridge.credentials.consume",
]);
export const traceOperation = (name: string) =>
  operations.has(name) ? name : "bridge.operation";
export const traceIdentifier = (id: string) =>
  "sha256:" + createHash("sha256").update(id).digest("hex");
export const traceTurnStatus = (status: string) =>
  ["completed", "failed", "interrupted", "process_stopped"].includes(status)
    ? status
    : "unknown";
export function traceErrorType(error: unknown) {
  return error instanceof TypeError
    ? "TypeError"
    : error instanceof RangeError
      ? "RangeError"
      : error instanceof SyntaxError
        ? "SyntaxError"
        : "Error";
}
