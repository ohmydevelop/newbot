import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import {
  canonical,
  hash,
  pageSchema,
  ProviderRegistry,
  SourceFailure,
  subscriptionSchema,
  targetKey,
  type SourceEvent,
  type Subscription,
  type Target,
} from "./contracts.js";

type Row = {
  id: string;
  config: string;
  revision: number;
  enabled: number;
  cursor: string | null;
  receipt: string | null;
  state: string;
  owner: string | null;
  lease_until: number;
  next_poll: number;
  failures: number;
};
type Delivery = {
  event_id: string;
  target_key: string;
  target: string;
  event: string;
  attempts: number;
};
type Options = {
  directory: string;
  registry: ProviderRegistry;
  deliver: (
    target: Target,
    event: SourceEvent,
    deliveryId: string,
  ) => Promise<"accepted" | "discarded">;
  now?: () => number;
  pollMs?: number;
  leaseMs?: number;
  timeoutMs?: number;
  maxEvents?: number;
};

export class SubscriptionEngine {
  private db: DatabaseSync;
  private now: () => number;
  private stopped = false;
  private controller = new AbortController();
  private running: Promise<void> | undefined;
  constructor(private options: Options) {
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    const path = join(options.directory, "subscriptions.sqlite");
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.now = options.now ?? Date.now;
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS subscriptions(
        id TEXT PRIMARY KEY,config TEXT NOT NULL,revision INTEGER NOT NULL,enabled INTEGER NOT NULL,
        cursor TEXT,receipt TEXT,state TEXT NOT NULL,owner TEXT,lease_until INTEGER NOT NULL,
        next_poll INTEGER NOT NULL,failures INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS source_events(
        subscription_id TEXT NOT NULL REFERENCES subscriptions(id),event_id TEXT NOT NULL,
        digest TEXT NOT NULL,event TEXT NOT NULL,PRIMARY KEY(subscription_id,event_id));
      CREATE TABLE IF NOT EXISTS deliveries(
        subscription_id TEXT NOT NULL,event_id TEXT NOT NULL,target_key TEXT NOT NULL,target TEXT NOT NULL,
        state TEXT NOT NULL,attempts INTEGER NOT NULL,next_try INTEGER NOT NULL,
        PRIMARY KEY(subscription_id,event_id,target_key),
        FOREIGN KEY(subscription_id,event_id) REFERENCES source_events(subscription_id,event_id));`);
  }
  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  private row(id: string) {
    return this.db.prepare("SELECT * FROM subscriptions WHERE id=?").get(id) as
      | Row
      | undefined;
  }
  subscribe(input: unknown) {
    const config = subscriptionSchema.parse(input);
    const provider = this.options.registry.get(config.providerId);
    if (!provider) throw new Error("Provider not installed");
    const ids = config.targets.map(targetKey);
    if (new Set(ids).size !== ids.length) throw new Error("Duplicate target");
    if (
      config.targets.some((t) =>
        t.events.some((e) => !provider.manifest.source.events.includes(e)),
      )
    )
      throw new Error("Unknown event type");
    config.targets.sort((a, b) => targetKey(a).localeCompare(targetKey(b)));
    const id = hash([config.providerId, config.connectionId, config.resource]);
    const content = canonical(config);
    this.transaction(() => {
      const row = this.row(id);
      if (!row)
        this.db
          .prepare(
            "INSERT INTO subscriptions VALUES(?,?,1,1,NULL,NULL,'ready',NULL,0,0,0)",
          )
          .run(id, content);
      else if (row.config !== content)
        this.db
          .prepare(
            "UPDATE subscriptions SET config=?,revision=revision+1,owner=NULL,lease_until=0 WHERE id=?",
          )
          .run(content, id);
    });
    return id;
  }
  setEnabled(id: string, enabled: boolean) {
    this.transaction(() => {
      this.db
        .prepare(
          "UPDATE subscriptions SET enabled=?,revision=revision+1,owner=NULL,lease_until=0,state=?,next_poll=0,failures=0 WHERE id=?",
        )
        .run(enabled ? 1 : 0, enabled ? "ready" : "disabled", id);
      if (!enabled)
        this.db
          .prepare(
            "UPDATE deliveries SET state='discarded' WHERE subscription_id=? AND state='pending'",
          )
          .run(id);
    });
  }
  uninstall(providerId: string) {
    for (const row of this.db
      .prepare("SELECT * FROM subscriptions")
      .all() as Row[])
      if ((JSON.parse(row.config) as Subscription).providerId === providerId)
        this.setEnabled(row.id, false);
    this.options.registry.remove(providerId);
  }
  pruneTargets(keep: (target: Target) => boolean) {
    this.transaction(() => {
      for (const row of this.db
        .prepare("SELECT * FROM subscriptions")
        .all() as Row[]) {
        let config: Subscription | undefined;
        try {
          config = subscriptionSchema.parse(JSON.parse(row.config));
        } catch {}
        const targets = config?.targets.filter(keep) || [];
        if (config && targets.length === config.targets.length) continue;
        for (const target of config?.targets.filter((t) => !keep(t)) || [])
          this.db
            .prepare(
              "DELETE FROM deliveries WHERE subscription_id=? AND target_key=?",
            )
            .run(row.id, targetKey(target));
        if (targets.length) {
          this.db
            .prepare("UPDATE subscriptions SET config=? WHERE id=?")
            .run(JSON.stringify({ ...config, targets }), row.id);
        } else {
          this.db
            .prepare("DELETE FROM deliveries WHERE subscription_id=?")
            .run(row.id);
          this.db
            .prepare("DELETE FROM source_events WHERE subscription_id=?")
            .run(row.id);
          this.db.prepare("DELETE FROM subscriptions WHERE id=?").run(row.id);
        }
      }
    });
  }
  inspect(id: string) {
    const row = this.row(id);
    if (!row) throw new Error("Unknown subscription");
    const counts = this.db
      .prepare(
        "SELECT state,COUNT(*) count FROM deliveries WHERE subscription_id=? GROUP BY state",
      )
      .all(id) as { state: string; count: number }[];
    return {
      id,
      state: row.state,
      cursor: row.cursor,
      awaitingAck: row.receipt !== null,
      nextPoll: row.next_poll,
      failures: row.failures,
      deliveries: Object.fromEntries(counts.map((r) => [r.state, r.count])),
    };
  }
  configurations() {
    return (
      this.db.prepare("SELECT id,config,enabled FROM subscriptions").all() as {
        id: string;
        config: string;
        enabled: number;
      }[]
    ).map((r) => ({
      id: r.id,
      config: JSON.parse(r.config) as Subscription,
      enabled: !!r.enabled,
    }));
  }
  reset(id: string) {
    this.setEnabled(id, false);
    this.db
      .prepare("UPDATE subscriptions SET cursor=NULL,receipt=NULL WHERE id=?")
      .run(id);
    this.setEnabled(id, true);
  }
  tick(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    return (this.running ??= this.cycle().finally(() => {
      this.running = undefined;
    }));
  }
  async run(signal: AbortSignal) {
    while (!signal.aborted && !this.stopped) {
      await this.tick();
      try {
        await sleep(100, undefined, {
          signal: AbortSignal.any([signal, this.controller.signal]),
        });
      } catch {
        break;
      }
    }
  }
  async close() {
    if (this.stopped) {
      await this.running;
      return;
    }
    this.stopped = true;
    this.controller.abort();
    await this.running;
    this.db.close();
  }
  private async cycle() {
    const rows = this.db
      .prepare("SELECT * FROM subscriptions WHERE enabled=1 ORDER BY id")
      .all() as Row[];
    for (const candidate of rows) {
      if (this.stopped) return;
      const token = randomUUID();
      const acquired = this.db
        .prepare(
          "UPDATE subscriptions SET owner=?,lease_until=? WHERE id=? AND revision=? AND enabled=1 AND lease_until<=?",
        )
        .run(
          token,
          this.now() + (this.options.leaseMs ?? 30000),
          candidate.id,
          candidate.revision,
          this.now(),
        );
      if (!acquired.changes) continue;
      const config = JSON.parse(candidate.config) as Subscription;
      const entry = this.options.registry.get(config.providerId);
      const current = () => {
        const row = this.row(candidate.id);
        return (
          !this.stopped &&
          !!entry &&
          this.options.registry.get(config.providerId)?.generation ===
            entry.generation &&
          !!row?.enabled &&
          row.revision === candidate.revision &&
          row.owner === token &&
          row.lease_until > this.now()
        );
      };
      try {
        if (!entry) {
          this.db
            .prepare(
              "UPDATE subscriptions SET state='unavailable' WHERE id=? AND owner=?",
            )
            .run(candidate.id, token);
          continue;
        }
        const context = () => ({
          connectionId: config.connectionId,
          resource: config.resource,
          cursor: this.row(candidate.id)!.cursor,
          signal: AbortSignal.any([
            this.controller.signal,
            AbortSignal.timeout(this.options.timeoutMs ?? 5000),
          ]),
        });
        const acknowledge = async () => {
          const receipt = this.row(candidate.id)!.receipt;
          if (receipt === null || !current()) return;
          await entry.adapter.acknowledge(context(), receipt);
          if (current())
            this.db
              .prepare(
                "UPDATE subscriptions SET receipt=NULL WHERE id=? AND owner=?",
              )
              .run(candidate.id, token);
        };
        const schedule = this.row(candidate.id)!;
        if (
          schedule.next_poll <= this.now() &&
          !["auth_required", "gap", "capacity", "conflict"].includes(
            schedule.state,
          )
        ) {
          try {
            await acknowledge();
            if (!current()) continue;
            const before = this.row(candidate.id)!;
            const parsed = pageSchema.safeParse(
              await entry.adapter.pull(context()),
            );
            if (!current()) continue;
            if (!parsed.success) throw new SourceFailure("conflict");
            const page = parsed.data;
            if (Buffer.byteLength(canonical(page)) > 128 * 1024)
              throw new SourceFailure("capacity");
            if (before.cursor === null && page.events.length)
              throw new SourceFailure("conflict");
            if (
              page.events.some(
                (e) => !entry.manifest.source.events.includes(e.type),
              )
            )
              throw new SourceFailure("conflict");
            this.transaction(() => {
              if (!current()) return;
              for (const event of page.events) {
                const digest = hash(event);
                const old = this.db
                  .prepare(
                    "SELECT digest FROM source_events WHERE subscription_id=? AND event_id=?",
                  )
                  .get(candidate.id, event.id) as
                  | { digest: string }
                  | undefined;
                if (old) {
                  if (old.digest !== digest)
                    throw new SourceFailure("conflict");
                  continue;
                }
                const count = this.db
                  .prepare(
                    "SELECT COUNT(*) n FROM source_events WHERE subscription_id=?",
                  )
                  .get(candidate.id)!.n as number;
                if (count >= (this.options.maxEvents ?? 1000))
                  throw new SourceFailure("capacity");
                this.db
                  .prepare("INSERT INTO source_events VALUES(?,?,?,?)")
                  .run(candidate.id, event.id, digest, canonical(event));
                for (const target of config.targets) {
                  if (
                    target.events.length &&
                    !target.events.includes(event.type)
                  )
                    continue;
                  this.db
                    .prepare(
                      "INSERT INTO deliveries VALUES(?,?,?,?,'pending',0,0)",
                    )
                    .run(
                      candidate.id,
                      event.id,
                      targetKey(target),
                      canonical(target),
                    );
                }
              }
              this.db
                .prepare(
                  "UPDATE subscriptions SET cursor=?,receipt=?,state='ready',failures=0,next_poll=? WHERE id=? AND owner=?",
                )
                .run(
                  page.cursor,
                  page.receipt ?? null,
                  this.now() + (page.nextPollMs ?? this.options.pollMs ?? 1000),
                  candidate.id,
                  token,
                );
            });
            await acknowledge();
          } catch (e) {
            if (current()) {
              const failure =
                e instanceof SourceFailure ? e : new SourceFailure("retry");
              const failures = this.row(candidate.id)!.failures + 1;
              const delay = Math.max(
                failure.retryAfterMs,
                Math.min(60000, 1000 * 2 ** Math.min(failures - 1, 6)),
              );
              this.db
                .prepare(
                  "UPDATE subscriptions SET state=?,failures=?,next_poll=? WHERE id=? AND owner=?",
                )
                .run(
                  failure.code,
                  failures,
                  this.now() + delay,
                  candidate.id,
                  token,
                );
            }
          }
        }
        const pending = this.db
          .prepare(
            `SELECT d.event_id,d.target_key,d.target,d.attempts,e.event FROM deliveries d JOIN source_events e USING(subscription_id,event_id)
          WHERE d.subscription_id=? AND d.state='pending' AND d.next_try<=?
          AND NOT EXISTS(SELECT 1 FROM deliveries older WHERE older.subscription_id=d.subscription_id
            AND older.target_key=d.target_key AND older.state='pending' AND older.rowid<d.rowid)
          ORDER BY e.rowid,d.rowid LIMIT 64`,
          )
          .all(candidate.id, this.now()) as Delivery[];
        for (const delivery of pending) {
          if (!current()) break;
          const target = JSON.parse(delivery.target) as Target;
          let state = "discarded";
          if (config.targets.some((t) => canonical(t) === delivery.target)) {
            try {
              state = await this.options.deliver(
                target,
                JSON.parse(delivery.event) as SourceEvent,
                hash([candidate.id, delivery.event_id]),
              );
            } catch {
              state = "pending";
            }
          }
          if (current())
            this.db
              .prepare(
                "UPDATE deliveries SET state=?,attempts=attempts+1,next_try=? WHERE subscription_id=? AND event_id=? AND target_key=?",
              )
              .run(
                state,
                this.now() +
                  Math.min(60000, 1000 * 2 ** Math.min(delivery.attempts, 6)),
                candidate.id,
                delivery.event_id,
                delivery.target_key,
              );
        }
      } finally {
        this.db
          .prepare(
            "UPDATE subscriptions SET owner=NULL,lease_until=0 WHERE id=? AND owner=?",
          )
          .run(candidate.id, token);
      }
    }
  }
}
