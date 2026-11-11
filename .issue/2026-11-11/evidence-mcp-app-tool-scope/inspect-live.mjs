// Read current state and request/cancel an App grant. Never approve or call a business tool.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const origin = 'http://127.0.0.1:3100';
const password = (await readFile('.data/initial-password', 'utf8')).trim();
const login = await fetch(origin + '/api/login', {method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})});
assert.equal(login.status, 200);
const cookie = login.headers.get('set-cookie').split(';')[0];
async function request(path, body) {
  const r = await fetch(origin + path, {method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
  return {status:r.status, body:await r.json()};
}
const db = new DatabaseSync('.data/minimal-agent.sqlite', {readOnly:true});
const detail = await request('/api/agent/action',{action:'plugin/read',id:'cloudwalker@newbot-imports'});
assert.equal(detail.status,200);
const caps = await request('/api/runtime/capabilities');
let source;
for (const row of db.prepare('SELECT id FROM threads WHERE archived=0 ORDER BY updated DESC LIMIT 8').all()) {
  const thread = await request('/api/threads/'+encodeURIComponent(row.id));
  assert.equal(thread.status,200);
  for (const turn of [...(thread.body.turns||[])].reverse()) {
    const item = turn.items.find(i=>i.type==='mcpToolCall' && i.tool==='open_security_workspace' && i.status==='completed' && i.result && !i.error);
    if (item) {source={threadId:row.id,turnId:turn.id,itemId:item.id,server:item.server,tool:item.tool};break;}
  }
  if (source) break;
}
assert.ok(source,'No completed workbench source in recent history');
const opened = await request('/api/mcp-apps/open',{threadId:source.threadId,turnId:source.turnId,itemId:source.itemId,requestId:randomUUID()});
assert.equal(opened.status,200);
let grant;
try {
  grant = await request('/api/mcp-apps/call-request',{token:opened.body.token,tool:'list_business_groups',arguments:{limit:100,offset:0,profile:'default'}});
  if (grant.body.grant) assert.equal((await request('/api/mcp-apps/call-cancel',{grant:grant.body.grant})).status,200);
} finally { assert.equal((await request('/api/mcp-apps/close',{token:opened.body.token})).status,200); }
const share = JSON.parse(await readFile('.data/public-share.json','utf8'));
const disk = await readFile('dist/web/index.html','utf8');
const publicHtml = await (await fetch(share.url,{signal:AbortSignal.timeout(30000)})).text();
const localHtml = await (await fetch(origin)).text();
const digest = s => createHash('sha256').update(s).digest('hex');
const asset = /src="([^"]+\.js)"/.exec(disk)?.[1];
assert.ok(asset);
const manifest = JSON.parse(await readFile('dist/web/.vite/manifest.json','utf8'));
const appChunk = Object.entries(manifest).find(([name])=>name.endsWith('McpApp.tsx'))?.[1]?.file;
assert.ok(appChunk);
for (const path of [asset, '/'+appChunk]) {
  const expected = digest(await readFile('dist/web'+path));
  for (const base of [origin,share.url]) {
    const response = await fetch(base+path,{signal:AbortSignal.timeout(30000)});
    assert.equal(response.status,200);
    assert.equal(digest(Buffer.from(await response.arrayBuffer())),expected);
  }
}
const result = {
  at:new Date().toISOString(), version:caps.body.version, pid:JSON.parse(await readFile('.data/newbot-test.pid','utf8')).pid,
  asset, appChunk, publicAssetsMatch:true, publicHtmlMatches:digest(publicHtml)===digest(disk),localHtmlMatches:digest(localHtml)===digest(disk),
  plugin:{id:detail.body.id,version:detail.body.version,connections:detail.body.connections.map(c=>({id:c.id,name:c.name,configured:c.configured,enabled:c.enabled}))},
  source, appTools:opened.body.tools, policy:opened.body.hostPolicy,
  grant:{status:grant.status,accepted:!!grant.body.grant,...(grant.status!==200?{error:grant.body.error,appIssue:grant.body.appIssue}:{cancelled:true})},
  businessToolsApproved:0,businessToolsCalled:0,uiVerification:'Browser control disabled in Work settings; API verification only'
};
db.close();
await writeFile(process.env.APP_SCOPE_EVIDENCE || '.issue/2026-11-11/evidence-mcp-app-tool-scope/live-before.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
