import { z } from "zod";
export const RUNNER_PROTOCOL = 1;
export const RUNNER_PACKET_BYTES = 8 * 1024 * 1024;
export const RUNNER_LEASE_MS = 30_000;
export const runnerMethods = [
  "model/list",
  "thread/start",
  "thread/resume",
  "thread/read",
  "thread/list",
  "thread/turns/list",
  "thread/items/list",
  "thread/name/set",
  "thread/archive",
  "thread/unsubscribe",
  "turn/start",
  "turn/interrupt",
  "turn/settings/update",
  "thread/settings/update",
  "mcpServerStatus/list",
  "mcpServer/resource/read",
  "mcpServer/tool/call",
  "runner/approval",
  "runner/toolResult",
] as const;
export const runnerScope = z.union([z.literal("runtime"), z.string().uuid()]);
export const runnerGrant = z
  .object({
    scope: runnerScope,
    revision: z.number().int().nonnegative().safe(),
  })
  .strict();
export const runnerCommand = z
  .object({
    id: z.string().uuid(),
    nodeId: z.string().uuid(),
    epoch: z.number().int().positive().safe(),
    scope: runnerScope,
    revision: z.number().int().nonnegative().safe(),
    method: z.enum(runnerMethods),
    params: z.record(z.string(), z.unknown()),
    ephemeral: z.boolean(),
  })
  .strict();
export const runnerEvent = z
  .object({
    seq: z.number().int().positive().safe(),
    epoch: z.number().int().positive().safe(),
    kind: z.enum(["receipt", "notification", "request", "runtime"]),
    commandId: z.string().uuid().nullable(),
    scope: runnerScope,
    body: z.unknown(),
  })
  .strict();
export type RunnerCommand = z.infer<typeof runnerCommand>;
export type RunnerGrant = z.infer<typeof runnerGrant>;
export type RunnerEvent = z.infer<typeof runnerEvent>;
export type RunnerReceipt = {
  id: string;
  state: "accepted" | "dispatching" | "completed" | "unknown" | "rejected";
  result?: unknown;
};
export const runtimeMethods = new Set<string>([
  "model/list",
  "thread/list",
  "mcpServerStatus/list",
]);
export function canonicalPacket(value: unknown): string {
  const text = JSON.stringify(value);
  if (text === undefined || Buffer.byteLength(text) > RUNNER_PACKET_BYTES)
    throw new Error("执行节点消息超过大小限制");
  const stable = (v: any): any =>
    Array.isArray(v)
      ? v.map(stable)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, stable(v[k])]),
          )
        : v;
  return JSON.stringify(stable(JSON.parse(text)));
}
