import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database } from "../server/db.js";
import { executionPolicy } from "../server/execution-policy.js";
import { executionParameters } from "../shared/runtime-settings.js";
function fixture(
  fn: (
    p: ReturnType<typeof executionPolicy>,
    db: ReturnType<typeof database>,
    path: string,
  ) => void,
) {
  const path = mkdtempSync(join(tmpdir(), "newbot-mode-policy-")),
    db = database(path);
  try {
    fn(executionPolicy(db), db, path);
  } finally {
    db.raw.close();
    rmSync(path, { recursive: true, force: true });
  }
}
const config = {
  mcp_servers: { probe: { url: "https://example.test/mcp", enabled: true } },
  features: { hooks: true, code_mode: true },
  notify: ["sh", "-c", "touch forbidden"],
};
const tools = {
  read: { name: "read", inputSchema: { type: "object" } },
  lie: {
    name: "lie",
    inputSchema: { type: "object" },
    annotations: { readOnlyHint: true },
  },
};
test("a tool's read-only claim cannot authorize it; reviews bind receiver, schema and plugin version", () =>
  fixture((p) => {
    assert.throws(() =>
      p.assertTool("chat", config, "probe", "lie", tools.lie),
    );
    let view = p.catalog(config, "probe", tools);
    p.update(config, "probe", tools, view.revision, ["read"]);
    p.assertTool("chat", config, "probe", "read", tools.read);
    assert.throws(() =>
      p.assertTool("plan", config, "probe", "lie", tools.lie),
    );
    assert.throws(() =>
      p.assertTool("chat", config, "probe", "read", {
        ...tools.read,
        description: "changed",
      }),
    );
    assert.throws(() =>
      p.assertTool(
        "chat",
        {
          ...config,
          mcp_servers: { probe: { url: "https://elsewhere.test/mcp" } },
        },
        "probe",
        "read",
        tools.read,
      ),
    );
    assert.throws(() =>
      p.update(config, "probe", tools, view.revision, ["lie"]),
    );
    assert.throws(() =>
      p.update(
        config,
        "probe",
        tools,
        p.catalog(config, "probe", tools).revision,
        ["missing"],
      ),
    );
    const plugin = {
      ...config,
      newbot_plugin_connections: {
        probe: { pluginId: "p", packageDigest: "a" },
      },
      plugins: { p: { enabled: true, version: "v1" } },
    };
    view = p.catalog(plugin, "probe", tools);
    p.update(plugin, "probe", tools, view.revision, ["read"]);
    assert.throws(() =>
      p.assertTool(
        "chat",
        { ...plugin, plugins: { p: { enabled: true, version: "v2" } } },
        "probe",
        "read",
        tools.read,
      ),
    );
  }));
test("restriction overlay closes hooks, notify and executors; unknown connectors are disabled, work config unchanged", () =>
  fixture((p) => {
    const before = structuredClone(config);
    const view = p.catalog(config, "probe", tools);
    p.update(config, "probe", tools, view.revision, ["read"]);
    for (const mode of ["chat", "plan"] as const) {
      const effective = p.config(mode, {
        ...config,
        "features.hooks": true,
        "mcp_servers.probe.enabled_tools": ["lie"],
        mcp_servers: { ...config.mcp_servers, unknown: { command: "unsafe" } },
      });
      assert.equal(effective.features.hooks, false);
      assert.equal(effective.features.code_mode, false);
      assert.equal(effective.features.shell_tool, mode === "plan");
      assert.deepEqual(effective.notify, []);
      assert.equal(effective["features.hooks"], undefined);
      assert.deepEqual(effective.mcp_servers.probe.enabled_tools, ["read"]);
      assert.equal(effective.mcp_servers.unknown.enabled, false);
      assert.deepEqual(
        executionParameters(mode, "full", "/tmp").sandboxPolicy,
        { type: "readOnly", networkAccess: false },
      );
    }
    assert.deepEqual(config, before);
    assert.equal(p.config("work", config), config);
  }));
test("review removal is persistent and fail-closed across manager recreation", () =>
  fixture((p, db) => {
    const view = p.catalog(config, "probe", tools);
    p.update(config, "probe", tools, view.revision, ["read"]);
    executionPolicy(db).assertTool("chat", config, "probe", "read", tools.read);
    p.update(
      config,
      "probe",
      tools,
      p.catalog(config, "probe", tools).revision,
      [],
    );
    assert.equal(
      executionPolicy(db).config("chat", config).mcp_servers.probe.enabled,
      false,
    );
    assert.throws(() =>
      executionPolicy(db).assertTool("chat", config, "probe", "read"),
    );
  }));

test("v17 six-column sessions migrate to work without changing their saved settings",async()=>{
 const {DatabaseSync}=await import("node:sqlite");const path=mkdtempSync(join(tmpdir(),"newbot-mode-migration-"));
 try{
  const old=new DatabaseSync(join(path,"newbot.sqlite"));
  old.exec("CREATE TABLE threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,provider TEXT NOT NULL,updated INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0); CREATE TABLE session_runtime(thread_id TEXT PRIMARY KEY REFERENCES threads(id),revision INTEGER NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,effort TEXT NOT NULL,approval TEXT NOT NULL); INSERT INTO threads VALUES('old','History','gateway',1,0); INSERT INTO session_runtime VALUES('old',7,'gateway','model','high','full'); PRAGMA user_version=17;");old.close();
  let db=database(path);const saved=db.raw.prepare("SELECT * FROM session_runtime").get();assert.deepEqual({...saved},{thread_id:"old",revision:7,provider:"gateway",model:"model",effort:"high",approval:"full",mode:"work"});db.raw.close();
  db=database(path);assert.deepEqual(db.raw.prepare("SELECT * FROM session_runtime").get(),saved);db.raw.close();
 }finally{rmSync(path,{recursive:true,force:true});}
});
