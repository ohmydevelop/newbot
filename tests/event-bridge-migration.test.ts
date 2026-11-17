import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { database } from "../server/db.js";
import { automationSchema } from "../shared/automations.js";
import { discardInvalidEventConfiguration } from "../server/event-subscriptions/migration.js";
import { discardInvalidEventAccounts } from "../server/event-subscriptions/account-configuration.js";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "event-cleanup-"));
  const db = database(dir);
  const content = automationSchema.parse({
    name: "current",
    prompt: "test",
    triggers: [],
    eventTriggers: [
      {
        id: randomUUID(),
        source: "subscription",
        providerId: "a".repeat(64),
        connectionId: randomUUID(),
        events: ["mail.received"],
        arguments: { mailbox: "inbox" },
      },
    ],
  });
  function insert(value: unknown) {
    const id = randomUUID();
    db.raw
      .prepare("INSERT INTO automation_tasks VALUES(?,7,?,1,NULL,1,2,0)")
      .run(id, JSON.stringify(value));
    return id;
  }
  return {
    dir,
    db,
    content,
    insert,
    close: () => {
      db.raw.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("v24 deletes incomplete/fixed-source tasks and their dependent data, preserves current tasks and chats; repeat is harmless", () => {
  const f = setup();
  try {
    const good = f.insert(f.content);
    const bad = f.insert({
      ...f.content,
      eventTriggers: [
        { id: randomUUID(), source: "subscription", repository: "owner/repo" },
      ],
    });
    const obsolete = f.insert({
      ...f.content,
      eventTriggers: [{ id: randomUUID(), source: "webhook" }],
    });
    f.db.raw
      .prepare("UPDATE automation_tasks SET deleted=1 WHERE id=?")
      .run(obsolete);
    f.db.raw
      .prepare("INSERT INTO threads VALUES('conversation','preserved','',1,0)")
      .run();
    f.db.raw
      .prepare("INSERT INTO automation_threads VALUES(?,'conversation')")
      .run(bad);
    f.db.raw
      .prepare(
        "INSERT INTO automation_runs VALUES('run',?,7,'event',1,'queued','request','conversation',NULL,?,NULL,NULL,NULL,0)",
      )
      .run(bad, JSON.stringify(f.content));
    f.db.raw
      .prepare(
        "INSERT INTO automation_event_inbox VALUES(?,'trigger','event','digest','run',1)",
      )
      .run(bad);
    f.db.raw.exec(
      "INSERT INTO automation_deliveries VALUES('run',1,'mail','queued',0,NULL,NULL); CREATE TABLE automation_event_routes(task_id TEXT,packet TEXT); INSERT INTO automation_event_routes VALUES('old','secret'); PRAGMA user_version=23;",
    );
    const unbound=f.insert(f.content);
    f.db.raw.prepare("INSERT INTO automation_runs VALUES('unbound-run',?,7,'manual',1,'succeeded','unbound-request','conversation',NULL,?,NULL,NULL,NULL,0)").run(unbound,JSON.stringify(f.content));
    f.db.raw.close();
    f.db = database(f.dir);
    assert.equal(
      f.db.raw.prepare("PRAGMA user_version").get()!.user_version,
      24,
    );
    assert.deepEqual(
      f.db.raw
        .prepare("SELECT id,content FROM automation_tasks")
        .all()
        .map((r) => ({ ...r })),
      [{ id: good, content: JSON.stringify(f.content) }],
    );
    for (const table of [
      "automation_threads",
      "automation_runs",
      "automation_event_inbox",
      "automation_deliveries",
    ])
      assert.equal(
        f.db.raw.prepare(`SELECT count(*) n FROM ${table}`).get()!.n,
        0,
      );
    assert.equal(
      f.db.raw.prepare("SELECT count(*) n FROM threads").get()!.n,
      1,
    );
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT name FROM sqlite_master WHERE name='automation_event_routes'",
        )
        .get(),
      undefined,
    );
    assert.equal(f.db.raw.prepare("PRAGMA foreign_key_check").all().length, 0);
    assert.deepEqual(discardInvalidEventConfiguration(f.db.raw), []);
  } finally {
    f.db.raw.close();
    rmSync(f.dir, { recursive: true, force: true });
  }
});
test("cleanup is atomic when a deletion fails; malformed JSON is deleted instead of repaired", () => {
  const f = setup();
  try {
    const id = f.insert({ eventTriggers: [{ source: "github" }] });
    f.db.raw
      .prepare("UPDATE automation_tasks SET content='not-json' WHERE id=?")
      .run(id);
    f.db.raw.exec(
      "CREATE TRIGGER stop_cleanup BEFORE DELETE ON automation_tasks BEGIN SELECT RAISE(ABORT,'test interruption'); END; BEGIN",
    );
    assert.throws(
      () => discardInvalidEventConfiguration(f.db.raw),
      /test interruption/,
    );
    f.db.raw.exec("ROLLBACK; DROP TRIGGER stop_cleanup;");
    assert.equal(
      f.db.raw
        .prepare("SELECT content FROM automation_tasks WHERE id=?")
        .get(id)!.content,
      "not-json",
    );
    assert.equal(
      f.db.raw
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='automation/cleanup'",
        )
        .get()!.n,
      0,
    );
    f.db.raw.exec("BEGIN");
    assert.deepEqual(discardInvalidEventConfiguration(f.db.raw), [id]);
    f.db.raw.exec("COMMIT");
  } finally {
    f.close();
  }
});
test("only decoded invalid account formats are deleted, not inaccessible encrypted credentials", () => {
  const f = setup();
  try {
    const account = f.content.eventTriggers[0].connectionId,
      task = f.insert(f.content);
    for (const [id, packet] of [
      [account, "old-token"],
      ["current", JSON.stringify({ values: {}, secrets: { token: "keep" } })],
      ["unreadable", "encrypted"],
    ])
      f.db.raw
        .prepare(
          "INSERT INTO automation_event_accounts VALUES(?,1,'provider','binding','label',?,1,1)",
        )
        .run(id, packet);
    const removed = discardInvalidEventAccounts(f.db, {
      openPrivate(packet) {
        if (packet === "encrypted") throw Error("key unavailable");
        return Buffer.from(packet);
      },
    });
    assert.deepEqual(removed, [account]);
    assert.equal(
      f.db.raw.prepare("SELECT id FROM automation_tasks WHERE id=?").get(task),
      undefined,
    );
    assert.deepEqual(
      f.db.raw
        .prepare("SELECT id FROM automation_event_accounts ORDER BY id")
        .all()
        .map((r) => r.id),
      ["current", "unreadable"],
    );
    assert.deepEqual(
      discardInvalidEventAccounts(f.db, {
        openPrivate(packet) {
          if (packet === "encrypted") throw Error();
          return Buffer.from(packet);
        },
      }),
      [],
    );
  } finally {
    f.close();
  }
});

