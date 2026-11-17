import type { DatabaseSync } from "node:sqlite";

export function migrateEventConfiguration(db: DatabaseSync) {
  db.exec(
    "CREATE TABLE IF NOT EXISTS automation_event_migrations(id TEXT PRIMARY KEY,completed INTEGER NOT NULL,affected INTEGER NOT NULL)",
  );
  const id = "event-config-v2-preserve-identities";
  if (
    db.prepare("SELECT id FROM automation_event_migrations WHERE id=?").get(id)
  )
    return;
  let affected = 0;
  for (const row of db
    .prepare("SELECT id,content FROM automation_tasks")
    .all()) {
    const content = JSON.parse(row.content as string);
    let changed = false;
    for (const trigger of content.eventTriggers || []) {
      if (
        trigger.source !== "subscription" ||
        trigger.arguments !== undefined ||
        typeof trigger.repository !== "string" ||
        !trigger.repository
      )
        continue;
      trigger.arguments = { repository: trigger.repository };
      changed = true;
    }
    if (changed) {
      db.prepare("UPDATE automation_tasks SET content=? WHERE id=?").run(
        JSON.stringify(content),
        row.id,
      );
      affected++;
    }
  }
  db.prepare("INSERT INTO automation_event_migrations VALUES(?,?,?)").run(
    id,
    Date.now(),
    affected,
  );
}
