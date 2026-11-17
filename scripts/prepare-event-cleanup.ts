import { DatabaseSync } from "node:sqlite";
import { cpSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { database } from "../server/db.js";
import { credentialVault } from "../server/credential-vault.js";
import { discardInvalidEventAccounts } from "../server/event-subscriptions/account-configuration.js";

const [input, output, key] = process.argv.slice(2).map((path) => resolve(path));
if (!input || !output || !key)
  throw new Error(
    "Expected input database, isolated output directory and vault key",
  );
mkdirSync(output, { mode: 0o700 });
const source = new DatabaseSync(input, { readOnly: true });
const before = source
  .prepare("SELECT id FROM automation_tasks")
  .all()
  .map((r) => r.id);
source.close();
cpSync(input, join(output, "newbot.sqlite"));
cpSync(key, join(output, "private-credentials.key"));
const db = database(output);
const work = join(output, "work");
mkdirSync(work, { mode: 0o700 });
const vault = credentialVault(db, output, work);
try {
  if (!vault.encryptionAvailable)
    throw new Error("Preflight vault cannot open");
  const removedAccounts = discardInvalidEventAccounts(db, vault);
  const after = new Set(
    db.raw
      .prepare("SELECT id FROM automation_tasks")
      .all()
      .map((r) => r.id),
  );
  const invalid = db.raw.prepare("PRAGMA foreign_key_check").all();
  if (invalid.length) throw new Error("Invalid foreign keys after cleanup");
  console.log(
    JSON.stringify({
      removedTasks: before.filter((id) => !after.has(id)),
      removedAccounts,
      retainedTasks: after.size,
      version: 24,
    }),
  );
} finally {
  vault.close();
  db.raw.close();
}
