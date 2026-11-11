// Isolated native protocol probe. Synthetic MCP + loopback Responses; no external services.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Codex } from "/home/a/Documents/ChatGPT/newbot/server/codex.ts";
import { database } from "/home/a/Documents/ChatGPT/newbot/server/db.ts";
import { credentialVault } from "/home/a/Documents/ChatGPT/newbot/server/credential-vault.ts";
import { ExtensionRuntime } from "/home/a/Documents/ChatGPT/newbot/server/extension-runtime.ts";
import { pluginConnections } from "/home/a/Documents/ChatGPT/newbot/server/plugin-connections.ts";
import { privateFields } from "/home/a/Documents/ChatGPT/newbot/server/private-fields.ts";
import { importTree } from "/home/a/Documents/ChatGPT/newbot/server/import-files.ts";

const root = await mkdtemp(join(tmpdir(), "newbot-plugin-adapter-")), work = join(root, "work"), market = join(root, "market"), home = join(root, "codex"), data = join(root, "data");
await mkdir(work); await mkdir(join(market, ".agents/plugins"), { recursive: true });
const db = database(data), vault = credentialVault(db, data, work), ext = new ExtensionRuntime(db), connections = pluginConnections(db, ext, vault);
const raw = { config: { plugins: {}, mcp_servers: {} }, origins: {}, layers: [] } as any;
ext.overlay(raw);
const c = new Codex(work, () => ({ CODEX_HOME: home }));
const evidence: any = { modelRequests: 0, synthetic: true };
const markers = ["synthetic-plugin-A-08397", "synthetic-plugin-B-12843", "synthetic-plugin-HTTP-91872"];
const manifests: any[] = [];
const requests: string[] = [];
const upstream = createServer(async (req, res) => {
  if (req.url === "/mcp" && req.method !== "POST") { res.writeHead(405); res.end(); return; }
  let body = ""; for await (const b of req) body += b;
  if (req.url === "/mcp") {
    const m = JSON.parse(body);
    if (m.id === undefined) { res.writeHead(202); res.end(); return; }
    const result = m.method === "initialize" ? { protocolVersion: m.params.protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: { name: "remote", version: "1" } }
      : m.method === "tools/list" ? { tools: [{ name: "inspect", description: "Synthetic check", inputSchema: { type: "object", properties: {} }, _meta: { ui: { resourceUri: "ui://fixture/view" } } }] }
      : m.method === "tools/call" ? { content: [{ type: "text", text: JSON.stringify({ owner: "remote", matched: req.headers.authorization === `Bearer ${markers[2]}` && req.headers["x-plugin-key"] === markers[2] }) }] }
      : m.method === "resources/read" ? { contents: [{ uri: "ui://fixture/view", mimeType: "text/html;profile=mcp-app", text: "<!doctype html><p>remote</p>" }] }
      : { resources: [], resourceTemplates: [], prompts: [] };
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result })); return;
  }
  requests.push(body);
  const id = "resp_" + randomUUID(), mid = "msg_" + randomUUID();
  const msg = { id: mid, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "SYNTHETIC_OK", annotations: [] }] };
  const response = { id, object: "response", created_at: 1, status: "completed", model: "gpt-6.1-sol", output: [msg], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const e of [{ type: "response.created", response: { ...response, status: "in_progress", output: [] } }, { type: "response.output_item.added", output_index: 0, item: { ...msg, content: [], status: "in_progress" } }, { type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: mid, delta: "SYNTHETIC_OK" }, { type: "response.output_item.done", output_index: 0, item: msg }, { type: "response.completed", response }]) res.write("data: " + JSON.stringify(e) + "\n\n");
  res.end();
});
await new Promise<void>(r => upstream.listen(0, "127.0.0.1", r));
try {
  for (const [i, name] of ["first", "second"].entries()) {
    const dir = join(market, name);
    await mkdir(join(dir, ".codex-plugin"), { recursive: true });
    await mkdir(join(dir, "skills", "check"), { recursive: true });
    await writeFile(join(dir, "skills/check/SKILL.md"), "---\nname: check\ndescription: Synthetic plugin skill\n---\nUse this plugin's inspect tool.");
    await writeFile(join(dir, ".codex-plugin/plugin.json"), JSON.stringify({ name, version: "1.0.0", skills: "./skills", mcpServers: "./.mcp.json", extensions: { "io.newbot": { version: 1, mcpConfigs: { same: "./settings.json" } } } }));
    const def = { command: process.execPath, args: ["${PLUGIN_ROOT}/server.cjs"], env: { SYNTHETIC_URL: "${user_config.url}", SYNTHETIC_KEY: "${user_config.key}" } };
    await writeFile(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { same: def } }));
    await writeFile(join(dir, "settings.json"), JSON.stringify({ server: { mcp_config: def }, user_config: { url: { type: "string", title: "URL", required: true }, key: { type: "string", title: "Key", required: true, sensitive: true } } }));
    await writeFile(join(dir, "server.cjs"), `const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}if(m.id===undefined)return;const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{},resources:{}},serverInfo:{name:'${name}',version:'1'}}:m.method==='tools/list'?{tools:[{name:'inspect',description:'Synthetic check',inputSchema:{type:'object',properties:{}},_meta:{ui:{resourceUri:'ui://fixture/view'}}}]}:m.method==='tools/call'?{content:[{type:'text',text:JSON.stringify({owner:'${name}',matched:process.env.SYNTHETIC_KEY==='${markers[i]}'&&process.env.SYNTHETIC_URL==='https://${name}.example'})}]}:m.method==='resources/read'?{contents:[{uri:'ui://fixture/view',mimeType:'text/html;profile=mcp-app',text:'<!doctype html><p>${name}</p>'}]}:m.method==='resources/list'?{resources:[{uri:'ui://fixture/view',name:'fixture',mimeType:'text/html;profile=mcp-app'}]}:{resources:[],prompts:[],resourceTemplates:[]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n')});`);
    const tree = await importTree(dir);
    db.raw.prepare("INSERT INTO extension_packages VALUES(?,?,?,?,?,?)").run(name, "plugin", name, dir, tree.digest, JSON.stringify({ installed: true, mcp: ["same"] }));
    ext.setPlugin(`${name}@newbot-imports`, true, true);
    manifests.push({ name, source: { source: "local", path: `./${name}` } });
  }
  {
    const dir = join(market, "remote"); await mkdir(join(dir, ".codex-plugin"), { recursive: true });
    await writeFile(join(dir, ".codex-plugin/plugin.json"), JSON.stringify({ name: "remote", version: "1.0.0", mcpServers: "./.mcp.json", extensions: { "io.newbot": { version: 1, mcpConfigs: { same: "./settings.json" } } } }));
    const def = { url: "${user_config.url}", headers: { Authorization: "Bearer ${user_config.key}", "X-Plugin-Key": "${user_config.key}" } };
    await writeFile(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { same: def } }));
    await writeFile(join(dir, "settings.json"), JSON.stringify({ server: { mcp_config: def }, user_config: { url: { type: "string", title: "URL", required: true }, key: { type: "string", title: "Key", sensitive: true, required: true } } }));
    const tree = await importTree(dir);
    db.raw.prepare("INSERT INTO extension_packages VALUES(?,?,?,?,?,?)").run("remote", "plugin", "remote", dir, tree.digest, JSON.stringify({ installed: true, mcp: ["same"] }));
    ext.setPlugin("remote@newbot-imports", true, true);
    manifests.push({ name: "remote", source: { source: "local", path: "./remote" } });
  }
  const manifest = join(market, ".agents/plugins/marketplace.json");
  await writeFile(manifest, JSON.stringify({ name: "newbot-imports", plugins: manifests }));
  db.set("imports:marketplace", market);
  await c.start(); assert.equal(c.state, "ready");
  for (const m of manifests) await c.call("plugin/install", { marketplacePath: manifest, pluginName: m.name });
  async function overlay() { return connections.overlay(ext.overlay(await c.call("config/read", { cwd: work, includeLayers: true }))); }
  const fields = privateFields(db, vault, { read: async () => ({ response: await overlay() }) } as any);
  c.privateConfiguration = fields.inject; c.privateVersion = fields.version;
  for (const [i, m] of manifests.entries()) {
    const pluginId = `${m.name}@newbot-imports`, view = (await connections.list(pluginId))[0];
    const consumer = await connections.prepare({ operation: "plugin.configuration.save", requestId: randomUUID(), pluginId, connectionId: view.id, expectedRevision: view.revision, schemaDigest: view.schemaDigest, values: { url: m.name === "remote" ? `http://127.0.0.1:${(upstream.address() as any).port}/mcp` : `https://${m.name}.example` }, enabled: true, clearSecrets: [] });
    const bytes = Buffer.from(Buffer.from(JSON.stringify({ key: markers[i] })).toString("base64"));
    await consumer.run(bytes, new AbortController().signal, () => true, () => {}); bytes.fill(0);
  }
  async function start() {
    const response = await overlay(), config = ext.config(response);
    for (const marker of markers) assert.ok(!JSON.stringify(config).includes(marker));
    const t = await c.call("thread/start", { cwd: work, config });
    let servers = (await c.call("mcpServerStatus/list", { threadId: t.thread.id, detail: "full", limit: 100 })).data;
    for (let n = 0; n < 40 && servers.some(s => ["notStarted", "starting"].includes(s.runtimeStatus || "")); n++) {
      await new Promise(r => setTimeout(r, 100));
      servers = (await c.call("mcpServerStatus/list", { threadId: t.thread.id, detail: "full", limit: 100 })).data;
    }
    return { threadId: t.thread.id, servers, config };
  }
  const first = await start();
  const adapted = first.servers.filter(s => s.name.startsWith("plugin_"));
  assert.equal(adapted.length, 3, JSON.stringify(first.servers.map(s => ({ name: s.name, status: s.runtimeStatus, error: s.toolsError }))));
  evidence.connectors = [];
  for (const s of adapted) {
    assert.equal(s.runtimeStatus, "connected", JSON.stringify(s));
    const owner = connections.owner(s.name); assert.ok(owner);
    const result = await c.call("mcpServer/tool/call", { threadId: first.threadId, server: s.name, tool: "inspect", arguments: {} });
    const output = JSON.parse((result as any).content?.[0]?.text || (result as any).result?.content?.[0]?.text || "null");
    assert.equal(output?.matched, true, JSON.stringify(result));
    const resource = await c.call("mcpServer/resource/read", { threadId: first.threadId, server: s.name, uri: "ui://fixture/view" });
    assert.ok(JSON.stringify(resource).includes("text/html;profile=mcp-app"));
    evidence.connectors.push({ name: s.name, owner, nativePluginId: s.pluginId, connected: true, privateParametersMatched: true, appResource: true });
  }
  assert.ok(!first.servers.some(s => !s.name.startsWith("plugin_") && s.runtimeStatus === "connected"), "must not start a duplicate native connector");
  ext.setPlugin("first@newbot-imports", false, true);
  const second = await start();
  assert.equal(second.servers.filter(s => s.runtimeStatus === "connected").length, 2, JSON.stringify({ servers: second.servers.map(s => ({ name: s.name, state: s.runtimeStatus, error: s.toolsError })), definitions: Object.entries(second.config.mcp_servers).map(([name, def]: any) => [name, def.enabled]) }));
  const originalResult = await c.call("mcpServer/tool/call", { threadId: first.threadId, server: adapted[0].name, tool: "inspect", arguments: {} });
  assert.ok(JSON.stringify(originalResult).includes('matched'));
  evidence.nextTurnDisable = true; evidence.originalThreadUnaffected = true;
  const skills = await c.call("skills/list", { cwds: [work], forceReload: true });
  const skill = skills.data.flatMap(d => d.skills).find(s => s.pluginId === "second@newbot-imports");
  assert.ok(skill, "native plugin skills retained");
  ext.setSkill(skill.path, false);
  const third = await start();
  const scoped = await c.call("skills/list", { cwds: [work], forceReload: true });
  evidence.nativeSkillsRetained = !!scoped.data.flatMap(d => d.skills).find(s => s.pluginId === "second@newbot-imports");
  assert.equal(third.config.skills.config.find((s: any) => s.path === skill.path)?.enabled, false);
  evidence.skillDisableInThreadConfiguration = true;
  const modelConfig = { ...third.config, model_providers: { probe: { name: "Local synthetic", base_url: `http://127.0.0.1:${(upstream.address() as any).port}/v1`, wire_api: "responses", requires_openai_auth: false } } };
  const modelThread = await c.call("thread/start", { cwd: work, config: modelConfig, model: "gpt-6.1-sol", modelProvider: "probe" });
  const done = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { c.off("event", listener); reject(Error("synthetic model turn timeout")); }, 12000);
    const listener = (event: any) => { if (event.method === "turn/completed" && event.params.threadId === modelThread.thread.id) { clearTimeout(timer); c.off("event", listener); resolve(event.params); } };
    c.on("event", listener);
  });
  await c.call("turn/start", { threadId: modelThread.thread.id, input: [{ type: "text", text: "Use this plugin. Reply briefly.", text_elements: [] }, { type: "mention", name: "second", path: "plugin://second@newbot-imports" }] });
  await done;
  assert.ok(requests.length > 0);
  for (const marker of markers) assert.ok(requests.every(body => !body.includes(marker)), "secrets must not enter model requests");
  assert.ok(requests.every(body => !body.includes("second:check")), "disabled plugin skill must not enter model capabilities");
  evidence.modelRequests = requests.length;
  evidence.disabledSkillAbsentFromModelRequest = true;
  evidence.noSecretsInModelRequests = true;
  ext.setSkill(skill.path, true);
  const enabledThread = await c.call("thread/start", { cwd: work, config: { ...ext.config(await overlay()), model_providers: modelConfig.model_providers }, model: "gpt-6.1-sol", modelProvider: "probe" });
  const enabledDone = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => { c.off("event", listener); reject(Error("enabled skill turn timeout")); }, 12000);
    const listener = (event: any) => { if (event.method === "turn/completed" && event.params.threadId === enabledThread.thread.id) { clearTimeout(timer); c.off("event", listener); resolve(event.params); } };
    c.on("event", listener);
  });
  const priorRequests = requests.length;
  await c.call("turn/start", { threadId: enabledThread.thread.id, input: [{ type: "text", text: "Use this plugin. Reply briefly.", text_elements: [] }, { type: "mention", name: "second", path: "plugin://second@newbot-imports" }] });
  await enabledDone;
  assert.ok(requests.slice(priorRequests).some(body => body.includes("second:check")), "enabled plugin skill must enter actual model capabilities");
  for (const marker of markers) assert.ok(requests.every(body => !body.includes(marker)));
  evidence.enabledSkillInModelRequest = true;
  evidence.modelRequests = requests.length;
  await c.stopAndWait();
  async function scan(path: string) {
    for (const e of await readdir(path, { withFileTypes: true })) {
      const p = join(path, e.name);
      if (e.isDirectory()) { if (e.name !== "plugins") await scan(p); }
      else if (!e.isSymbolicLink()) for (const marker of markers) assert.ok(!(await readFile(p)).includes(Buffer.from(marker)), `secret in ${p.replace(root, "<probe>")}`);
    }
  }
  await scan(home);
  evidence.noSecretsInNativeState = true;
  console.log(JSON.stringify(evidence, null, 2));
} finally { await c.stopAndWait(); upstream.closeAllConnections(); await new Promise<void>(r => upstream.close(() => r())); vault.close(); db.raw.close(); await rm(root, { recursive: true, force: true }); }
