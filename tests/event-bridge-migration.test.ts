import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database } from "../server/db.js";
import { migrateEventConfiguration } from "../server/event-subscriptions/migration.js";

test("v21 upgrade preserves task/trigger/revision, fixed conversation, encrypted account, webhook and independent checkpoints", () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-upgrade-"));
  let db = database(dir);
  try {
    const content = {
      name: "existing",
      eventTriggers: [
        {
          id: "trigger",
          source: "subscription",
          providerId: "provider",
          connectionId: "account",
          repository: "owner/repo",
        },
      ],
    };
    db.raw
      .prepare("INSERT INTO automation_tasks VALUES('task',7,?,1,NULL,1,2,0)")
      .run(JSON.stringify(content));
    db.raw.exec(
      "INSERT INTO automation_threads VALUES('task','thread'); INSERT INTO automation_event_accounts VALUES('account',2,'provider','digest','Account','encrypted-packet',1,4); INSERT INTO automation_event_routes VALUES('task','webhook','github','v1','old-secret'); DELETE FROM automation_event_migrations; PRAGMA user_version=21;",
    );
    const accounts = db.raw
        .prepare("SELECT * FROM automation_event_accounts")
        .all(),
      routes = db.raw.prepare("SELECT * FROM automation_event_routes").all();
    const other = new DatabaseSync(join(dir, "checkpoint.sqlite"));
    other.exec(
      "CREATE TABLE checkpoint(id TEXT,cursor TEXT,dedupe TEXT); INSERT INTO checkpoint VALUES('unchanged-id','old-cursor','old-delivery');",
    );
    other.close();
    db.raw.close();
    db = database(dir);
    const row = db.raw.prepare("SELECT * FROM automation_tasks").get()!;
    assert.equal(row.revision, 7);
    assert.equal(row.enabled, 1);
    assert.deepEqual(JSON.parse(row.content as string).eventTriggers[0], {
      ...content.eventTriggers[0],
      arguments: { repository: "owner/repo" },
    });
    assert.equal(
      db.raw.prepare("SELECT thread_id FROM automation_threads").get()!
        .thread_id,
      "thread",
    );
    assert.deepEqual(
      db.raw.prepare("SELECT * FROM automation_event_accounts").all(),
      accounts,
    );
    assert.deepEqual(
      db.raw.prepare("SELECT * FROM automation_event_routes").all(),
      routes,
    );
    const check = new DatabaseSync(join(dir, "checkpoint.sqlite"));
    assert.equal(
      check.prepare("SELECT cursor FROM checkpoint").get()!.cursor,
      "old-cursor",
    );
    check.close();
    const before = row.content;
    migrateEventConfiguration(db.raw);
    assert.equal(
      db.raw.prepare("SELECT content FROM automation_tasks").get()!.content,
      before,
    );
    assert.equal(
      db.raw.prepare("SELECT affected FROM automation_event_migrations").get()!
        .affected,
      1,
    );
  } finally {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("migration interrupted by malformed data rolls back changes and completion marker, then retries", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(
    'CREATE TABLE automation_tasks(id TEXT PRIMARY KEY,content TEXT); INSERT INTO automation_tasks VALUES(\'good\',\'{"eventTriggers":[{"source":"subscription","repository":"a/b"}]}\'),(\'bad\',\'not-json\');',
  );
  const before = db
    .prepare("SELECT content FROM automation_tasks WHERE id='good'")
    .get()!.content;
  db.exec("BEGIN");
  assert.throws(() => migrateEventConfiguration(db));
  db.exec("ROLLBACK");
  assert.equal(
    db.prepare("SELECT content FROM automation_tasks WHERE id='good'").get()!
      .content,
    before,
  );
  db.exec("DELETE FROM automation_tasks WHERE id='bad'; BEGIN");
  migrateEventConfiguration(db);
  db.exec("COMMIT");
  assert.equal(
    db.prepare("SELECT affected FROM automation_event_migrations").get()!
      .affected,
    1,
  );
  db.close();
});
