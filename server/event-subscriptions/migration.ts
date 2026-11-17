import type { DatabaseSync } from "node:sqlite";
import { automationSchema } from "../../shared/automations.js";

export function deleteEventTask(db: DatabaseSync, id: string) {
  db.prepare(
    "DELETE FROM automation_deliveries WHERE run_id IN (SELECT id FROM automation_runs WHERE task_id=?)",
  ).run(id);
  db.prepare("DELETE FROM automation_event_inbox WHERE task_id=?").run(id);
  db.prepare("DELETE FROM automation_runs WHERE task_id=?").run(id);
  db.prepare("DELETE FROM automation_attachment_refs WHERE task_id=?").run(id);
  db.prepare("DELETE FROM automation_threads WHERE task_id=?").run(id);
  db.prepare("DELETE FROM automation_tasks WHERE id=?").run(id);
  db.prepare(
    "INSERT INTO audit(at,action,subject,decision) VALUES(?,?,?,?)",
  ).run(Date.now(), "automation/cleanup", id, "invalid-format-deleted");
}

export function discardInvalidEventConfiguration(db: DatabaseSync) {
  db.exec(
    "DROP TABLE IF EXISTS automation_event_routes; DROP TABLE IF EXISTS automation_event_migrations;",
  );
  const removed: string[] = [];
  for (const row of db
    .prepare("SELECT id,content FROM automation_tasks")
    .all()) {
    let valid = false;
    try {
      valid = automationSchema.safeParse(
        JSON.parse(row.content as string),
      ).success;
    } catch {}
    const missingConversation = db
      .prepare(
        "SELECT 1 FROM automation_runs r WHERE r.task_id=? AND r.thread_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM automation_threads a WHERE a.task_id=r.task_id) LIMIT 1",
      )
      .get(row.id);
    if (!valid || missingConversation) {
      deleteEventTask(db, row.id as string);
      removed.push(row.id as string);
    }
  }
  return removed;
}
