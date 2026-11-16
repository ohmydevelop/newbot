import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database } from "../server/db";
import { experts } from "../server/experts";

test("expert connector names follow configuration while stable references survive rename, duplicates and restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-expert-names-"));
  let db = database(dir);
  const connectors = [
    { id: "connector_opaque_a", name: "牧云", enabled: true },
    { id: "connector_opaque_b", name: "牧云", enabled: true },
  ];
  const config = { read: async () => ({ publicView: { mcp: connectors } }) };
  const service = () =>
    experts(
      db,
      { list: async () => ({ skills: [] }) } as any,
      { list: async () => ({ entries: [] }) } as any,
      config as any,
    );
  try {
    let api = service();
    assert.deepEqual((await api.list()).catalog.connectors, connectors);
    const saved = await api.save({
      name: "调查专家",
      description: "",
      instructions: "",
      skillIds: [],
      pluginIds: [],
      connectorIds: [connectors[0].id],
    });
    connectors[0].name = "牧云生产环境";
    connectors[0].enabled = false;
    const renamed = await api.list();
    assert.equal(renamed.catalog.connectors[0].name, "牧云生产环境");
    assert.deepEqual(renamed.entries[0].connectorIds, ["connector_opaque_a"]);
    assert.deepEqual(renamed.entries[0].problems, [
      "连接器“牧云生产环境”已停用",
    ]);
    db.raw.close();
    db = database(dir);
    api = service();
    assert.deepEqual((await api.read(saved.id)).connectorIds, [
      "connector_opaque_a",
    ]);
    connectors.splice(0, 1);
    const missing = await api.read(saved.id);
    assert.equal(missing.available, false);
    assert.match(missing.problems[0], /已移除/);
    assert.deepEqual(missing.connectorIds, ["connector_opaque_a"]);
  } finally {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
