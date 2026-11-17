import { DatabaseSync } from "node:sqlite";
import {
  randomBytes,
  randomUUID,
  createHash,
  createCipheriv,
  createDecipheriv,
  timingSafeEqual,
} from "node:crypto";
import {
  mkdirSync,
  openSync,
  closeSync,
  writeSync,
  readFileSync,
  chmodSync,
  constants,
  fstatSync,
  fsyncSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import {
  cloudEvent,
  type CloudEvent,
} from "../../packages/event-bridge/protocol.js";
import { canonical } from "../../packages/event-bridge/core.js";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export class RelayStore {
  private db: DatabaseSync;
  private key: Buffer;
  constructor(
    directory: string,
    private now = Date.now,
    private maxPending = 100000,
  ) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const path = join(directory, "relay.key");
    if (!existsSync(path) && existsSync(join(directory, "relay.sqlite")))
      throw new Error("Relay encryption key missing; restore the original key");
    try {
      const fd = openSync(
        path,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      try {
        writeSync(fd, randomBytes(32));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size !== 32 || stat.mode & 0o077)
        throw new Error("Relay key permissions invalid");
      this.key = readFileSync(fd);
    } finally {
      closeSync(fd);
    }
    const file = join(directory, "relay.sqlite");
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS routes(id TEXT PRIMARY KEY,producer TEXT NOT NULL,consumer TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,route TEXT NOT NULL,id TEXT NOT NULL,digest TEXT NOT NULL,packet TEXT,state TEXT NOT NULL,lease TEXT,until INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,completed INTEGER,UNIQUE(route,id));
      CREATE INDEX IF NOT EXISTS pending ON events(route,state,seq);
      CREATE TABLE IF NOT EXISTS consumers(route TEXT NOT NULL,id TEXT NOT NULL,cursor INTEGER NOT NULL,lease TEXT,until INTEGER NOT NULL DEFAULT 0,last INTEGER,PRIMARY KEY(route,id));
      CREATE TABLE IF NOT EXISTS hooks(route TEXT NOT NULL,id TEXT NOT NULL,packet TEXT NOT NULL,PRIMARY KEY(route,id));
      CREATE TABLE IF NOT EXISTS receipts(route TEXT NOT NULL,consumer TEXT NOT NULL,id TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(route,consumer,id));`);
  }
  private tx<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.db.exec("COMMIT");
      return v;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private seal(text: string, context: string) {
    const nonce = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key, nonce);
    c.setAAD(Buffer.from(context));
    const data = Buffer.concat([c.update(text), c.final()]);
    return JSON.stringify([
      nonce.toString("base64"),
      c.getAuthTag().toString("base64"),
      data.toString("base64"),
    ]);
  }
  private open(packet: string, context: string) {
    const [nonce, tag, data] = JSON.parse(packet);
    const c = createDecipheriv(
      "aes-256-gcm",
      this.key,
      Buffer.from(nonce, "base64"),
    );
    c.setAAD(Buffer.from(context));
    c.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(
      Buffer.concat([
        c.update(Buffer.from(data, "base64")),
        c.final(),
      ]).toString(),
    );
  }
  createRoute() {
    const id = randomUUID(),
      producer = randomBytes(32).toString("base64url"),
      consumer = randomBytes(32).toString("base64url");
    this.db
      .prepare("INSERT INTO routes(id,producer,consumer) VALUES(?,?,?)")
      .run(id, digest(producer), digest(consumer));
    return { id, producer, consumer };
  }
  authorize(route: string, token: string, role: "producer" | "consumer") {
    const row = this.db
      .prepare("SELECT * FROM routes WHERE id=? AND enabled=1")
      .get(route);
    return (
      !!row &&
      timingSafeEqual(
        Buffer.from(row[role] as string),
        Buffer.from(digest(token)),
      )
    );
  }
  revoke(route: string) {
    this.db.prepare("UPDATE routes SET enabled=0 WHERE id=?").run(route);
  }
  publish(route: string, input: unknown) {
    const event = cloudEvent.parse(input),
      raw = canonical(event),
      hash = digest(raw);
    if (Buffer.byteLength(raw) > 65536) throw new Error("event_too_large");
    return this.tx(() => {
      const old = this.db
        .prepare("SELECT digest FROM events WHERE route=? AND id=?")
        .get(route, canonical([event.source, event.id]));
      if (old) {
        if (old.digest !== hash) throw new Error("event_conflict");
        return { accepted: true, duplicate: true };
      }
      const count = this.db
        .prepare(
          "SELECT COUNT(*) n FROM events WHERE route=? AND state='pending'",
        )
        .get(route)!.n as number;
      if (count >= this.maxPending) throw new Error("capacity");
      this.db
        .prepare(
          "INSERT INTO events(route,id,digest,packet,state,created) VALUES(?,?,?,?,'pending',?)",
        )
        .run(
          route,
          canonical([event.source, event.id]),
          hash,
          this.seal(raw, route),
          this.now(),
        );
      return { accepted: true, duplicate: false };
    });
  }
  subscribe(route: string, consumer: string, baseline = true) {
    const cursor = baseline
      ? Number(
          this.db
            .prepare("SELECT COALESCE(MAX(seq),0) n FROM events WHERE route=?")
            .get(route)!.n,
        )
      : 0;
    this.db
      .prepare("INSERT OR IGNORE INTO consumers(route,id,cursor) VALUES(?,?,?)")
      .run(route, consumer, cursor);
  }
  lease(route: string, consumer = "default") {
    return this.tx(() => {
      this.subscribe(route, consumer, false);
      const group = this.db
        .prepare("SELECT * FROM consumers WHERE route=? AND id=?")
        .get(route, consumer)!;
      if (Number(group.until) > this.now())
        return { receipt: null, events: [] as CloudEvent[] };
      const rows = this.db
        .prepare(
          "SELECT seq,packet FROM events WHERE route=? AND seq>? ORDER BY seq LIMIT 32",
        )
        .all(route, group.cursor);
      if (!rows.length) return { receipt: null, events: [] as CloudEvent[] };
      if (rows.some((row) => !row.packet)) throw new Error("gap");
      const receipt = randomUUID();
      this.db
        .prepare(
          "UPDATE consumers SET lease=?,until=?,last=? WHERE route=? AND id=?",
        )
        .run(receipt, this.now() + 60000, rows.at(-1)!.seq, route, consumer);
      return {
        receipt,
        events: rows.map(
          (row) => this.open(row.packet as string, route) as CloudEvent,
        ),
      };
    });
  }
  ack(route: string, receipt: string, consumer = "default") {
    return this.tx(() => {
      if (
        this.db
          .prepare(
            "SELECT id FROM receipts WHERE route=? AND consumer=? AND id=?",
          )
          .get(route, consumer, receipt)
      )
        return { acknowledged: true };
      const group = this.db
        .prepare("SELECT * FROM consumers WHERE route=? AND id=? AND lease=?")
        .get(route, consumer, receipt);
      if (!group)
        throw new Error("lease_expired");
      this.db
        .prepare(
          "UPDATE consumers SET cursor=last,lease=NULL,until=0 WHERE route=? AND id=?",
        )
        .run(route, consumer);
      this.db
        .prepare("INSERT INTO receipts VALUES(?,?,?,?)")
        .run(route, consumer, receipt, this.now());
      const minimum = this.db
        .prepare("SELECT MIN(cursor) n FROM consumers WHERE route=?")
        .get(route)!.n!;
      this.db
        .prepare(
          "UPDATE events SET state='done',completed=? WHERE route=? AND seq<=? AND state='pending'",
        )
        .run(this.now(), route, minimum);
      return { acknowledged: true };
    });
  }
  unsubscribe(route: string, consumer: string) {
    return this.tx(() => {
      this.db
        .prepare("DELETE FROM consumers WHERE route=? AND id=?")
        .run(route, consumer);
      this.db
        .prepare("DELETE FROM receipts WHERE route=? AND consumer=?")
        .run(route, consumer);
      const minimum = this.db
        .prepare("SELECT MIN(cursor) n FROM consumers WHERE route=?")
        .get(route)!.n;
      if (minimum !== null)
        this.db
          .prepare(
            "UPDATE events SET state='done',completed=? WHERE route=? AND seq<=? AND state='pending'",
          )
          .run(this.now(), route, minimum);
      return { unsubscribed: true };
    });
  }
  saveHook(
    route: string,
    id: string,
    configuration: { secret: string; subscription?: string },
  ) {
    this.tx(() => {
      this.subscribe(route, id);
      this.db
        .prepare(
          "INSERT INTO hooks VALUES(?,?,?) ON CONFLICT(route,id) DO UPDATE SET packet=excluded.packet",
        )
        .run(route, id, this.seal(JSON.stringify(configuration), route + id));
    });
  }
  hook(
    route: string,
    id: string,
  ): { secret: string; subscription?: string } | undefined {
    if (
      !this.db
        .prepare("SELECT id FROM routes WHERE id=? AND enabled=1")
        .get(route)
    )
      return;
    const row = this.db
      .prepare("SELECT packet FROM hooks WHERE route=? AND id=?")
      .get(route, id);
    return row ? this.open(row.packet as string, route + id) : undefined;
  }
  removeHook(route: string, id: string) {
    this.db.prepare("DELETE FROM hooks WHERE route=? AND id=?").run(route, id);
    this.unsubscribe(route, id);
  }
  publishHook(
    route: string,
    key: string,
    id: string,
    body: Record<string, any>,
  ) {
    const source = "urn:newbot:hook:" + key;
    const old = this.db
      .prepare("SELECT packet FROM events WHERE route=? AND id=?")
      .get(route, canonical([source, id]));
    if (old) {
      if (!old.packet) return { accepted: true, duplicate: true };
      const previous = this.open(old.packet as string, route).data;
      const stable = (v: Record<string, unknown>) => {
        const { cursor, ...rest } = v;
        return canonical(rest);
      };
      if (stable(previous) !== stable(body)) throw new Error("event_conflict");
      return { accepted: true, duplicate: true };
    }
    return this.publish(route, {
      specversion: "1.0",
      id,
      source,
      type: "io.newbot.webhook",
      time: body.timestamp || new Date(this.now()).toISOString(),
      data: body,
    });
  }
  cleanup() {
    this.db
      .prepare(
        "UPDATE events SET packet=NULL WHERE state='done' AND completed<?",
      )
      .run(this.now() - 7 * 86400000);
    this.db
      .prepare("DELETE FROM events WHERE state='done' AND completed<?")
      .run(this.now() - 30 * 86400000);
    this.db
      .prepare("DELETE FROM receipts WHERE created<?")
      .run(this.now() - 30 * 86400000);
  }
  close() {
    this.db.close();
    this.key.fill(0);
  }
}
