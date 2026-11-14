import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {database} from '../server/db.ts';
import {ExtensionRuntime} from '../server/extension-runtime.ts';
import {Codex} from '../server/codex.ts';
import {marketplaceLibrary} from '../server/marketplaces.ts';
const root=await mkdtemp(join(tmpdir(),'newbot-codex-stores-'));
const evidence=resolve('.issue/2026-11-13/evidence-grok-deep-plugins');
const db=database(root),ext=new ExtensionRuntime(db);ext.invalidate();
const work=join(root,'work');await mkdir(work);
const native=new Codex(work,()=>({CODEX_HOME:join(root,'runtime')}));
let checked=[];
try {
  await native.start();assert.equal(native.state,'ready');
  const discover=()=>native.call('plugin/list',{cwds:ext.marketplaceRoots(),marketplaceKinds:['local']});
  const stores=marketplaceLibrary(db,ext,discover);
  for(const name of ['acceptance-one','acceptance-two']) {
    const source=join(root,name);await mkdir(join(source,'.agents/plugins'),{recursive:true});await mkdir(join(source,'plugins/example/skills/hello'),{recursive:true});
    await writeFile(join(source,'.agents/plugins/marketplace.json'),JSON.stringify({name,interface:{displayName:name},plugins:[{name:'example',source:{source:'local',path:'./plugins/example'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'}}]}));
    await writeFile(join(source,'plugins/example/plugin.json'),JSON.stringify({$schema:'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',name:'example',version:'1.0.0',description:'Synthetic acceptance plugin'}));
    await writeFile(join(source,'plugins/example/skills/hello/SKILL.md'),'---\nname: hello\ndescription: Synthetic read-only acceptance skill\n---\nReply hello. Do not call tools.\n');
    await stores.mutate('marketplace/add',{source,expectedRevision:(await stores.list()).revision,operationId:randomUUID()});
  }
  const list=await discover();assert.equal(list.marketplaces.length,2);
  assert.deepEqual(new Set(list.marketplaces.flatMap(m=>m.plugins.map(p=>p.id))),new Set(['example@acceptance-one','example@acceptance-two']));checked.push('Native Codex parsed two independent stores with same plugin name');
  const first=list.marketplaces[0];await native.call('plugin/install',{marketplacePath:first.path,pluginName:'example'});
  const installed=await discover();assert.equal(installed.marketplaces.flatMap(m=>m.plugins).filter(p=>p.installed).length,1);checked.push('Native Codex installed only selected store plugin');
  const skills=await native.call('skills/list',{cwds:[work],forceReload:true});assert.ok(skills.data.flatMap(d=>d.skills).some(s=>s.pluginId===`example@${first.name}`));checked.push('Native Codex discovers installed plugin skill');
  const restored=new ExtensionRuntime(db);assert.deepEqual(restored.marketplaceRoots(),ext.marketplaceRoots());checked.push('SQLite registration survives runtime reconstruction');
  await native.stopAndWait(); native.discoveryMarketplaces=restored.marketplaceConfig(); await native.start();
  const mapped=await native.call('plugin/list',{cwds:[work],marketplaceKinds:['local']});
  assert.deepEqual(Object.keys((await native.call('config/read',{})).config.marketplaces).sort(),['acceptance-one','acceptance-two']);
  assert.equal(mapped.marketplaces.filter(m=>m.name.startsWith('acceptance-')).length,2); checked.push('Both marketplace names survive native restart through CLI configuration mapping');
  await writeFile(join(evidence,'native-marketplaces.json'),JSON.stringify({passed:true,checked,upstream:'real pinned Codex; synthetic local catalogs; no model request'},null,2));console.log(JSON.stringify({passed:true,checked}));
} finally {await native.stopAndWait();db.raw.close();await rm(root,{recursive:true,force:true})}
