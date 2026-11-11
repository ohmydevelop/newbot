import { test } from "node:test";
import assert from "node:assert/strict";
import { sessionExtensions } from "../server/session-extensions.js";

test("only explicitly selected plugins contribute skills, MCP and native hook activation", async () => {
  const config = { plugins: { "alpha@market": { enabled: true }, "beta@market": { enabled: true } }, skills: { config: [] }, mcp_servers: { alpha_tool: { enabled: true }, beta_tool: { enabled: true }, standalone: { enabled: true } }, newbot_plugin_connections: { alpha_tool: { pluginId: "alpha@market" }, beta_tool: { pluginId: "beta@market" } } };
  const entries = ["alpha", "beta"].map((name) => ({ id: `${name}@market`, version: "1.0", enabled: true, installed: true, available: true }));
  const core = { read: async () => ({ response: {} }), extensions: { revision: "one", snapshot: () => ({ revision: "one" }), config: () => structuredClone(config) } };
  const library = { list: async () => ({ skills: entries.map((p) => ({ id: p.id, path: `/isolated/${p.id}/skills/SKILL.md`, pluginId: p.id, enabled: true })) }) };
  const extensions = sessionExtensions({} as any, {} as any, core as any, library as any, { list: async () => ({ entries }) } as any);
  const none = (await extensions.capture())!;
  assert.ok(Object.values(none.config.plugins).every((p: any) => p.enabled === false));
  assert.ok(none.config.skills.config.every((s: any) => s.enabled === false));
  assert.equal(none.config.mcp_servers.alpha_tool.enabled, false);
  assert.equal(none.config.mcp_servers.standalone.enabled, true);
  const selected = (await extensions.capture(["alpha@market"]))!;
  assert.equal(selected.config.plugins["alpha@market"].enabled, true, "native plugin activation also controls its hooks");
  assert.equal(selected.config.plugins["beta@market"].enabled, false);
  assert.deepEqual(selected.activePlugins, [{ id: "alpha@market", version: "1.0" }]);
  assert.deepEqual(selected.disabledPluginIds, ["beta@market"]);
  assert.equal(selected.config.mcp_servers.alpha_tool.enabled, true);
  assert.equal(selected.config.mcp_servers.beta_tool.enabled, false);
  assert.ok(selected.config.skills.config.find((s: any) => s.path.includes("alpha")).enabled);
  entries[0].enabled = false;
  await assert.rejects(extensions.capture(["alpha@market"]), /停用/);
});