test("shared subscription cleanup removes only invalid targets and preserves survivor cursor and deduplication", async () => {
  const { SubscriptionEngine } = await import(
    "../server/event-subscriptions/engine.js"
  );
  const { ProviderRegistry } = await import(
    "../server/event-subscriptions/contracts.js"
  );
  const dir = mkdtempSync(join(tmpdir(), "event-target-cleanup-"));
  let now = 100,
    phase = 0;
  const delivered: string[] = [];
  const registry = new ProviderRegistry(
    new Map([
      [
        "test",
        {
          pull: async () => ({
            cursor: String(++phase),
            events:
              phase === 1 ? [] : [{ id: "one", type: "message", payload: {} }],
          }),
          acknowledge: async () => {},
        },
      ],
    ]),
  );
  const providerId = registry.install({
    version: 1,
    pluginId: "test",
    source: {
      id: "source",
      label: "Test",
      adapter: "test",
      events: ["message"],
    },
  });
  const good = {
      taskId: randomUUID(),
      triggerId: randomUUID(),
      revision: 1,
      events: ["message"],
    },
    bad = { ...good, taskId: randomUUID(), triggerId: randomUUID() };
  const engine = new SubscriptionEngine({
    directory: dir,
    registry,
    now: () => now,
    pollMs: 1,
    deliver: async (target) => {
      delivered.push(target.taskId);
      return "accepted";
    },
  });
  try {
    const id = engine.subscribe({
      providerId,
      connectionId: "test",
      resource: "test",
      targets: [good, bad],
    });
    await engine.tick();
    now += 100;
    await engine.tick();
    const cursor = engine.inspect(id).cursor;
    engine.pruneTargets((t) => t.taskId === good.taskId);
    assert.equal(engine.inspect(id).cursor, cursor);
    assert.equal(engine.configurations()[0].config.targets.length, 1);
    now += 100;
    await engine.tick();
    assert.deepEqual(delivered.sort(), [good.taskId, bad.taskId].sort());
    engine.pruneTargets(() => false);
    assert.equal(engine.configurations().length, 0);
  } finally {
    await engine.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
