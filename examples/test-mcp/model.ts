import { z } from "zod";
export const resourceUri = "ui://newbot-test/metrics.html";
export const inputSchema = z.object({
  server_id: z.enum(["node-a", "node-b", "node-c"]).default("node-a"),
  range: z.enum(["15m", "1h", "6h"]).default("1h"),
});
export const sampleSchema = z.object({
  at: z.string(),
  cpu: z.number().min(0).max(100),
  memory: z.number().min(0).max(100),
  disk: z.number().min(0).max(100),
});
export const outputSchema = z.object({
  simulation: z.literal(true),
  server_id: z.enum(["node-a", "node-b", "node-c"]),
  range: z.enum(["15m", "1h", "6h"]),
  generated_at: z.string(),
  refresh_id: z.number().int(),
  samples: z.array(sampleSchema).length(24),
  summary: z.object({ cpu: z.number(), memory: z.number(), disk: z.number() }),
});
export type Metrics = z.infer<typeof outputSchema>;
export type MetricsInput = z.infer<typeof inputSchema>;
export function createMetrics(
  input: MetricsInput,
  refreshId: number,
  now = Date.now(),
): Metrics {
  const minutes = { "15m": 15, "1h": 60, "6h": 360 }[input.range];
  const offset = ["node-a", "node-b", "node-c"].indexOf(input.server_id) * 13;
  const samples = Array.from({ length: 24 }, (_, i) => {
    const wave = Math.sin((i + offset + refreshId) / 3);
    const at = new Date(now - ((23 - i) / 23) * minutes * 60000).toISOString();
    return {
      at,
      cpu: Math.round(
        39 + offset / 2 + wave * 19 + Math.cos(i * 1.7 + refreshId) * 7,
      ),
      memory: Math.round(58 + offset / 3 + Math.sin((i + refreshId) / 7) * 9),
      disk: Math.round(32 + offset + Math.cos((i + refreshId) / 8) * 3),
    };
  });
  const latest = samples.at(-1)!;
  return {
    simulation: true,
    ...input,
    generated_at: new Date(now).toISOString(),
    refresh_id: refreshId,
    samples,
    summary: { cpu: latest.cpu, memory: latest.memory, disk: latest.disk },
  };
}
