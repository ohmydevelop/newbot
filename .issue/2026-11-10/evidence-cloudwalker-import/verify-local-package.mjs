// Run from repository root: node --import tsx .issue/2026-11-10/evidence-cloudwalker-import/verify-local-package.mjs
// Installs only in a disposable isolated Codex home; no model turn or business tool call.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { Codex } from "../../../server/codex.ts";
import { extractImportZip } from "../../../server/import-files.ts";
import { scanNativeImport } from "../../../server/import-native.ts";

for (const key of Object.keys(process.env))
  if (key.startsWith("CLOUDWALKER_")) delete process.env[key];
const evidence = resolve(".issue/2026-11-10/evidence-cloudwalker-import");
const source = "/home/a/Documents/ChatGPT/newapp/dist/cloudwalker-0.5.0-linux-amd64.zip";
const root = await mkdtemp(join(tmpdir(), "newbot-cloudwalker-compatible-"));
const home = join(root, "codex"), work = join(root, "work"), market = join(root, "market");
const plugin = join(market, "packages/cloudwalker");
const cache = join(home, "plugins/cache/newbot-imports/cloudwalker/0.5.0");
const archive = join(root, "compatible.zip");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const report = { codex: "0.165.0", realInstallation: false, modelTurns: 0, businessCalls: 0 };
let codex;
try {
  await mkdir(plugin, { recursive: true });
  await mkdir(work);
  await promisify(execFile)("python3", [join(evidence, "prepare-local-package.py"), source, cache, archive]);
  const extracted = await extractImportZip(archive, plugin);
  const scan = await scanNativeImport(plugin, join(root, "scan"), "CloudWalker local compatibility");
  assert.equal(scan.length, 1);
  assert.deepEqual(scan[0].mcp, ["cloudwalker"]);
  assert.equal(scan[0].skills.length, 2);
  assert.equal(scan[0].blocked, undefined);
  report.scan = { files: extracted.files.length, skills: scan[0].skills.map(s => s.name), mcp: scan[0].mcp };
  const manifest = join(market, ".agents/plugins/marketplace.json");
  await mkdir(join(market, ".agents/plugins"), { recursive: true });
  await writeFile(manifest, JSON.stringify({ name: "newbot-imports", plugins: [{ name: "cloudwalker", source: { source: "local", path: "./packages/cloudwalker" } }] }));
  codex = new Codex(work, () => ({ CODEX_HOME: home }));
  await codex.start();
  assert.equal(codex.state, "ready");
  await codex.call("plugin/install", { marketplacePath: manifest, pluginName: "cloudwalker" });
  assert.equal(hash(await readFile(join(cache, "bin/linux-amd64/cloudwalker-mcp"))), hash(await readFile(join(plugin, "bin/linux-amd64/cloudwalker-mcp"))));
  assert.ok((await stat(join(cache, "bin/linux-amd64/cloudwalker-mcp"))).mode & 0o100);
  async function inspect() {
    const thread = await codex.call("thread/start", { cwd: work, ephemeral: true, config: { plugins: { "cloudwalker@newbot-imports": { enabled: true } } } });
    const servers = await codex.call("mcpServerStatus/list", { threadId: thread.thread.id, limit: 100, detail: "full" });
    const server = servers.data.find(s => s.name === "cloudwalker");
    assert.ok(server);
    assert.equal(server.runtimeStatus, "connected");
    assert.equal(server.toolsError, null);
    assert.equal(Object.keys(server.tools).length, 7);
    const ui = server.tools.open_security_workspace._meta?.ui?.resourceUri;
    assert.ok(typeof ui === "string" && ui.startsWith("ui://"));
    const resource = await codex.call("mcpServer/resource/read", { threadId: thread.thread.id, server: server.name, uri: ui });
    const content = resource.contents.find(c => c.text && c.mimeType?.startsWith("text/html"));
    assert.ok(content?.text.includes("<html"));
    const skills = (await codex.call("skills/list", { cwds: [work], forceReload: true })).data.flatMap(d => d.skills).filter(s => s.pluginId === "cloudwalker@newbot-imports");
    assert.equal(skills.length, 2);
    assert.ok(skills.every(s => s.enabled));
    return { status: server.runtimeStatus, tools: Object.keys(server.tools).sort(), ui: { uri: ui, mimeType: content.mimeType, bytes: Buffer.byteLength(content.text) }, enabledSkills: skills.map(s => s.name).sort() };
  }
  report.firstStart = await inspect();
  await codex.stopAndWait();
  codex = new Codex(work, () => ({ CODEX_HOME: home }));
  await codex.start();
  report.afterRestart = await inspect();
  assert.deepEqual(report.afterRestart, report.firstStart);
  report.binaryUnchanged = true;
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = String(error);
  throw error;
} finally {
  await codex?.stopAndWait();
  await rm(root, { recursive: true, force: true });
  await writeFile(join(evidence, "local-package-verification.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}
