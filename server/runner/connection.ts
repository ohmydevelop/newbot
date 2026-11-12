import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { RunnerLedger } from "./ledger.js";
import {
  runnerCommand,
  runnerGrant,
  RUNNER_PACKET_BYTES,
  RUNNER_PROTOCOL,
  type RunnerCommand,
} from "../../shared/runner-control.js";
import { PublicError } from "../public-error.js";
const reply = z
  .object({
    epoch: z.number().int().positive().safe(),
    leaseMs: z.number().int().min(1000).max(60000),
    ack: z.number().int().nonnegative().safe(),
    grants: z.array(runnerGrant).max(4096),
    commands: z.array(runnerCommand).max(16).optional(),
    protocol: z.literal(RUNNER_PROTOCOL).optional(),
  })
  .strict();
class ConnectionRejected extends PublicError {}
class ConnectionRetry extends PublicError {}
export function runnerServerUrl(value: string, allowLocalHttp = false) {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        allowLocalHttp &&
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ))
  )
    throw new PublicError(
      "执行节点需要HTTPS Server地址；开发模式仅允许本机HTTP",
    );
  return url.origin;
}
export async function runRunnerConnection(options: {
  server: string;
  token: string;
  fingerprint: string;
  ledger: RunnerLedger;
  signal: AbortSignal;
  allowLocalHttp?: boolean;
  pollMs?: number;
  start?: () => Promise<void>;
  stop: () => Promise<void>;
  perform: (command: RunnerCommand) => Promise<unknown>;
  onReady?: () => void;
  health?: () => void;
}) {
  const origin = runnerServerUrl(options.server, options.allowLocalHttp),
    bootId = randomUUID(),
    ledger = options.ledger;
  let epoch = 0,
    deadline = 0,
    fatal: unknown,
    stopping: Promise<void> | undefined;
  const active = new Map<string, Promise<unknown>>();
  const stop = () => (stopping ||= options.stop());
  const request = async (path: string, body: unknown) => {
    let res: Response;
    try {
      res = await fetch(origin + "/api/runner/" + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + options.token,
          "X-Newbot-Node": ledger.nodeId,
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      throw new ConnectionRetry("执行节点网络连接暂不可用");
    }
    if ([401, 403, 409].includes(res.status)) {
      await res.body?.cancel();
      throw new ConnectionRejected("执行节点认证、版本或租约被拒绝");
    }
    if (
      !res.ok ||
      !res.headers.get("content-type")?.includes("application/json")
    ) {
      await res.body?.cancel();
      throw new ConnectionRetry("执行节点暂时无法同步");
    }
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (res.body) {
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > RUNNER_PACKET_BYTES + 65536) {
            await reader.cancel();
            throw new ConnectionRejected("节点响应超过协议限制");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new ConnectionRejected("节点响应不是有效协议数据");
    }
  };
  const adopt = (value: unknown, started: number) => {
    const r = reply.parse(value);
    if (epoch && r.epoch !== epoch)
      throw new ConnectionRejected("节点代次发生变化，必须重新启动受管运行时");
    epoch = r.epoch;
    deadline = started + r.leaseMs;
    if (performance.now() >= deadline)
      throw new ConnectionRejected("节点租约响应已过期");
    ledger.activate(epoch, r.grants);
    ledger.acknowledge(r.ack);
    return r;
  };
  let watch: ReturnType<typeof setInterval> | undefined;
  try {
    while (!options.signal.aborted) {
      try {
        const started = performance.now();
        adopt(
          await request("connect", {
            protocol: RUNNER_PROTOCOL,
            bootId,
            fingerprint: options.fingerprint,
          }),
          started,
        );
        break;
      } catch (error) {
        if (!(error instanceof ConnectionRetry)) throw error;
        try {
          await sleep(500, undefined, { signal: options.signal });
        } catch {}
      }
    }
    if (options.signal.aborted) return;
    watch = setInterval(() => {
      if (deadline && performance.now() >= deadline && !fatal) {
        fatal = new PublicError(
          "节点租约已到期，停止受管运行时并保留未确认回执",
        );
        void stop().catch((e) => {
          fatal = e;
        });
      }
    }, 100);
    await options.start?.();
    if (fatal) throw fatal;
    options.onReady?.();
    while (!options.signal.aborted && !fatal) {
      try {
        options.health?.();
        const began = performance.now(),
          r = adopt(
            await request("exchange", {
              bootId,
              epoch,
              events: ledger.events(),
            }),
            began,
          );
        if (
          fatal ||
          stopping ||
          performance.now() >= deadline ||
          options.signal.aborted
        )
          break;
        for (const command of r.commands || []) {
          if (active.has(command.id)) continue;
          try {
            const operation = ledger.execute(command, options.perform);
            active.set(command.id, operation);
            void operation
              .catch((e) => {
                fatal = e;
                void stop().catch(() => {});
              })
              .finally(() => active.delete(command.id));
          } catch (e) {
            if (e instanceof PublicError && /归属|修订/.test(e.message))
              ledger.reject(command);
            else throw e;
          }
        }
      } catch (e) {
        if (!(e instanceof ConnectionRetry)) {
          fatal = e;
          break;
        }
        if (performance.now() >= deadline) {
          fatal = e;
          break;
        }
      }
      try {
        await sleep(Math.max(50, options.pollMs || 500), undefined, {
          signal: options.signal,
        });
      } catch {}
    }
    if (fatal) throw fatal;
  } finally {
    if (watch) clearInterval(watch);
    await stop();
    await Promise.allSettled([...active.values()]);
    // A bounded graceful drain. On failure the encrypted outbox stays for the next boot.
    try {
      for (let i = 0; i < 64 && epoch && performance.now() < deadline; i++) {
        const events = ledger.events();
        if (!events.length) break;
        const began = performance.now();
        adopt(
          await request("exchange", { bootId, epoch, events, drain: true }),
          began,
        );
      }
      if (epoch) await request("release", { bootId, epoch });
    } catch {}
  }
}
