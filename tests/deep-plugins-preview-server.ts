// Real isolated Codex for catalog/import browser acceptance. No production data or model calls.
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from '../server/index.js';
import {Codex} from '../server/codex.js';
import {ProviderRuntime} from '../server/provider-runtime.js';
const root=process.env.NEWBOT_DEEP_FIXTURE_ROOT || await mkdtemp(join(tmpdir(),'newbot-deep-ui-')),work=join(root,'work');
await mkdir(work,{recursive:true});const native=new Codex(work,()=>({CODEX_HOME:join(root,'codex')}));
const ctx=await createServer({directory:join(root,'app'),cwd:work,codex:native,providerRuntime:new ProviderRuntime(),password:'deep-fixture-login',origins:['http://127.0.0.1:3151'],webDirectory:resolve('.data/grok-deep-web')});
for(const [name,label] of [['studio-one','设计工作室'],['studio-two','日常工具']]) {
 const source=join(root,name);await mkdir(join(source,'.agents/plugins'),{recursive:true});await mkdir(join(source,'plugins/notes/skills/summary'),{recursive:true});
 await writeFile(join(source,'.agents/plugins/marketplace.json'),JSON.stringify({name,interface:{displayName:label},plugins:[{name:'notes',source:{source:'local',path:'./plugins/notes'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'}}]}));
 await writeFile(join(source,'plugins/notes/plugin.json'),JSON.stringify({$schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name:'notes',version:'1.0.0',description:'整理资料与读书笔记',extensions:{'com.openai':{interface:{displayName:'资料笔记',shortDescription:'整理资料与读书笔记'}}}}));
 await writeFile(join(source,'plugins/notes/skills/summary/SKILL.md'),'---\nname: summary\ndescription: 将给定资料整理成清晰摘要\n---\n只处理用户提供的资料，不调用外部工具。\n');
}
await writeFile(resolve('.data/grok-deep-fixture.json'),JSON.stringify({root,sources:[join(root,'studio-one'),join(root,'studio-two')]}));
await native.start();
await ctx.app.listen({host:'127.0.0.1',port:3151});console.log('Deep plugins fixture ready on 3151');
for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>void ctx.app.close().then(()=>rm(root,{recursive:true,force:true})).then(()=>process.exit(0)));
