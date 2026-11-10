import { PublicError } from "./public-error.js";
import {
  credentialPending,
  type CredentialCreate,
  type CredentialTicket,
} from "../shared/credentials.js";
import { isUtf8 } from "node:buffer";
export class CredentialFailure extends PublicError {
  constructor(
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}
export type CredentialConsumer = {
  receiver: string;
  targetId?: string;
  run(
    secret: Buffer,
    signal: AbortSignal,
    authorized: () => boolean,
    commit: () => void,
  ): Promise<{
    state: "succeeded" | "failed";
    reason?: CredentialTicket["reason"];
    applied?: boolean;
    passwordUsed?: boolean;
  }>;
};
// Consumers are server-owned closures. No API returns a secret or accepts a
// consumer identity, recipient URL, command, callback, headers, or code.
export function credentialBroker(options: {
  prepare(input: CredentialCreate): Promise<CredentialConsumer>;
  validOwner(owner: string): boolean;
  audit(id: string, state: CredentialTicket["state"]): void;
  ttlMs?: number;
  maxRecords?: number;
}) {
  type Entry = {
    owner: string;
    fingerprint: string;
    ticket: CredentialTicket;
    controller: AbortController;
    consumer?: CredentialConsumer;
    secret?: Buffer;
    committed?: boolean;
    ready?: Promise<void>;
    touched: number;
  };
  const entries = new Map<string, Entry>();
  let closed = false;
  const ttl = Math.min(options.ttlMs || 120_000, 120_000);
  const audit = (entry: Entry) => {
    try {
      options.audit(entry.ticket.id, entry.ticket.state);
    } catch {
      /* Never export storage errors or payloads. */
    }
  };
  function finish(entry: Entry, state: CredentialTicket["state"]) {
    entry.ticket.state = state;
    entry.touched = Date.now();
    entry.consumer = undefined;
    entry.secret?.fill(0);
    entry.secret = undefined;
    entry.controller.abort();
    audit(entry);
  }
  function sweep() {
    for (const [id, e] of entries) {
      if (credentialPending(e.ticket.state) && !e.committed) {
        if (!options.validOwner(e.owner)) finish(e, "invalidated");
        else if (e.ticket.expiresAt <= Date.now()) finish(e, "expired");
      } else if (e.touched + 600_000 <= Date.now()) entries.delete(id);
    }
  }
  const timer = setInterval(sweep, 1000);
  timer.unref();
  function entry(id: string, owner: string) {
    if (closed) throw new CredentialFailure("私密通道已关闭", 503);
    sweep();
    const e = entries.get(id);
    if (!e) throw new CredentialFailure("私密请求不存在或已结束", 404);
    if (e.owner !== owner || !options.validOwner(owner))
      throw new CredentialFailure("私密请求不属于当前登录", 403);
    return e;
  }
  async function create(owner: string, input: CredentialCreate) {
    if (closed) throw new CredentialFailure("私密通道已关闭", 503);
    sweep();
    if (!options.validOwner(owner))
      throw new CredentialFailure("请先登录", 401);
    const fingerprint = JSON.stringify(input),
      prior = entries.get(input.requestId);
    if (prior) {
      const e = entry(input.requestId, owner);
      if (e.fingerprint !== fingerprint)
        throw new CredentialFailure("请勿复用私密请求标识");
      await e.ready;
      return structuredClone(e.ticket);
    }
    if (
      entries.size >= (options.maxRecords || 128) ||
      [...entries.values()].filter((e) => credentialPending(e.ticket.state))
        .length >= 16 ||
      [...entries.values()].filter(
        (e) => e.owner === owner && credentialPending(e.ticket.state),
      ).length >= 4
    )
      throw new CredentialFailure("私密请求已满，请先完成或取消现有请求", 429);
    const e: Entry = {
      owner,
      fingerprint,
      controller: new AbortController(),
      touched: Date.now(),
      ticket: {
        id: input.requestId,
        operation: input.operation,
        ...(input.operation === "provider.models.test"
          ? { providerId: input.providerId }
          : input.operation === "credential.save"
            ? {
                scope: input.scope,
                targetId: input.targetId,
                retention: input.retention,
              }
            : {}),
        expiresAt: Date.now() + ttl,
        state: "preparing",
      },
    };
    entries.set(input.requestId, e);
    e.ready = (async () => {
      try {
        const consumer = await options.prepare(input);
        sweep();
        if (e.ticket.state !== "preparing") return;
        e.consumer = consumer;
        if (consumer.targetId) e.ticket.targetId = consumer.targetId;
        e.ticket.receiver = consumer.receiver;
        e.ticket.state = "waiting";
        audit(e);
      } catch {
        if (e.ticket.state === "preparing") {
          e.ticket.reason = "configuration_changed";
          finish(e, "failed");
        }
      }
    })();
    await e.ready;
    return structuredClone(e.ticket);
  }
  async function fulfill(id: string, owner: string, secret: Buffer) {
    try {
      const e = entry(id, owner);
      if (e.ticket.state !== "waiting" || !e.consumer)
        throw new CredentialFailure("私密请求已处理或已失效，请重新读取状态");
      const password = e.ticket.operation === "sudo.identity";
      if (
        !secret.length ||
        secret.length > (password ? 1024 : 4096) ||
        (password
          ? !isUtf8(secret) ||
            secret.some((byte) => byte === 0 || byte === 10 || byte === 13)
          : secret.some((byte) => byte < 0x21 || byte > 0x7e))
      )
        throw new CredentialFailure(
          password
            ? "密码格式无效，请使用不含换行或空字符的 UTF-8 密码"
            : "凭证格式无效，请填写不含空格或换行的凭证",
          400,
        );
      const consumer = e.consumer;
      e.consumer = undefined;
      // Consume before any asynchronous work. Failed or lost outcomes never
      // make this ticket usable a second time.
      e.secret = secret;
      e.ticket.state = "checking";
      audit(e);
      const authorized = () =>
        e.ticket.state === "checking" &&
        !e.controller.signal.aborted &&
        options.validOwner(owner) &&
        e.ticket.expiresAt > Date.now();
      try {
        const result = await consumer.run(
          secret,
          e.controller.signal,
          authorized,
          () => {
            if (!authorized()) throw new CredentialFailure("私密请求已失效");
            e.committed = true;
            e.ticket.committed = true;
            e.secret?.fill(0);
          },
        );
        sweep();
        if (e.ticket.state === "checking") {
          // Preserve a closed output vocabulary even if a future consumer
          // accidentally returns an upstream diagnostic as its reason.
          e.ticket.reason =
            result.reason === undefined
              ? undefined
              : [
                    "rejected",
                    "redirect",
                    "unavailable",
                    "configuration_changed",
                    "save_unconfirmed",
                  ].includes(result.reason)
                ? result.reason
                : "unavailable";
          e.ticket.applied =
            typeof result.applied === "boolean" ? result.applied : undefined;
          e.ticket.passwordUsed =
            typeof result.passwordUsed === "boolean"
              ? result.passwordUsed
              : undefined;
          finish(e, result.state === "succeeded" ? "succeeded" : "failed");
        }
      } catch {
        if (e.ticket.state === "checking") {
          e.ticket.reason = "unavailable";
          finish(e, "failed");
        }
      }
      return structuredClone(e.ticket);
    } finally {
      secret.fill(0);
    }
  }
  return {
    create,
    fulfill,
    read(id: string, owner: string) {
      return structuredClone(entry(id, owner).ticket);
    },
    cancel(id: string, owner: string) {
      const e = entry(id, owner);
      if (credentialPending(e.ticket.state) && !e.committed)
        finish(e, "cancelled");
      return structuredClone(e.ticket);
    },
    revoke(owner?: string) {
      for (const e of entries.values())
        if (
          (!owner || e.owner === owner) &&
          credentialPending(e.ticket.state) &&
          !e.committed
        )
          finish(e, "invalidated");
    },
    get pending() {
      sweep();
      return [...entries.values()].filter((e) =>
        credentialPending(e.ticket.state),
      ).length;
    },
    close() {
      closed = true;
      clearInterval(timer);
      for (const e of entries.values()) {
        if (credentialPending(e.ticket.state)) finish(e, "invalidated");
      }
      entries.clear();
    },
  };
}
