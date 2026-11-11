// Read-only API/build verification; this does not substitute for browser QA.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const origin = "http://127.0.0.1:3100";
const password = (await readFile(".data/initial-password", "utf8")).trim();
const login = await fetch(origin + "/api/login", {
  method: "POST",
  headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ password }),
  signal: AbortSignal.timeout(15000),
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
async function request(path, body) {
  const response = await fetch(origin + path, {
    method: body ? "POST" : "GET",
    headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200, path);
  return response.json();
}
const capabilities = await request("/api/runtime/capabilities");
assert.equal(capabilities.version, "codex-cli 0.165.0");
assert.equal(capabilities.capabilities.plugins.upgrades.importedPackages, true);
const settings = await request("/api/config");
const standaloneConnectors = settings.configuration.mcp.map((m) => m.id);
const list = await request("/api/agent/action", { action: "plugin/list" });
assert.equal(list.available, true);
const details = [];
for (const plugin of list.entries.filter((p) => p.installed)) {
  const detail = await request("/api/agent/action", { action: "plugin/read", id: plugin.id });
  for (const connection of detail.connections || []) {
    assert.equal(connection.source, "package");
    assert.ok(!standaloneConnectors.includes(connection.id));
  }
  details.push({
    id: detail.id, version: detail.version, update: detail.update,
    skills: detail.skills.map(({ name, enabled }) => ({ name, enabled })),
    connections: detail.connections.map((c) => ({ name: c.name, source: c.source, fields: c.fields.map((f) => f.id) })),
  });
}
const share = JSON.parse(await readFile(".data/public-share.json", "utf8"));
const diskHtml = await readFile("dist/web/index.html", "utf8");
const asset = /src="([^"]+\.js)"/.exec(diskHtml)?.[1];
assert.ok(asset);
const digest = (b) => createHash("sha256").update(b).digest("hex");
for (const base of [origin, share.url]) {
  const html = await fetch(base, { signal: AbortSignal.timeout(30000) });
  assert.equal(html.status, 200);
  assert.equal(await html.text(), diskHtml);
  const js = await fetch(base + asset, { signal: AbortSignal.timeout(30000) });
  assert.equal(js.status, 200);
  assert.equal(digest(Buffer.from(await js.arrayBuffer())), digest(await readFile("dist/web" + asset)));
}
const manifest = JSON.parse(await readFile("dist/web/.vite/manifest.json", "utf8"));
const activePluginChunk = Object.entries(manifest).find(([name]) => name.endsWith("ToolsSettings.tsx"))?.[1]?.file;
assert.ok(activePluginChunk);
const chunk = await readFile("dist/web/" + activePluginChunk, "utf8");
assert.ok(!chunk.includes("工具连接"));
assert.ok(chunk.includes("确认升级"));
const publicChunk = await fetch(share.url + "/" + activePluginChunk, { signal: AbortSignal.timeout(30000) });
assert.equal(publicChunk.status, 200);
assert.equal(await publicChunk.text(), chunk);
const result = {
  at: new Date().toISOString(), asset, publicBuildMatches: true, activePluginChunk,
  oldCopyAbsent: true, standaloneConnectors, details,
  uiVerification: "API + referenced build only; Work browser control disabled",
  businessToolsCalled: 0,
};
await writeFile(".issue/2026-11-10/evidence-plugin-lifecycle/live-readback.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ at: result.at, publicBuildMatches: true, standaloneConnectors, installedPlugins: details.length }));
