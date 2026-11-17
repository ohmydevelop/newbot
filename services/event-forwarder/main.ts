import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { eventForwarder } from "../../packages/event-bridge/forwarder.js";
const config = z
  .object({
    directory: z.string(),
    source: z.string(),
    server: z.object({
      command: z.string(),
      args: z.array(z.string()),
      envKeys: z.array(z.string()).default([]),
    }),
    event: z.string(),
    arguments: z.record(z.string(), z.unknown()),
    relay: z.object({
      url: z.string().url(),
      token: z.string().min(1),
      caCertificate: z.string().optional(),
    }),
  })
  .parse(JSON.parse(await readFile(process.argv[2], "utf8")));
const bridge = await eventForwarder({
  ...config,
  server: {
    command: config.server.command,
    args: config.server.args,
    env: Object.fromEntries(
      config.server.envKeys.map((key) => [key, process.env[key] || ""]),
    ),
  },
});
const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => stop.abort());
console.log(JSON.stringify({ state: "ready", event: config.event }));
try {
  while (!stop.signal.aborted) {
    let delay = 60000;
    try {
      const result = await bridge.tick();
      delay = result.nextPollMs;
      console.log(
        JSON.stringify({
          state: "poll",
          ...result,
          at: new Date().toISOString(),
        }),
      );
    } catch (error) {
      const failure = error as { code?: string; retryAfterMs?: number };
      console.error(
        JSON.stringify({
          state: "error",
          code: failure.code || "retry",
          at: new Date().toISOString(),
        }),
      );
      if (
        ["auth_required", "gap", "conflict", "capacity"].includes(
          failure.code || "",
        )
      )
        throw error;
      delay = Math.max(10000, failure.retryAfterMs || 60000);
    }
    await sleep(delay, undefined, { signal: stop.signal }).catch(() => {});
  }
} finally {
  await bridge.close();
}
