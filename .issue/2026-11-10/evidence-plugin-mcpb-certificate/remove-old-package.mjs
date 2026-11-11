// User-authorized removal of the retired package from this test instance only.
import assert from "node:assert/strict";
import { readFile, writeFile, rename, rm, readdir } from "node:fs/promises";
import { resolve, dirname, basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
const root = process.cwd(), origin = "http://127.0.0.1:3100", pluginId = "cloudwalker@newbot-imports";
const password = (await readFile(".data/initial-password", "utf8")).trim();
const response = await fetch(origin + "/api/login", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
assert.equal(response.status, 200);
const cookie = response.headers.get("set-cookie").split(";")[0];
async function control(action, params = {}) {
  const response = await fetch(origin + "/api/agent/action", { method: "POST", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ action, ...params }), signal: AbortSignal.timeout(30000) });
  const result = await response.json(); assert.equal(response.status, 200, result.error || action); return result;
}
const list = await control("plugin/list");
assert.ok(!list.entries.find((p) => p.id === pluginId)?.installed, "uninstall through the native API first");
await control("bridge/maintenance", { enabled: true });
const db = new DatabaseSync(resolve(".data/minimal-agent.sqlite"));
try {
  const rows = db.prepare("SELECT id,path,content FROM extension_packages WHERE kind='plugin' AND name='cloudwalker'").all();
  const folders = new Set();
  for (const row of rows) {
    assert.equal(JSON.parse(row.content).installed, false);
    const directory = dirname(resolve(row.path));
    assert.equal(dirname(directory), resolve(".data/imports/marketplace/packages"));
    assert.match(basename(directory), /^[a-f0-9]{64}$/);
    folders.add(directory);
  }
  const connection = "plugin_" + createHash("sha256").update(JSON.stringify([pluginId, "cloudwalker"])).digest("hex").slice(0, 32);
  assert.equal(db.prepare("SELECT count(*) n FROM plugin_connection_settings WHERE plugin_id=?").get(pluginId).n, 0);
  assert.equal(db.prepare("SELECT count(*) n FROM private_field_sets WHERE target=?").get(connection).n, 0);
  const marketPath = resolve(".data/imports/marketplace/.agents/plugins/marketplace.json");
  const market = JSON.parse(await readFile(marketPath, "utf8"));
  market.plugins = market.plugins.filter((p) => p.name !== "cloudwalker");
  await writeFile(marketPath + ".tmp", JSON.stringify(market), { mode: 0o600 });
  await rename(marketPath + ".tmp", marketPath);
  db.prepare("DELETE FROM extension_packages WHERE kind='plugin' AND name='cloudwalker'").run();
  for (const folder of folders) await rm(folder, { recursive: true, force: true });
  await rm(resolve(".data/codex/plugins/cache/newbot-imports/cloudwalker"), { recursive: true, force: true });
  const retiredArchives = (await readdir(resolve(".data/import-ready")).catch(() => []))
    .filter((name) => /^cloudwalker-0\.5\.[01](?:-|\.).*\.zip$/.test(name));
  for (const name of retiredArchives) await rm(resolve(".data/import-ready", name));
  const result = { at: new Date().toISOString(), pluginId, packageRecordsRemoved: rows.length,
    activePackageRootsRemoved: folders.size, nativeCacheRemoved: true, retiredArchivesRemoved: retiredArchives,
    configurationAndPrivateBindingsRemoved: true, otherMarketEntries: market.plugins.map((p) => p.name) };
  await writeFile(resolve(".issue/2026-11-10/evidence-plugin-mcpb-certificate/removal.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { db.close(); await control("bridge/maintenance", { enabled: false }); }
