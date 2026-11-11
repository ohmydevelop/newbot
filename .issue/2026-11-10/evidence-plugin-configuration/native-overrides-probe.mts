import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Codex} from '/home/a/Documents/ChatGPT/newbot/server/codex.ts';
const root=await mkdtemp(join(tmpdir(),'newbot-plugin-override-')),home=join(root,'codex'),market=join(root,'market'),plugin=join(market,'plugin'),work=join(root,'work'),script=join(root,'mcp.cjs');
let c;const evidence=[];
try{
 await mkdir(join(plugin,'.codex-plugin'),{recursive:true});await mkdir(join(market,'.agents/plugins'),{recursive:true});await mkdir(work);
 await writeFile(script,`const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{let m;try{m=JSON.parse(line);}catch{return;}if(m.id===undefined)return;const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}}:m.method==='tools/list'?{tools:[{name:'inspect',description:'Inspect synthetic fixture marker',inputSchema:{type:'object',properties:{}}}]}:m.method==='tools/call'?{content:[{type:'text',text:JSON.stringify({marker:process.env.PLUGIN_TEST||'absent'})}]}:{resources:[],prompts:[]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`);
 const def={type:'stdio',command:process.execPath,args:[script],env:{PLUGIN_TEST:'bundled'}};
 await writeFile(join(plugin,'.codex-plugin/plugin.json'),JSON.stringify({name:'probe',version:'1.0.0',mcpServers:'./.mcp.json'}));await writeFile(join(plugin,'.mcp.json'),JSON.stringify({mcpServers:{owned:def}}));
 const manifest=join(market,'.agents/plugins/marketplace.json');await writeFile(manifest,JSON.stringify({name:'scope-test',plugins:[{name:'probe',source:{source:'local',path:'./plugin'}}]}));
 c=new Codex(work,()=>({CODEX_HOME:home}));await c.start();assert.equal(c.state,'ready');await c.call('plugin/install',{marketplacePath:manifest,pluginName:'probe'});
 for(const [mode,config]of Object.entries({base:{plugins:{'probe@scope-test':{enabled:true}}},nested:{plugins:{'probe@scope-test':{enabled:true,mcp_servers:{owned:{env:{PLUGIN_TEST:'nested'}}}}}},top:{plugins:{'probe@scope-test':{enabled:true}},mcp_servers:{owned:{command:process.execPath,args:[script],env:{PLUGIN_TEST:'top'}}}},disabled:{plugins:{'probe@scope-test':{enabled:true,mcp_servers:{owned:{enabled:false}}}}}})){
  try{const t=await c.call('thread/start',{cwd:work,ephemeral:true,config});const s=await c.call('mcpServerStatus/list',{threadId:t.thread.id,detail:'full',limit:100});const summary=[];for(const v of s.data){const result=v.runtimeStatus==='connected'?await c.call('mcpServer/tool/call',{threadId:t.thread.id,server:v.name,tool:'inspect',arguments:{}}):null;summary.push({name:v.name,pluginId:v.pluginId,status:v.runtimeStatus,error:v.toolsError,result});}evidence.push({mode,servers:summary});}catch(e){evidence.push({mode,error:e.message});}
 }
 console.log(JSON.stringify(evidence,null,2));
}finally{await c?.stopAndWait();await rm(root,{recursive:true,force:true});}
