// Used only by explicit local integration verification, never by production routes.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  copyFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { database } from "../../server/db.js";
import { providerStateContent } from "../../server/provider-state.js";

export function isolatedProvider(root: string, sourcePath: string) {
  const work = mkdtempSync(join(root, ".data/v1-model-proof-"));
  chmodSync(work, 0o700);
  const directory = join(work, "server"),
    cwd = join(work, "workspace");
  mkdirSync(cwd, { mode: 0o700 });
  let source: DatabaseSync | undefined;
  try {
    source = new DatabaseSync(join(sourcePath, "newbot.sqlite"), {
      readOnly: true,
    });
    source.exec("BEGIN");
    const row = source
      .prepare(
        "SELECT format,revision,content,updated FROM provider_configuration WHERE id=1",
      )
      .get()!;
    assert.ok(row, "Source provider configuration is required");
    const values = JSON.parse(String(row.content));
    providerStateContent(values);
    const provider = values.model_provider;
    const target = database(directory);
    try {
      target.raw
        .prepare("INSERT INTO provider_configuration VALUES(1,?,?,?,?)")
        .run(row.format, row.revision, row.content, row.updated);
      // Keep encrypted payloads encrypted; the existing vault decrypts only at its normal boundary.
      for (const field of source
        .prepare(
          "SELECT * FROM private_field_sets WHERE scope='provider' AND target=?",
        )
        .all(provider))
        target.raw
          .prepare("INSERT INTO private_field_sets VALUES(?,?,?,?,?,?)")
          .run(
            field.scope,
            field.target,
            field.revision,
            field.binding,
            field.specs,
            field.packet,
          );
      for (const cred of source
        .prepare(
          "SELECT * FROM managed_credentials WHERE scope='provider' AND target=?",
        )
        .all(provider))
        target.raw
          .prepare(
            "INSERT INTO managed_credentials(scope,target,ref,binding,version,nonce,ciphertext,tag,updated) VALUES(?,?,?,?,?,?,?,?,?)",
          )
          .run(
            cred.scope,
            cred.target,
            cred.ref,
            cred.binding,
            cred.version,
            cred.nonce,
            cred.ciphertext,
            cred.tag,
            cred.updated,
          );
    } finally {
      target.raw.close();
    }
    source.exec("COMMIT");
    if (existsSync(join(sourcePath, "private-credentials.key"))) {
      copyFileSync(
        join(sourcePath, "private-credentials.key"),
        join(directory, "private-credentials.key"),
      );
      chmodSync(join(directory, "private-credentials.key"), 0o600);
    }
    source.close();
    return { work, directory, cwd, model: String(values.model) };
  } catch (error) {
    try {
      source?.close();
    } catch {}
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
}
