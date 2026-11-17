import { z } from "zod";
import type { Store } from "../db.js";
import type { credentialVault } from "../credential-vault.js";
import { deleteEventTask } from "./migration.js";

export const accountConfiguration = z.strictObject({
  values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  secrets: z.record(z.string(), z.string()),
  linkedRevision: z.string().optional(),
});

export function discardInvalidEventAccounts(
  db: Store,
  vault: Pick<ReturnType<typeof credentialVault>, "openPrivate">,
) {
  const invalid: string[] = [];
  for (const row of db.raw
    .prepare("SELECT id,revision,binding,packet FROM automation_event_accounts")
    .all()) {
    let bytes: Buffer;
    try {
      bytes = vault.openPrivate(
        row.packet as string,
        `newbot:events:${row.id}:${row.revision}:${row.binding}`,
      );
    } catch {
      continue;
    }
    try {
      accountConfiguration.parse(JSON.parse(bytes.toString("utf8")));
    } catch {
      invalid.push(row.id as string);
    } finally {
      bytes.fill(0);
    }
  }
  if (!invalid.length) return [];
  db.raw.exec("BEGIN IMMEDIATE");
  try {
    for (const row of db.raw
      .prepare("SELECT id,content FROM automation_tasks")
      .all()) {
      const content = JSON.parse(row.content as string);
      if (
        content.eventTriggers?.some((t: { connectionId: string }) =>
          invalid.includes(t.connectionId),
        )
      )
        deleteEventTask(db.raw, row.id as string);
    }
    for (const id of invalid) {
      db.raw.prepare("DELETE FROM automation_event_oauth WHERE id=?").run(id);
      db.raw
        .prepare("DELETE FROM automation_event_accounts WHERE id=?")
        .run(id);
      db.audit("automation/account-cleanup", id, "invalid-format-deleted");
    }
    db.raw.exec("COMMIT");
    return invalid;
  } catch (error) {
    db.raw.exec("ROLLBACK");
    throw error;
  }
}
