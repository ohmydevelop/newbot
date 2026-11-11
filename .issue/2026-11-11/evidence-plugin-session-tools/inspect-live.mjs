import { readFile, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const origin='http://127.0.0.1:3100';
const password=(await readFile('.data/initial-password','utf8')).trim();
const login=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({password})});
assert.equal(login.status,200);
const cookie=login.headers.get('set-cookie').split(';')[0];
async function api(path,body){const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});assert.equal(r.status,200,path);return r.json();}
const db=new DatabaseSync('.data/minimal-agent.sqlite',{readOnly:true});
const recent=db.prepare('SELECT id,updated FROM threads WHERE archived=0 ORDER BY updated DESC LIMIT 4').all();
const errorTags=value=>['unsupported call','tls_certificate','certificate validation failed','tool not found','Unknown tool','not supported'].filter(s=>JSON.stringify(value).includes(s));
const threads=[];
for(const row of recent){
  const thread=await api('/api/threads/'+encodeURIComponent(row.id));
  const workspace=db.prepare('SELECT root,revision,snapshot FROM thread_workspaces WHERE thread_id=?').get(row.id);
  const snapshot=workspace?JSON.parse(workspace.snapshot):{};
  threads.push({id:row.id,updated:row.updated,status:thread.status,turnCount:thread.turns?.length,workspace:workspace?.root,revision:workspace?.revision,
    servers:Object.entries(snapshot.config?.mcp_servers||{}).map(([name,v])=>({name,enabled:v.enabled,commandBasename:v.command?.split('/').at(-1),envNames:Object.keys(v.env||{}),envVarNames:v.env_vars})),
    pluginIds:Object.entries(snapshot.config?.plugins||{}).map(([id,v])=>({id,enabled:v.enabled})),
    turns:thread.turns?.slice(-5).map(t=>({id:t.id,status:t.status,items:t.items.map(i=>({id:i.id,type:i.type,server:i.server,tool:i.tool,namespace:i.namespace,status:i.status,argumentKeys:i.arguments&&typeof i.arguments==='object'?Object.keys(i.arguments):undefined,errorTags:errorTags(i),...(i.type==='agentMessage'?{characters:i.text?.length}:{}),fields:Object.keys(i)}))}))});
}
const list=await api('/api/agent/action',{action:'plugin/list'});
const entries=[];
for(const p of list.entries.filter(p=>p.installed)){
 const detail=await api('/api/agent/action',{action:'plugin/read',id:p.id});
 entries.push({id:p.id,version:detail.version,enabled:p.enabled,connections:detail.connections?.map(c=>({id:c.id,name:c.name,enabled:c.enabled,configured:c.configured,fields:c.fields?.map(f=>({id:f.id,sensitive:f.sensitive})),revision:c.revision,schemaDigest:c.schemaDigest}))});
}
const hash=x=>createHash('sha256').update(x).digest('hex');
const share=JSON.parse(await readFile('.data/public-share.json','utf8'));
const disk=await readFile('dist/web/index.html','utf8');
const asset=/src="([^"]+\.js)"/.exec(disk)?.[1];
const publicHtml=await (await fetch(share.url,{signal:AbortSignal.timeout(15000)})).text();
const caps=await api('/api/runtime/capabilities');
const result={at:new Date().toISOString(),version:caps.version,pid:JSON.parse(await readFile('.data/newbot-test.pid','utf8')).pid,asset,publicHtmlMatches:hash(publicHtml)===hash(disk),entries,threads};
db.close();await writeFile('.issue/2026-11-11/evidence-plugin-session-tools/live-summary.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
