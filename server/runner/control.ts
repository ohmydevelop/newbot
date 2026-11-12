import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import type { Store } from "../db.js";
import { PublicError } from "../public-error.js";
import { PacketCipher } from "./packets.js";
import {
  runnerCommand,
  runnerEvent,
  runnerGrant,
  canonicalPacket,
  RUNNER_PROTOCOL,
  RUNNER_LEASE_MS,
  type RunnerCommand,
  type RunnerEvent,
} from "../../shared/runner-control.js";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type NodeRow = {
  id: string;
  name: string;
  token_hash: string;
  expected_fingerprint: string;
  epoch: number;
  boot_id: string | null;
  lease_until: number;
  revoked: number;
  stopped: number;
  ack: number;
};
type CommandRow = {
  id: string;
  node_id: string;
  epoch: number;
  scope: string;
  revision: number;
  fingerprint: string;
  state: string;
  payload: string | null;
  ephemeral: number;
  reply: string | null;
  created: number;
};
const privateMethods = new Set([
  "thread/start",
  "thread/resume",
  "turn/settings/update",
  "thread/settings/update",
  "runner/approval",
  "runner/toolResult",
  "mcpServer/tool/call",
]);
export class RunnerControl {
  readonly cipher: PacketCipher;
  private temporary = new Map<string, RunnerCommand>();
  constructor(
    readonly db: Store,
    readonly now: () => number = Date.now,
  ) {
    db.raw.exec("PRAGMA synchronous=FULL");
    const existing = !!db.raw
      .prepare(
        "SELECT 1 FROM runner_commands UNION ALL SELECT 1 FROM runner_inbox LIMIT 1",
      )
      .get();
    this.cipher = new PacketCipher(
      join(db.directory, "runner-control"),
      existing,
    );
    db.raw.exec(
      "UPDATE runner_commands SET state=CASE WHEN state='queued' THEN 'expired' ELSE 'unknown' END WHERE ephemeral=1 AND state IN ('queued','sent')",
    );
  }
  enroll(name: string, expectedFingerprint: string) {
    z.string().trim().min(1).max(80).parse(name);
    z.string()
      .regex(/^[a-f0-9]{64}$/)
      .parse(expectedFingerprint);
    const id = randomUUID(),
      token = randomBytes(32).toString("base64url");
    this.db.raw
      .prepare(
        "INSERT INTO runner_nodes(id,name,token_hash,expected_fingerprint) VALUES(?,?,?,?)",
      )
      .run(id, name, hash(token), expectedFingerprint);
    this.grant(id, "runtime", 0);
    this.db.audit("runner/enroll", id, "allowed");
    return { id, token, protocol: RUNNER_PROTOCOL };
  }
  nodes() {
    return this.db.raw
      .prepare(
        "SELECT id,name,expected_fingerprint,epoch,lease_until,revoked,stopped,ack FROM runner_nodes",
      )
      .all();
  }
  private node(id: string, allowRevoked = false) {
    const n = this.db.raw
      .prepare("SELECT * FROM runner_nodes WHERE id=?")
      .get(id) as NodeRow | undefined;
    if (!n || (n.revoked && !allowRevoked))
      throw new PublicError("执行节点身份已失效");
    return n;
  }
  authenticate(id: string, token: string, allowRevoked = false) {
    const n = this.node(id, allowRevoked),
      actual = Buffer.from(hash(token), "hex"),
      expected = Buffer.from(n.token_hash, "hex");
    if (
      token.length > 256 ||
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new PublicError("执行节点身份验证失败");
    return n;
  }
  revoke(id: string) {
    this.node(id);
    this.db.raw.exec("BEGIN IMMEDIATE");
    try {
      this.db.raw
        .prepare("UPDATE runner_nodes SET revoked=1,lease_until=0 WHERE id=?")
        .run(id);
      this.db.raw
        .prepare(
          "UPDATE runner_commands SET state=CASE WHEN state='queued' THEN 'obsolete' ELSE 'unknown' END,payload=NULL WHERE node_id=? AND state IN ('queued','sent')",
        )
        .run(id);
      this.db.raw.exec("COMMIT");
    } catch (e) {
      this.db.raw.exec("ROLLBACK");
      throw e;
    }
    for (const [key, c] of this.temporary)
      if (c.nodeId === id) this.temporary.delete(key);
    this.db.audit("runner/revoke", id, "allowed");
  }
  grant(nodeId: string, scope: string, revision: number) {
    this.node(nodeId);
    runnerGrant.parse({ scope, revision });
    const previous = this.db.raw
      .prepare("SELECT revision FROM runner_grants WHERE node_id=? AND scope=?")
      .get(nodeId, scope) as { revision: number } | undefined;
    if (previous && revision < previous.revision)
      throw new PublicError("工作区配置修订不能回退");
    if (scope !== "runtime") {
      const maximum = this.db.raw
        .prepare("SELECT max(revision) n FROM runner_grants WHERE scope=?")
        .get(scope) as { n: number | null };
      if (maximum.n != null && revision < maximum.n)
        throw new PublicError("工作区配置修订不能回退");
    }
    const other = this.db.raw
      .prepare(
        "SELECT 1 FROM runner_grants g JOIN runner_nodes n ON n.id=g.node_id WHERE g.scope=? AND g.node_id<>? AND g.enabled=1 AND n.stopped=0",
      )
      .get(scope, nodeId);
    if (scope !== "runtime" && other)
      throw new PublicError("工作区仍由其他节点持有，不能并行接管");
    if (scope !== "runtime")
      this.db.raw
        .prepare(
          "UPDATE runner_grants SET enabled=0 WHERE scope=? AND node_id<>?",
        )
        .run(scope, nodeId);
    this.db.raw
      .prepare("INSERT OR REPLACE INTO runner_grants VALUES(?,?,?,1)")
      .run(nodeId, scope, revision);
    this.db.raw
      .prepare(
        "UPDATE runner_commands SET state='obsolete',payload=NULL WHERE node_id=? AND scope=? AND revision<? AND state='queued'",
      )
      .run(nodeId, scope, revision);
  }
  private grants(id: string) {
    return this.db.raw
      .prepare(
        "SELECT scope,revision FROM runner_grants WHERE node_id=? AND enabled=1",
      )
      .all(id) as { scope: string; revision: number }[];
  }
  connect(
    nodeId: string,
    token: string,
    hello: { protocol: number; bootId: string; fingerprint: string },
  ) {
    z.object({
      protocol: z.literal(RUNNER_PROTOCOL),
      bootId: z.string().uuid(),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    })
      .strict()
      .parse(hello);
    const n = this.authenticate(nodeId, token),
      now = this.now();
    if (hello.fingerprint !== n.expected_fingerprint)
      throw new PublicError("执行节点内核与登记版本不匹配");
    if (
      n.boot_id &&
      n.boot_id !== hello.bootId &&
      (!n.stopped || n.lease_until > now)
    )
      throw new PublicError("执行节点旧连接仍持有有效租约或尚未确认停止");
    const epoch =
      n.epoch + (n.boot_id !== hello.bootId || n.lease_until <= now ? 1 : 0);
    this.db.raw.exec("BEGIN IMMEDIATE");
    try {
      if (epoch !== n.epoch) {
        this.db.raw
          .prepare(
            "UPDATE runner_commands SET state='unknown' WHERE node_id=? AND state='sent'",
          )
          .run(nodeId);
        this.db.raw
          .prepare(
            "UPDATE runner_commands SET epoch=? WHERE node_id=? AND state='queued'",
          )
          .run(epoch, nodeId);
      }
      this.db.raw
        .prepare(
          "UPDATE runner_nodes SET boot_id=?,epoch=?,lease_until=?,stopped=0 WHERE id=?",
        )
        .run(hello.bootId, epoch, now + RUNNER_LEASE_MS, nodeId);
      this.db.raw.exec("COMMIT");
    } catch (e) {
      this.db.raw.exec("ROLLBACK");
      throw e;
    }
    return {
      protocol: RUNNER_PROTOCOL,
      epoch,
      leaseMs: RUNNER_LEASE_MS,
      ack: n.ack,
      grants: this.grants(nodeId),
    };
  }
  private row(id: string) {
    return this.db.raw
      .prepare("SELECT * FROM runner_commands WHERE id=?")
      .get(id) as CommandRow | undefined;
  }
  queue(
    input: Omit<RunnerCommand, "epoch" | "ephemeral"> & { ephemeral?: boolean },
  ) {
    const n = this.node(input.nodeId),
      c = runnerCommand.parse({
        ...input,
        epoch: Math.max(1, n.epoch),
        ephemeral: privateMethods.has(input.method) || input.ephemeral === true,
      });
    canonicalPacket(c);
    const { epoch: _, ...identity } = c,
      fingerprint = this.cipher.fingerprint(identity),
      old = this.row(c.id);
    if (old) {
      if (old.fingerprint !== fingerprint)
        throw new PublicError("命令ID已用于不同内容");
      return this.receipt(c.id);
    }
    if (
      !this.grants(c.nodeId).some(
        (g) => g.scope === c.scope && g.revision === c.revision,
      )
    )
      throw new PublicError("工作区归属或配置修订不匹配");
    const pending = (
      this.db.raw
        .prepare(
          "SELECT count(*) n FROM runner_commands WHERE node_id=? AND state IN ('queued','sent')",
        )
        .get(c.nodeId) as { n: number }
    ).n;
    if (pending >= 128) throw new PublicError("节点待执行命令已满");
    const payload = c.ephemeral ? null : this.cipher.seal(c, "command:" + c.id);
    this.db.raw
      .prepare(
        "INSERT INTO runner_commands VALUES(?,?,?,?,?,?,'queued',?,?,NULL,?)",
      )
      .run(
        c.id,
        c.nodeId,
        n.epoch,
        c.scope,
        c.revision,
        fingerprint,
        payload,
        c.ephemeral ? 1 : 0,
        this.now(),
      );
    if (c.ephemeral) this.temporary.set(c.id, c);
    return this.receipt(c.id);
  }
  receipt(id: string) {
    const c = this.row(id);
    if (!c) throw new PublicError("节点命令不存在");
    return {
      id: c.id,
      nodeId: c.node_id,
      scope: c.scope,
      revision: c.revision,
      state: c.state,
      ...(c.reply
        ? { result: this.cipher.open(c.reply, "reply:" + c.id) }
        : {}),
    };
  }
  exchange(
    nodeId: string,
    token: string,
    input: {
      bootId: string;
      epoch: number;
      events: RunnerEvent[];
      drain?: boolean;
    },
  ) {
    const n = this.authenticate(nodeId, token),
      now = this.now();
    if (
      input.epoch !== n.epoch ||
      input.bootId !== n.boot_id ||
      n.lease_until <= now
    )
      throw new PublicError("节点租约已过期");
    if (input.events.length > 64) throw new PublicError("节点事件批次过大");
    canonicalPacket(input.events);
    let ack = n.ack;
    this.db.raw.exec("BEGIN IMMEDIATE");
    try {
      for (const raw of input.events) {
        const e = runnerEvent.parse(raw),
          fingerprint = this.cipher.fingerprint(e);
        if (e.epoch > n.epoch) throw new PublicError("事件来自未知节点代次");
        if (e.seq <= ack) {
          const old = this.db.raw
            .prepare(
              "SELECT fingerprint FROM runner_inbox WHERE node_id=? AND seq=?",
            )
            .get(nodeId, e.seq) as { fingerprint: string } | undefined;
          if (old?.fingerprint !== fingerprint)
            throw new PublicError("重复事件内容不一致");
          continue;
        }
        if (e.seq !== ack + 1)
          throw new PublicError("事件序号不连续，请补传缺失事件");
        if (e.kind === "receipt") {
          const c = e.commandId && this.row(e.commandId);
          if (
            !c ||
            c.node_id !== nodeId ||
            c.scope !== e.scope ||
            c.epoch !== e.epoch
          )
            throw new PublicError("回执与原命令归属不一致");
          const r = z
            .object({
              id: z.literal(c.id),
              state: z.enum(["completed", "unknown", "rejected"]),
              result: z.unknown().optional(),
            })
            .strict()
            .parse(e.body);
          if (c.state === "completed" || c.state === "rejected") {
            const prior = c.reply && this.cipher.open(c.reply, "reply:" + c.id);
            if (!prior || canonicalPacket(prior) !== canonicalPacket(r))
              throw new PublicError("终态回执不能被其他结果覆盖");
          }
          if (["queued", "expired", "obsolete"].includes(c.state))
            throw new PublicError("未派发的命令不能接收执行回执");
          this.db.raw
            .prepare(
              "UPDATE runner_commands SET state=?,reply=?,payload=NULL WHERE id=?",
            )
            .run(r.state, this.cipher.seal(r, "reply:" + c.id), c.id);
        } else if (
          e.scope !== "runtime" &&
          !this.db.raw
            .prepare("SELECT 1 FROM runner_grants WHERE node_id=? AND scope=?")
            .get(nodeId, e.scope)
        )
          throw new PublicError("事件工作区不属于此节点");
        const packet = this.cipher.seal(e, "inbox:" + nodeId + ":" + e.seq);
        const used = (
          this.db.raw
            .prepare(
              "SELECT coalesce(sum(length(packet)),0) bytes FROM runner_inbox WHERE node_id=?",
            )
            .get(nodeId) as { bytes: number }
        ).bytes;
        if (used + packet.length > 256 * 1024 * 1024)
          throw new PublicError(
            "节点事件存储预算已满，暂停接收并保留未确认事件",
          );
        this.db.raw
          .prepare("INSERT INTO runner_inbox VALUES(?,?,?,?,?,?,?,?)")
          .run(
            nodeId,
            e.seq,
            e.epoch,
            e.kind,
            e.commandId,
            e.scope,
            fingerprint,
            packet,
          );
        ack = e.seq;
      }
      this.db.raw
        .prepare("UPDATE runner_nodes SET ack=?,lease_until=? WHERE id=?")
        .run(ack, now + RUNNER_LEASE_MS, nodeId);
      this.db.raw.exec("COMMIT");
    } catch (e) {
      this.db.raw.exec("ROLLBACK");
      throw e;
    }
    // Only after event transaction commit may the Runner release its outbox.
    for (const e of input.events)
      if (e.kind === "receipt" && e.commandId)
        this.temporary.delete(e.commandId);
    const commands: RunnerCommand[] = [];
    if (input.drain)
      return {
        epoch: n.epoch,
        leaseMs: RUNNER_LEASE_MS,
        ack,
        grants: this.grants(nodeId),
        commands,
      };
    const rows = this.db.raw
      .prepare(
        "SELECT * FROM runner_commands WHERE node_id=? AND epoch=? AND state IN ('queued','sent') ORDER BY rowid LIMIT 16",
      )
      .all(nodeId, n.epoch) as CommandRow[];
    let bytes = 0;
    for (const row of rows) {
      const original = row.ephemeral
        ? this.temporary.get(row.id)
        : row.payload
          ? (this.cipher.open(
              row.payload,
              "command:" + row.id,
            ) as RunnerCommand)
          : undefined;
      if (!original) {
        this.db.raw
          .prepare(
            "UPDATE runner_commands SET state=CASE WHEN state='queued' THEN 'expired' ELSE 'unknown' END WHERE id=?",
          )
          .run(row.id);
        continue;
      }
      const c = { ...original, epoch: n.epoch };
      bytes += Buffer.byteLength(canonicalPacket(c));
      if (commands.length && bytes > 4 * 1024 * 1024) break;
      this.db.raw
        .prepare(
          "UPDATE runner_commands SET state='sent' WHERE id=? AND state='queued'",
        )
        .run(row.id);
      commands.push(c);
    }
    return {
      epoch: n.epoch,
      leaseMs: RUNNER_LEASE_MS,
      ack,
      grants: this.grants(nodeId),
      commands,
    };
  }
  release(nodeId: string, token: string, bootId: string, epoch: number) {
    const n = this.authenticate(nodeId, token, true);
    if (n.epoch !== epoch || n.boot_id !== bootId)
      throw new PublicError("节点租约已过期");
    this.db.raw
      .prepare("UPDATE runner_nodes SET lease_until=0,stopped=1 WHERE id=?")
      .run(nodeId);
  }
  events(nodeId: string, after = 0) {
    return this.db.raw
      .prepare(
        "SELECT seq,packet FROM runner_inbox WHERE node_id=? AND seq>? ORDER BY seq LIMIT 64",
      )
      .all(nodeId, after)
      .map(
        (r: any) =>
          this.cipher.open(
            r.packet,
            "inbox:" + nodeId + ":" + r.seq,
          ) as RunnerEvent,
      );
  }
  close() {
    this.temporary.clear();
    this.cipher.close();
  }
}
