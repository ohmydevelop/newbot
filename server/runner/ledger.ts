import { DatabaseSync } from "node:sqlite";
import {
  chmodSync,
  mkdirSync,
  existsSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  RUNNER_PACKET_BYTES,
  runnerCommand,
  runnerGrant,
  canonicalPacket,
  type RunnerCommand,
  type RunnerReceipt,
  type RunnerEvent,
  type RunnerGrant,
} from "../../shared/runner-control.js";
import { PacketCipher } from "./packets.js";
import { PublicError } from "../public-error.js";
type ReceiptRow = {
  id: string;
  fingerprint: string;
  epoch: number;
  scope: string;
  revision: number;
  state: RunnerReceipt["state"];
  result: string | null;
};
const BUDGET = 256 * 1024 * 1024;
/** Caller holds the node instance lease. No native parameters or private command bodies are stored here. */
export class RunnerLedger {
  readonly sql: DatabaseSync;
  readonly cipher: PacketCipher;
  private pending = new Map<string, Promise<RunnerReceipt>>();
  constructor(
    readonly directory: string,
    readonly nodeId: string,
  ) {
    directory = resolve(directory);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (realpathSync(directory) !== directory)
      throw new PublicError("节点状态目录不能使用链接");
    const path = join(directory, "runner.sqlite");
    if (
      existsSync(path) &&
      (!lstatSync(path).isFile() || lstatSync(path).nlink !== 1)
    )
      throw new PublicError("节点状态库不能使用链接");
    this.sql = new DatabaseSync(path);
    chmodSync(path, 0o600);
    const version = (this.sql.prepare("PRAGMA user_version").get() as any)
      .user_version;
    if (version > 1) {
      this.sql.close();
      throw new PublicError("节点状态版本不兼容");
    }
    this.sql.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;
   CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS grants(scope TEXT PRIMARY KEY,revision INTEGER NOT NULL,enabled INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,epoch INTEGER NOT NULL,scope TEXT NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,result TEXT);
   CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT,epoch INTEGER NOT NULL,kind TEXT NOT NULL,command_id TEXT,scope TEXT NOT NULL,packet TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,scope TEXT NOT NULL);
   PRAGMA user_version=1;`);
    try {
      const owner = this.get("node");
      if (owner && owner !== nodeId)
        throw new PublicError("节点状态属于另一身份");
      this.cipher = new PacketCipher(
        directory,
        !!this.sql
          .prepare(
            "SELECT 1 FROM receipts UNION ALL SELECT 1 FROM outbox LIMIT 1",
          )
          .get(),
      );
      this.set("node", nodeId);
      this.sql.exec(
        "UPDATE receipts SET state='unknown' WHERE state='dispatching'",
      );
    } catch (e) {
      this.sql.close();
      throw e;
    }
  }
  private get(key: string) {
    return (
      this.sql.prepare("SELECT value FROM meta WHERE key=?").get(key) as
        | { value: string }
        | undefined
    )?.value;
  }
  private set(key: string, value: string) {
    this.sql.prepare("INSERT OR REPLACE INTO meta VALUES(?,?)").run(key, value);
  }
  get epoch() {
    return Number(this.get("epoch") || 0);
  }
  activate(epoch: number, grants: RunnerGrant[]) {
    if (!Number.isSafeInteger(epoch) || epoch < 1 || epoch < this.epoch)
      throw new PublicError("节点代次已过期");
    grants.forEach((g) => runnerGrant.parse(g));
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      this.set("epoch", String(epoch));
      this.sql.exec("UPDATE grants SET enabled=0");
      for (const g of grants) {
        const old = this.sql
          .prepare("SELECT revision FROM grants WHERE scope=?")
          .get(g.scope) as { revision: number } | undefined;
        if (old && g.revision < old.revision)
          throw new PublicError("节点配置修订不能回退");
        this.sql
          .prepare("INSERT OR REPLACE INTO grants VALUES(?,?,1)")
          .run(g.scope, g.revision);
      }
      this.sql.exec("COMMIT");
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }
  bindThread(id: string, scope: string) {
    const prior = this.threadScope(id);
    if (prior && prior !== scope)
      throw new PublicError("原生线程已绑定其他工作区");
    this.sql
      .prepare("INSERT OR IGNORE INTO threads VALUES(?,?)")
      .run(id, scope);
  }
  threadScope(id: string) {
    return (
      this.sql.prepare("SELECT scope FROM threads WHERE id=?").get(id) as
        | { scope: string }
        | undefined
    )?.scope;
  }
  private row(id: string) {
    return this.sql.prepare("SELECT * FROM receipts WHERE id=?").get(id) as
      | ReceiptRow
      | undefined;
  }
  receipt(id: string): RunnerReceipt | undefined {
    const r = this.row(id);
    return r
      ? {
          id: r.id,
          state: r.state,
          ...(r.result
            ? { result: this.cipher.open(r.result, "receipt:" + r.id) }
            : {}),
        }
      : undefined;
  }
  private budget(bytes: number) {
    const used = (
      this.sql
        .prepare(
          "SELECT (SELECT coalesce(sum(length(packet)),0) FROM outbox)+(SELECT coalesce(sum(length(result)),0) FROM receipts) bytes",
        )
        .get() as { bytes: number }
    ).bytes;
    if (used + bytes > BUDGET)
      throw new PublicError("节点回执待同步数据已满，请恢复连接后继续");
  }
  private append(
    epoch: number,
    kind: RunnerEvent["kind"],
    commandId: string | null,
    scope: string,
    body: unknown,
  ) {
    if (Buffer.byteLength(canonicalPacket(body)) > RUNNER_PACKET_BYTES - 65536)
      throw new PublicError("节点事件超过传输预算");
    // seq is reserved inside the same SQLite transaction as the terminal receipt.
    const packet = this.cipher.seal(
      body,
      `event:${epoch}:${kind}:${commandId || ""}:${scope}`,
    );
    this.budget(packet.length);
    return Number(
      this.sql
        .prepare(
          "INSERT INTO outbox(epoch,kind,command_id,scope,packet) VALUES(?,?,?,?,?)",
        )
        .run(epoch, kind, commandId, scope, packet).lastInsertRowid,
    );
  }
  event(
    kind: Exclude<RunnerEvent["kind"], "receipt">,
    scope: string,
    body: unknown,
  ) {
    return this.append(this.epoch, kind, null, scope, body);
  }
  events(limit = 64): RunnerEvent[] {
    const rows = this.sql
      .prepare("SELECT * FROM outbox ORDER BY seq LIMIT ?")
      .all(Math.min(64, Math.max(1, limit))) as any[];
    const result: RunnerEvent[] = [];
    let bytes = 0;
    for (const r of rows) {
      const body = this.cipher.open(
        r.packet,
        `event:${r.epoch}:${r.kind}:${r.command_id || ""}:${r.scope}`,
      );
      bytes += Buffer.byteLength(canonicalPacket(body));
      if (result.length && bytes > 4 * 1024 * 1024) break;
      result.push({
        seq: r.seq,
        epoch: r.epoch,
        kind: r.kind,
        commandId: r.command_id,
        scope: r.scope,
        body,
      });
    }
    return result;
  }
  acknowledge(seq: number) {
    if (!Number.isSafeInteger(seq) || seq < 0)
      throw new PublicError("事件确认序号无效");
    const old = Number(this.get("ack") || 0),
      max = (
        this.sql.prepare("SELECT coalesce(max(seq),0) n FROM outbox").get() as {
          n: number;
        }
      ).n;
    if (seq < old || seq > Math.max(old, max))
      throw new PublicError("事件确认超出已生成范围");
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      this.sql.prepare("DELETE FROM outbox WHERE seq<=?").run(seq);
      this.set("ack", String(seq));
      this.sql.exec("COMMIT");
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }
  execute(
    input: RunnerCommand,
    perform: (command: RunnerCommand) => Promise<unknown>,
  ): Promise<RunnerReceipt> {
    const c = runnerCommand.parse(input);
    canonicalPacket(c);
    const grant = this.sql
      .prepare("SELECT * FROM grants WHERE scope=?")
      .get(c.scope) as any;
    if (c.nodeId !== this.nodeId || c.epoch !== this.epoch || !grant?.enabled)
      throw new PublicError("节点归属、代次或配置修订已过期");
    const { epoch: _, ...identity } = c,
      fingerprint = this.cipher.fingerprint(identity),
      old = this.row(c.id);
    if (old && old.fingerprint !== fingerprint)
      throw new PublicError("同一节点命令ID不能用于不同内容");
    if (old && old.state !== "accepted") {
      const running = this.pending.get(c.id);
      if (running) return running;
      const saved = this.receipt(c.id)!;
      if (
        !this.sql.prepare("SELECT 1 FROM outbox WHERE command_id=?").get(c.id)
      )
        this.append(old.epoch, "receipt", c.id, c.scope, saved);
      return Promise.resolve(saved);
    }
    if (grant.revision !== c.revision)
      throw new PublicError("节点配置修订已过期");
    if (!old)
      this.sql
        .prepare("INSERT INTO receipts VALUES(?,?,?,?,?,'accepted',NULL)")
        .run(c.id, fingerprint, c.epoch, c.scope, c.revision);
    this.budget(16 * 1024 * 1024);
    this.sql
      .prepare(
        "UPDATE receipts SET state='dispatching',epoch=? WHERE id=? AND state='accepted'",
      )
      .run(c.epoch, c.id);
    const operation = (async () => {
      let result: unknown, state: "completed" | "unknown";
      try {
        result = await perform(c);
        if (
          Buffer.byteLength(canonicalPacket(result)) >
          RUNNER_PACKET_BYTES - 131072
        )
          throw new PublicError("节点结果超过传输预算");
        state = "completed";
      } catch {
        state = "unknown";
        result = { message: "执行结果尚未确认，不会自动重新执行" };
      }
      const packet = this.cipher.seal(result, "receipt:" + c.id);
      this.sql.exec("BEGIN IMMEDIATE");
      try {
        this.budget(packet.length * 2);
        this.sql
          .prepare("UPDATE receipts SET state=?,result=? WHERE id=?")
          .run(state, packet, c.id);
        this.append(c.epoch, "receipt", c.id, c.scope, {
          id: c.id,
          state,
          result,
        });
        this.sql.exec("COMMIT");
      } catch (e) {
        this.sql.exec("ROLLBACK");
        this.sql
          .prepare("UPDATE receipts SET state='unknown' WHERE id=?")
          .run(c.id);
        throw e;
      }
      return this.receipt(c.id)!;
    })();
    this.pending.set(c.id, operation);
    void operation.finally(() => this.pending.delete(c.id)).catch(() => {});
    return operation;
  }
  reject(command: RunnerCommand) {
    const c = runnerCommand.parse(command);
    if (c.nodeId !== this.nodeId || c.epoch !== this.epoch)
      throw new PublicError("节点命令代次无效");
    const existing = this.row(c.id);
    const { epoch: ignoredEpoch, ...identityCheck } = c;
    if (
      existing &&
      existing.fingerprint !== this.cipher.fingerprint(identityCheck)
    )
      throw new PublicError("同一节点命令ID不能用于不同内容");
    if (existing) {
      const saved = this.receipt(c.id)!;
      if (saved.state === "accepted" || saved.state === "dispatching")
        throw new PublicError("命令结果尚未确认");
      if (
        !this.sql.prepare("SELECT 1 FROM outbox WHERE command_id=?").get(c.id)
      )
        this.append(existing.epoch, "receipt", c.id, c.scope, saved);
      return;
    }
    const { epoch: _, ...identity } = c,
      result = { message: "命令归属或配置修订已失效，未执行" },
      packet = this.cipher.seal(result, "receipt:" + c.id);
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      this.sql
        .prepare("INSERT INTO receipts VALUES(?,?,?,?,?,'rejected',?)")
        .run(
          c.id,
          this.cipher.fingerprint(identity),
          c.epoch,
          c.scope,
          c.revision,
          packet,
        );
      this.append(c.epoch, "receipt", c.id, c.scope, {
        id: c.id,
        state: "rejected",
        result,
      });
      this.sql.exec("COMMIT");
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    if (this.pending.size)
      throw new PublicError("节点操作尚未结束，不能关闭回执库");
    this.cipher.close();
    this.sql.close();
  }
}
