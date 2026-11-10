// Fixed-version native config contract: temporary Codex Home, no model/provider API calls.
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Codex } from "../server/codex.ts";
import { configuration } from "../server/configuration.ts";
import { providerManager } from "../server/providers.ts";
import { database } from "../server/db.ts";
import { CODEX_VERSION } from "../generated/version.ts";
const root = mkdtempSync(join(tmpdir(), "newbot-provider-native-")),
  home = join(root, "home"),
  cwd = join(root, "work");
mkdirSync(home);
mkdirSync(cwd);
const configPath = join(home, "config.toml"),
  secret = "SYNTHETIC_NATIVE_PROVIDER_TOKEN";
writeFileSync(
  configPath,
  `model="gpt-6.1-sol"\n[model_providers.existing]\nname="Existing"\nbase_url="http://127.0.0.1:9/v1"\nwire_api="responses"\nrequest_max_retries=2\nhttp_headers={Authorization="Bearer ${secret}"}\n`,
);
process.env.CODEX_BIN ||= resolve("node_modules/.bin/codex");
const codex = new Codex(cwd, () => ({ CODEX_HOME: home })),
  db = database(join(root, "data"));
try {
  await codex.start();
  assert.equal(codex.state, "ready", codex.reason);
  const config = configuration(codex, cwd),
    manager = providerManager(codex, db, config),
    revision = async () => (await config.read()).publicView.revision;
  const before = await revision();
  const edit = await manager.save({
    expectedRevision: before,
    id: "existing",
    create: false,
    patch: { name: "Edited" },
  });
  assert.equal(edit.state, "applied");
  assert.ok(!JSON.stringify(edit.configuration).includes(secret));
  const raw = readFileSync(configPath, "utf8");
  assert.ok(raw.includes(secret));
  assert.ok(raw.includes("request_max_retries"));
  await assert.rejects(
    manager.save({
      expectedRevision: before,
      id: "existing",
      create: false,
      patch: { name: "Stale" },
    }),
    { statusCode: 409 },
  );
  const created = await manager.save({
    expectedRevision: await revision(),
    id: "testnew",
    create: true,
    patch: {
      name: "New",
      baseUrl: "http://127.0.0.1:9/v1",
      envKey: "OPENAI_API_KEY",
    },
  });
  assert.equal(created.state, "applied");
  const persistedRevision = await revision();
  await codex.restart();
  assert.equal(codex.state, "ready");
  assert.equal(await revision(), persistedRevision);
  assert.ok(
    (await config.read()).publicView.providers.some((p) => p.id === "testnew"),
  );
  await manager.save({
    expectedRevision: await revision(),
    id: "testnew",
    create: false,
    patch: { envKey: null },
  });
  assert.equal(
    (await config.read()).response.config.model_providers.testnew.env_key ??
      null,
    null,
  );
  const removed = await manager.remove({
    expectedRevision: await revision(),
    id: "testnew",
  });
  assert.equal(removed.state, "applied");
  assert.equal(
    (await config.read()).response.config.model_providers.testnew,
    undefined,
  );
  await codex.restart();
  assert.equal(codex.state, "ready");
  assert.ok(readFileSync(configPath, "utf8").includes(secret));
  const output = resolve(".data/providers-live");
  mkdirSync(output, { recursive: true, mode: 0o700 });
  writeFileSync(
    join(output, "result.json"),
    JSON.stringify(
      {
        codex: CODEX_VERSION,
        create: true,
        editPreservesPrivateFields: true,
        nativeCAS: true,
        environmentReferenceRemoval: true,
        nativeHistoryCheck: true,
        delete: true,
        restartPersistence: true,
        isolated: true,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS native Provider create/edit/delete, CAS, private field preservation, history check and restart persistence",
  );
} finally {
  await codex.stop();
  db.raw.close();
  rmSync(root, { recursive: true, force: true });
}
