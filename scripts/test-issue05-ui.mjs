// Issue 05 browser acceptance. Isolated runtime and synthetic catalogs only.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const stage = process.env.ISSUE05_STAGE || 'S1';
const output = resolve('.issue/2026-11-10/evidence-issue-05', stage);
mkdirSync(output,{recursive:true});
const origin = 'http://127.0.0.1:3159';
const server = spawn(process.execPath,['--import','tsx','tests/issue-preview-server.ts'],{
  env:{...process.env,NODE_ENV:'test',AGENT_TRANSPORT:'poll',ISSUE_TEST_PORT:'3159',ISSUE_RICH_UI:'1',ISSUE_MEMORY_PROVIDERS:'1',ISSUE_ACTIVITY_UI:'1',ISSUE05_UI:'1',ISSUE_TURN_MS:'180000',UI_TEST_CANDIDATE:resolve('.data/issue-05-web')},
  stdio:['ignore','pipe','pipe']
});
let log='',browser,page;
const checks=[],errors=[];
const exited = new Promise(r=>server.once('exit',r));
try {
  await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error(log)),20000); const read=d=>{log+=d;if(log.includes('Issue UI fixture ready')){clearTimeout(timer);r();}};server.stdout.on('data',read);server.stderr.on('data',read);server.once('exit',()=>{clearTimeout(timer);j(Error(log));});});
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE});
  const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light',reducedMotion:'reduce'});
  const post=async(path,data)=>{const r=await context.request.post(origin+path,{headers:{origin},data});assert.equal(r.status(),200,await r.text());return r.json();};
  await post('/api/login',{password:'issue-fixture-login'});
  page=await context.newPage(); page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'扩展',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'设置',exact:true});
  for (const width of [1440,390]) for (const theme of ['light','dark']) {
    await page.setViewportSize({width,height:1000});await page.emulateMedia({colorScheme:theme});
    for (const label of ['专家','插件','技能','连接器']) {
      await modal.getByRole('tab',{name:label,exact:true}).click();
      const search=modal.getByRole('searchbox',{name:'搜索'+label,exact:true});await search.waitFor();
      const toolbar=modal.locator('.catalog-toolbar');await toolbar.locator('button').first().waitFor();
      assert.equal(await modal.getByRole('heading',{name:label,exact:true}).count(),0);
      const boxes=await toolbar.evaluate(el=>{const r=n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,bottom:b.bottom,width:b.width}};return {search:r(el.querySelector('input')),actions:r(el.querySelector('.catalog-toolbar-actions')),overflow:el.scrollWidth>el.clientWidth+1}});
      assert.equal(boxes.overflow,false);
      if(width>760)assert.ok(Math.abs(boxes.search.y-boxes.actions.y)<5);
      else assert.ok(boxes.actions.y>=boxes.search.bottom);
      await search.fill('不存在的目录项目');await search.fill('');
      await modal.screenshot({path:join(output,`${label}-${width}-${theme}.png`)});
      checks.push(`${label} ${width} ${theme}: one toolbar, search, no overflow`);
    }
  }
  await modal.getByRole('navigation',{name:'设置分类'}).getByRole('button',{name:'网关',exact:true}).click();
  await modal.locator('.gateway-card').first().waitFor();
  for(const width of [1440,768,390]){
    await page.setViewportSize({width,height:1000});
    const values=await modal.locator('.gateway-card').evaluateAll(cards=>cards.map(card=>{const a=card.querySelector('.gateway-name strong').getBoundingClientRect(),b=card.querySelector('.gateway-actions svg').getBoundingClientRect();return {delta:a.y+a.height/2-b.y-b.height/2,overflow:card.scrollWidth>card.clientWidth+1}}));
    assert.ok(values.every(v=>Math.abs(v.delta)<=1&&!v.overflow));checks.push(`gateway aligned ${width}`);
  }
  if (stage !== 'S1') {
    await modal.getByRole('button',{name:'关闭',exact:true}).click();
    await page.setViewportSize({width:1440,height:1000});
    const run=await post('/api/agent/run',{requestId:crypto.randomUUID(),text:'Process acceptance',provider:'fixture',model:'fixture-model'});
    const threadId=run.threadId;
    await post('/api/agent/action',{action:'thread/name/set',threadId,name:'Issue 05 process'});
    await page.reload();
    await page.locator('.history-link').filter({hasText:'Issue 05 process'}).click();
    await post('/api/test/process',{threadId,count:40});
    const toggle=page.locator('button.process-toggle').first(), viewport=page.locator('.process-viewport').first();
    await toggle.waitFor();assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    await toggle.click();await viewport.waitFor();await page.waitForFunction(()=>document.querySelectorAll('.tool-item').length>=40);
    const size=await viewport.evaluate(el=>({height:el.clientHeight,full:el.scrollHeight}));assert.ok(size.height<=360&&size.full>size.height);
    assert.ok(await page.locator('.tool-item > summary').filter({hasText:'调用工具 · inspect_'}).count()>=20);
    await viewport.evaluate(el=>{el.scrollTop=140;el.dispatchEvent(new Event('scroll'));});
    await page.waitForFunction(()=>document.querySelector('.process-window')?.classList.contains('has-before'));
    const before=await viewport.evaluate(el=>el.scrollTop);
    await post('/api/test/process',{threadId,count:2,offset:40});
    await page.waitForFunction(()=>document.querySelectorAll('.tool-item').length>=42);
    assert.ok(Math.abs((await viewport.evaluate(el=>el.scrollTop))-before)<=1);
    checks.push('bounded process, semantic tools, append preserves reading position');
    await page.getByRole('button',{name:'查看最新执行步骤'}).click();
    assert.ok(await viewport.evaluate(el=>el.scrollHeight-el.clientHeight-el.scrollTop<3));
    await post('/api/test/activity',{threadId,state:'waiting'});await page.locator('.approval-card').waitFor();
    await toggle.click();assert.ok(await page.locator('.approval-card').isVisible());
    checks.push('latest step control and approvals outside collapsed process');
    await toggle.click();await viewport.focus();assert.ok(await viewport.evaluate(el=>el===document.activeElement));
    for(const width of [1440,390]){await page.setViewportSize({width,height:844});await page.screenshot({path:join(output,`process-${width}.png`)});assert.ok(await viewport.evaluate(el=>el.clientHeight<=Math.min(360,window.innerHeight*.45)+1));}
    await post('/api/test/activity',{threadId,state:'running'});await post('/api/test/activity',{threadId,state:'completed'});
    await page.setViewportSize({width:1440,height:1000});await page.reload();await page.locator('.history-link').filter({hasText:'Issue 05 process'}).click();await page.locator('button.process-toggle').first().waitFor();
    assert.equal(await page.locator('button.process-toggle').first().getAttribute('aria-expanded'),'false');
    checks.push('keyboard region, mobile bounded height and reload history');
  }
  if (stage === 'S3') {
    const run=await post('/api/agent/run',{requestId:crypto.randomUUID(),text:'Images acceptance',provider:'fixture',model:'fixture-model'});
    await post('/api/agent/action',{action:'thread/name/set',threadId:run.threadId,name:'Issue 05 images'});
    await page.reload();await page.locator('.history-link').filter({hasText:'Issue 05 images'}).click();
    await post('/api/test/media',{threadId:run.threadId});
    await page.getByText('CPU 使用率',{exact:true}).waitFor();assert.equal(await page.locator(".a2ui-panel .a2ui-notice").count(),0);
    await page.waitForFunction(()=>document.querySelectorAll('.answer-image-button img').length===4 && [...document.querySelectorAll('.answer-image-button img')].every(i=>i.complete && i.naturalWidth>0));
    assert.ok(await page.getByText('正在绘制图表…',{exact:true}).isVisible());
    await post('/api/test/activity',{threadId:run.threadId,state:'completed'});
    await page.locator('.chart svg').waitFor();
    await page.getByRole('button',{name:'放大图片：工作区图片',exact:true}).click();
    await page.getByRole('dialog',{name:'工作区图片',exact:true}).waitFor();
    await page.getByRole('dialog',{name:'工作区图片',exact:true}).getByRole('button',{name:'关闭',exact:true}).click();
    for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.locator(".conversation").evaluate(el=>{el.scrollTop=0;});await page.screenshot({path:join(output,`images-${width}.png`)});await page.getByText("CPU 使用率",{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:join(output,`rich-components-${width}.png`)});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));}
    await page.setViewportSize({width:1440,height:1000});await page.reload();await page.locator('.history-link').filter({hasText:'Issue 05 images'}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.answer-image-button img').length===4);
    const urls=await page.locator('.answer-image-button img').evaluateAll(imgs=>imgs.map(i=>i.getAttribute('src')));assert.ok(urls.every(u=>u.startsWith('/api/artifacts/')));
    const unauth=await browser.newContext();assert.equal((await unauth.request.get(origin+urls[0])).status(),401);await unauth.close();
    assert.ok(await page.locator('.answer-image-placeholder').count()>=1);
    checks.push('native/MCP/workspace/A2UI authenticated images, zoom, failed resource, refresh and mobile','streaming chart placeholder then complete observed-data chart');
  }
  assert.deepEqual(errors,[]);
  writeFileSync(join(output,'result.json'),JSON.stringify({at:new Date().toISOString(),environment:'Chromium + isolated IssueCodex; synthetic providers',checks,errors},null,2));
  console.log(JSON.stringify({passed:checks.length,errors}));
}catch(e){if(page)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});writeFileSync(join(output,'failure.json'),JSON.stringify({error:String(e),checks,errors,log},null,2));throw e;}
finally{await browser?.close();server.kill('SIGTERM');await exited;}
