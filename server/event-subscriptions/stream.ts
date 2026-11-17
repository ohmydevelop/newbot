import { randomUUID } from "node:crypto";
import { z } from "zod";
import { occurrence } from "../../packages/event-bridge/protocol.js";
import { SourceFailure } from "./contracts.js";
import type { EventPeer } from "./connection.js";
type Frame = { cursor: string | null; event?: z.infer<typeof occurrence> };
export class EventStream {
  private frames: Frame[] = [];
  private active = false;
  private initial: string | null = null;
  private failure: SourceFailure | undefined;
  private receipt: { id: string; count: number } | undefined;
  private notify: (() => void) | undefined;
  private handle: ReturnType<NonNullable<EventPeer["stream"]>>;
  private heartbeat = Date.now();
  constructor(peer: EventPeer, params: Record<string, unknown>) {
    if (!peer.stream) throw new SourceFailure("conflict");
    this.handle = peer.stream(params, (kind, value) => {
      try {
        this.heartbeat = Date.now();
        if (kind === "error") return;
        if (kind === "terminated") throw new SourceFailure("auth_required");
        if (!["active", "heartbeat", "event"].includes(kind))
          throw new SourceFailure("conflict");
        const frame = z
          .object({
            cursor: z.string().max(2048).nullable().default(null),
            truncated: z.boolean().optional(),
          })
          .parse(value);
        if (frame.truncated) throw new SourceFailure("gap");
        if (kind === "active") {
          if (this.active) throw new SourceFailure("gap");
          this.active = true;
          this.initial = frame.cursor;
        } else {
          if (!this.active) throw new SourceFailure("conflict");
          if (
            kind === "heartbeat" &&
            !this.frames.at(-1)?.event &&
            this.frames.length > (this.receipt?.count || 0)
          )
            this.frames.pop();
          if (this.frames.length >= 128) throw new SourceFailure("capacity");
          this.frames.push({
            cursor: frame.cursor,
            ...(kind === "event" ? { event: occurrence.parse(value) } : {}),
          });
        }
      } catch (error) {
        this.failure =
          error instanceof SourceFailure
            ? error
            : new SourceFailure("conflict");
        this.handle?.stop();
      }
      this.notify?.();
    });
    this.handle.done
      .catch(() => {})
      .finally(() => {
        this.failure ||= new SourceFailure("retry");
        this.notify?.();
      });
  }
  async read(baseline: boolean, signal: AbortSignal) {
    if (!this.active && !this.failure)
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          this.notify = undefined;
          reject(signal.reason);
        };
        this.notify = () => {
          signal.removeEventListener("abort", abort);
          this.notify = undefined;
          resolve();
        };
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
      });
    if (this.failure) throw this.failure;
    if (Date.now() - this.heartbeat > 90000) {
      this.handle.stop();
      throw new SourceFailure("retry");
    }
    if (baseline) return { cursor: this.initial, events: [] };
    if (!this.frames.length)
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(done, 500);
        const abort = () => {
          clearTimeout(timer);
          this.notify = undefined;
          reject(signal.reason);
        };
        const cleanup = () => {
          this.notify = undefined;
        };
        function done() {
          cleanup();
          signal.removeEventListener("abort", abort);
          resolve();
        }
        this.notify = () => {
          clearTimeout(timer);
          this.notify = undefined;
          done();
        };
        if (signal.aborted) return abort();
        signal.addEventListener("abort", abort, { once: true });
      });
    if (this.failure) throw this.failure;
    if (!this.frames.length) return { cursor: undefined, events: [] };
    const frames = this.frames.slice(0, this.receipt?.count ?? 32),
      receipt = this.receipt || {
        id: "stream:" + randomUUID(),
        count: frames.length,
      };
    this.receipt = receipt;
    return {
      cursor: frames.at(-1)!.cursor,
      events: frames.flatMap((f) => (f.event ? [f.event] : [])),
      receipt: receipt.id,
    };
  }
  acknowledge(receipt: string) {
    if (receipt === this.receipt?.id) {
      this.frames.splice(0, this.receipt.count);
      this.receipt = undefined;
    }
  }
  get failed() {
    return !!this.failure;
  }
  stop() {
    this.handle.stop();
  }
}
