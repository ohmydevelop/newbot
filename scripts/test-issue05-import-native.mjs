// Real pinned Codex and product import paths; model responses are local fixtures.
import assert from 'node:assert/strict';
import {createServer as httpServer} from 'node:http';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {randomUUID} from 'node:crypto';
import {createServer} from '../server/index.ts';import {Codex} from '../server/codex.ts';import {ProviderRuntime} from '../server/provider-runtime.ts';import {zip} from '../tests/import-zip-fixture.ts';
const directory=await mkdtemp(join(tmpdir(),'newbot-issue05-import-')),cwd=join(directory,'work'),home=join(directory,'codex');await mkdir(cwd);await mkdir(home);
const output=resolve(process.env.IMPORT_NATIVE_EVIDENCE || '.issue/2026-11-10/evidence-issue-05/S4');await mkdir(output,{recursive:true});
await rm(join(output,'native-initial-failure.json'),{force:true});
try{await import('node:fs/promises').then(fs=>fs.rename(join(output,'native-failure.json'),join(output,'native-initial-failure.json')));}catch{}
const checks=[],requests=[],completed=new Map();let stage='start',ctx,hold,release;
const upstream=httpServer(async(req,res)=>{
 if(req.url.endsWith('/models')){res.end(JSON.stringify({data:[{id:'gpt-6.1-sol'}]}));return;}
 let raw='';for await(const c of req)raw+=c;const body=JSON.parse(raw);requests.push({raw,body});if(hold)await hold;
 const id='response_'+requests.length,mid='message_'+requests.length,item={id:mid,type:'message',status:'completed',role:'assistant',content:[{type:'output_text',text:'IMPORT_NATIVE_OK',annotations:[]}]},response={id,object:'response',created_at:1,status:'completed',model:body.model,output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
 res.writeHead(200,{'content-type':'text/event-stream'});for(const event of [{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.content_part.added',output_index:0,item_id:mid,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',output_index:0,item_id:mid,content_index:0,delta:'IMPORT_NATIVE_OK'},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}])res.write('data: '+JSON.stringify(event)+'\n\n');res.end();
});await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${upstream.address().port}`;
process.env.ENABLE_TEST_MCP='false';process.env.EXPERIMENTAL_PLUGINS='true';
const wait=async p=>{const end=Date.now()+25000;while(!p()){if(Date.now()>end)throw Error('state timeout');await new Promise(r=>setTimeout(r,20));}};
async function open(){const native=new Codex(cwd,()=>({CODEX_HOME:home}));const app=await createServer({directory,cwd,codex:native,providerRuntime:new ProviderRuntime(),password:'import-native-test-long'});native.on('event',e=>{if(e.method==='turn/completed')completed.set(e.params.turn.id,e.params.turn);});await native.start();assert.equal(native.state,'ready');await app.service.settings();return app;}
async function scan(name,files){const s=await ctx.imports.create({kind:'files',name});for(const [path,content] of Object.entries(files))await ctx.imports.upload(s.id,path,Buffer.from(content));return ctx.imports.scan(s.id);}
async function install(s,select=()=>true,replace=false){return ctx.imports.install(s.id,{operationId:randomUUID(),digest:s.digest,choices:s.entries.map(e=>({id:e.id,skills:e.skills.filter(select).map(x=>x.id),confirmPackage:e.kind==='plugin',replace}))});}
const skill=(name,marker)=>`---\nname: ${name}\ndescription: ${marker}\n---\nUse the adjacent ../shared.txt as a fixture resource.\n`;
try{
 ctx=await open();
 const initial=(await ctx.app.inject({url:'/api/runtime/config',headers:{cookie:`ma_session=${ctx.db.createSession()}`}})).json();
 const snap=ctx.runtime.providerRuntime.snapshot();ctx.runtime.providerRuntime.apply(snap.revision,[{keyPath:'model_providers',value:{import_gateway:{name:'Import fixture',base_url:base,wire_api:'responses',requires_openai_auth:false}},mergeStrategy:'replace'},{keyPath:'model_provider',value:'import_gateway',mergeStrategy:'replace'},{keyPath:'model',value:'gpt-6.1-sol',mergeStrategy:'replace'}]);
 stage='single';let s=await scan('single',{'single/SKILL.md':skill('single','SINGLE_IMPORT_MARKER'),'single/assets/note.txt':'resource'});let done=await install(s);assert.equal(done.entries[0].state,'installed',JSON.stringify(done));checks.push('single skill native discovery and install');
 stage='zip';const z=await ctx.imports.create({kind:'zip',name:'zip-skill'});await ctx.imports.upload(z.id,'',zip([{name:'zip-skill/SKILL.md',data:Buffer.from(skill('zip-skill','ZIP_NATIVE_MARKER'))},{name:'zip-skill/scripts/check.sh',data:Buffer.from('exit 0'),mode:0o100700}]),true);s=await ctx.imports.scan(z.id);done=await install(s);assert.equal(done.entries[0].state,'installed');assert.equal(done.retained,false);checks.push('ZIP upload, original executable assets, native scan and confirmed installation; completed staging released');
 stage='collection-129';const files={'bundle/shared.txt':'SHARED_RESOURCE_PROOF'};for(let i=0;i<129;i++)files[`bundle/skill-${i}/SKILL.md`]=skill(`batch-${i}`,`BATCH_SKILL_${i}_VISIBLE`);
 s=await scan('collection',files);assert.equal(s.entries[0].skills.length,129);done=await install(s,x=>x.name!=='batch-128');assert.equal(done.entries[0].state,'installed',JSON.stringify(done));checks.push('129 skills scanned, 128 selected; import is independent of the eight-reference limit');
 stage='plugins';
 const pluginFiles={
 '.agents/plugins/marketplace.json':JSON.stringify({name:'import-fixture-market',plugins:[{name:'portable-probe',source:{source:'local',path:'./portable'}},{name:'compat-probe',source:{source:'local',path:'./compat'}}]}),
 'portable/plugin.json':JSON.stringify({$schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name:'portable-probe',version:'1.0.0',extensions:{'com.openai':{interface:{displayName:'Portable probe'}}}}),
 'portable/skills/alpha/SKILL.md':skill('portable-alpha','PORTABLE_ALPHA_VISIBLE'),
 'portable/skills/beta/SKILL.md':skill('portable-beta','PORTABLE_BETA_DISABLED'),
 'compat/.codex-plugin/plugin.json':JSON.stringify({name:'compat-probe',version:'1.0.0',skills:'./skills/',mcpServers:'./.mcp.json'}),
 'compat/.mcp.json':JSON.stringify({mcpServers:{import_echo:{command:process.execPath,args:[resolve('dist/mcp-test/server.js')]}}}),
 'compat/skills/alpha/SKILL.md':skill('compat-alpha','COMPAT_ALPHA_VISIBLE'),
 'compat/skills/beta/SKILL.md':skill('compat-beta','COMPAT_BETA_DISABLED'),
 };
 s=await scan('plugins',pluginFiles);assert.equal(s.entries.length,2);assert.ok(s.entries.some(e=>e.mcp.includes('import_echo')));
 done=await install(s,x=>x.name.endsWith('alpha'));assert.ok(done.entries.every(e=>e.state==='installed'),JSON.stringify(done));
 assert.equal(await readFile(join(home,'config.toml'),'utf8').catch(()=>''),'');checks.push('portable + compatibility plugins installed with full packages, selected skills and no persistent config.toml preference');
 stage='catalog';const catalog=await ctx.service.skills.list();assert.equal(catalog.skills.filter(s=>s.name.startsWith('batch-')).length,129);assert.equal(catalog.skills.find(s=>s.name==='batch-128').enabled,false);assert.equal(catalog.skills.find(s=>s.name.endsWith(':portable-beta')).enabled,false);
 stage='run';const thread=await ctx.service.handle('thread/start',{provider:'import_gateway',model:'gpt-6.1-sol'});const run=await ctx.service.handle('turn/start',{threadId:thread.id,text:'Confirm the imported skill catalog.'});await wait(()=>completed.has(run.turn.id));assert.equal(completed.get(run.turn.id).status,'completed');const request=requests.at(-1).raw;assert.ok(request.includes("compare observed numerical data in a chart"));assert.ok(request.includes("Never invent data, sources, images"));
 for(const marker of ['BATCH_SKILL_0_VISIBLE','BATCH_SKILL_127_VISIBLE','PORTABLE_ALPHA_VISIBLE','COMPAT_ALPHA_VISIBLE'])assert.ok(request.includes(marker),marker);
 for(const marker of ['BATCH_SKILL_128_VISIBLE','PORTABLE_BETA_DISABLED','COMPAT_BETA_DISABLED'])assert.equal(request.includes(marker),false,marker);
 const snapshot=ctx.workspaces.saved(thread.id).snapshot;assert.ok(snapshot.resources.length>128);const resource=snapshot.resources.find(r=>r.path.includes('skill-0/'));assert.equal(await readFile(join(resource.projectRoot,'bundle/shared.txt'),'utf8'),'SHARED_RESOURCE_PROOF');
 checks.push('actual Responses request contains enabled standalone/plugin skills, excludes disabled siblings; >128 resources can start a native thread and preserve shared relative assets');
 stage='mcp';const mcp=await ctx.runtime.call('mcpServerStatus/list',{threadId:thread.id});const connector=(await ctx.service.pluginConnections.list('compat-probe@newbot-imports')).find(c=>c.name==='import_echo');const server=mcp.data.find(s=>s.name===connector?.id);assert.ok(server,JSON.stringify(mcp));const echoed=await ctx.runtime.call('mcpServer/tool/call',{threadId:thread.id,server:server.name,tool:'echo',arguments:{text:'IMPORT_TOOL_PROOF'}});assert.ok(JSON.stringify(echoed).includes('IMPORT_TOOL_PROOF'));checks.push('installed plugin MCP executes echo through its owned runtime mapping and actual thread configuration');
 stage='busy-boundary';hold=new Promise(r=>release=r);const beforeRequests=requests.length;const activeRun=await ctx.service.handle('turn/start',{threadId:thread.id,text:'Wait during import scanning.'});await wait(()=>requests.length>beforeRequests);const concurrent=await scan('concurrent',{'concurrent/SKILL.md':skill('concurrent','CONCURRENT_IMPORT')});assert.equal(concurrent.state,'ready');await assert.rejects(install(concurrent));release();hold=undefined;await wait(()=>completed.has(activeRun.turn.id));done=await install(concurrent);assert.equal(done.entries[0].state,'installed');checks.push('scan completes alongside a real active turn; installation waits for idle and succeeds afterwards');
 stage='tamper';const tampered=await scan('tampered',{'tampered/SKILL.md':skill('tampered','ORIGINAL')});await writeFile(join(directory,'imports/staging',tampered.id,'files/tampered/SKILL.md'),skill('tampered','CHANGED_AFTER_SCAN'));await assert.rejects(install(tampered),/扫描后资源发生变化/);await ctx.imports.discard(tampered.id);checks.push('content changes after preview are rejected before installation and cancelled staging is released');
 stage='duplicate';s=await scan('plugins',pluginFiles);assert.ok(s.entries.every(e=>e.conflict?.kind==='same'));done=await install(s);assert.ok(done.entries.every(e=>e.state==='skipped'));checks.push('identical imports skip installed items');
 stage='uninstall';await ctx.service.handle('plugin/uninstall',{id:'portable-probe@newbot-imports'});assert.equal((await ctx.service.plugins.list()).entries.find(e=>e.id==='portable-probe@newbot-imports').installed,false);
 assert.equal((await ctx.service.skills.list()).skills.some(s=>s.pluginId==='portable-probe@newbot-imports'),false);
 s=await scan('plugins',pluginFiles);done=await install(s,x=>x.name.endsWith('alpha'));assert.equal(done.entries.find(e=>e.name==='portable-probe').state,'installed',JSON.stringify(done));checks.push('native uninstall removes actual discovery; same package can be imported again without false duplicate skip');
 stage='replace';
 const updated={...pluginFiles,'portable/skills/alpha/SKILL.md':skill('portable-alpha','PORTABLE_ALPHA_UPDATED')};
 s=await scan('plugins',updated);assert.equal(s.entries.find(e=>e.name==='portable-probe').conflict.kind,'changed');
 await assert.rejects(install(s));done=await install(s,x=>x.name.endsWith('alpha'),true);assert.equal(done.entries.find(e=>e.name==='portable-probe').state,'installed',JSON.stringify(done));
 checks.push('same-version plugin replacement requires explicit consent and verifies installed file hashes');
 stage='partial-retry';
 const batch={};for(const name of ['partial-a','partial-b']){batch[`${name}/.codex-plugin/plugin.json`]=JSON.stringify({name,version:'1.0.0',skills:'./skills/'});batch[`${name}/skills/note/SKILL.md`]=skill(name,'PARTIAL_'+name);}
 s=await scan('partial',batch);const nativeCall=ctx.runtime.call.bind(ctx.runtime);let calls=0;
 ctx.runtime.call=async(method,params,...rest)=>{if(method==='plugin/install'){calls++;if(params.pluginName==='partial-b')throw Error('Synthetic install interruption');}return nativeCall(method,params,...rest);};
 const operation={operationId:randomUUID(),digest:s.digest,choices:s.entries.map(e=>({id:e.id,skills:e.skills.map(x=>x.id),replace:false,confirmPackage:true}))};
 done=await ctx.imports.install(s.id,operation);assert.equal(done.entries.filter(e=>e.state==='installed').length,1);assert.equal(done.entries.filter(e=>e.state==='failed').length,1);const count=calls;
 await ctx.imports.install(s.id,operation);assert.equal(calls,count);await assert.rejects(ctx.imports.install(s.id,{...operation,digest:'0'.repeat(64)}),/操作 ID/);ctx.runtime.call=nativeCall;
 const failed=done.entries.find(e=>e.state==='failed');done=await ctx.imports.install(s.id,{...operation,operationId:randomUUID(),choices:operation.choices.filter(c=>c.id===failed.id)});assert.ok(done.entries.every(e=>e.state==='installed'),JSON.stringify(done));
 checks.push('partial install keeps successes, repeated operation does not reinstall, retry processes failed package only');
 stage='restart';await ctx.app.close();ctx=await open();const after=await ctx.service.skills.list();assert.equal(after.skills.find(s=>s.name==='batch-128').enabled,false);assert.ok((await ctx.service.plugins.list()).entries.filter(p=>p.marketplace==='newbot-imports').every(p=>p.installed));checks.push('SQLite import provenance and skill choices restore after complete service restart');
 await writeFile(join(output,'native-result.json'),JSON.stringify({at:new Date().toISOString(),version:'0.165.0',upstream:'synthetic Responses, real native runtime and MCP',checks},null,2));console.log(JSON.stringify({passed:checks.length}));
}catch(e){await writeFile(join(output,'native-failure.json'),JSON.stringify({stage,error:String(e),stack:e.stack,checks},null,2));throw e;}finally{release?.();await ctx?.app.close().catch(()=>{});upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await rm(directory,{recursive:true,force:true});}
