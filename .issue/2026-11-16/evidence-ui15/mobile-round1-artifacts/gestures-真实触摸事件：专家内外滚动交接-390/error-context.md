# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gestures.spec.ts >> 真实触摸事件：专家内外滚动交接 390
- Location: tests/mobile/gestures.spec.ts:19:30

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 221
Received:   231

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic:
  - generic [aria-hidden]:
    - generic:
      - link:
        - /url: "#message-input"
        - text: 跳到消息输入
      - main:
        - generic:
          - generic:
            - button
            - strong: newbot
        - generic:
          - generic:
            - heading [level=1]: 今天想探索什么？
        - generic:
          - generic:
            - textbox:
              - /placeholder: 询问任何问题
            - generic:
              - generic:
                - button
                - button [disabled]
                - button [disabled]
              - generic:
                - button [disabled]:
                  - generic: 测试模型
                - button [disabled]
              - button [disabled]
  - dialog "专家" [ref=e2]:
    - banner [ref=e3]:
      - heading "专家" [level=2] [ref=e4]
      - button "关闭" [ref=e5] [cursor=pointer]
    - generic [ref=e6]:
      - navigation "设置分类" [ref=e7]:
        - button "外观" [ref=e8] [cursor=pointer]
        - button "操作" [ref=e9] [cursor=pointer]
        - button "连接器" [ref=e10] [cursor=pointer]
        - button "技能" [ref=e11] [cursor=pointer]
        - button "专家" [ref=e12] [cursor=pointer]
        - button "模型" [ref=e13] [cursor=pointer]
        - button "存储" [ref=e14] [cursor=pointer]
        - button "安全" [ref=e15] [cursor=pointer]
      - region "专家" [ref=e16]:
        - region "创建专家" [ref=e20]:
          - generic [ref=e21]:
            - button "返回" [ref=e22] [cursor=pointer]
            - heading "创建专家" [active] [level=2] [ref=e24]
          - generic [ref=e25]:
            - generic [ref=e26]:
              - text: 名称
              - textbox "名称" [ref=e27]
            - generic [ref=e28]:
              - text: 简介
              - textbox "简介" [ref=e29]
            - generic [ref=e30]:
              - text: 提示词
              - textbox "提示词" [ref=e31]:
                - /placeholder: 这个专家应该如何回答、使用哪些方法…
            - searchbox "搜索专家成员" [ref=e32]
            - generic [ref=e33]:
              - group "技能 0 / 8" [ref=e34]:
                - generic [ref=e35]:
                  - text: 技能
                  - generic [ref=e36]: 0 / 8
                - generic [ref=e37] [cursor=pointer]:
                  - checkbox "代码审查" [ref=e38]
                  - generic [ref=e39]: 代码审查
                - generic [ref=e40]:
                  - checkbox "disabled-skill 不可用" [disabled] [ref=e41]
                  - generic [ref=e42]: disabled-skill
                  - generic [ref=e43]: 不可用
                - generic [ref=e44] [cursor=pointer]:
                  - checkbox "empty-skill" [ref=e45]
                  - generic [ref=e46]: empty-skill
                - generic [ref=e47]:
                  - checkbox "invalid-skill 不可用" [disabled] [ref=e48]
                  - generic [ref=e49]: invalid-skill
                  - generic [ref=e50]: 不可用
                - generic [ref=e51]:
                  - checkbox "oversized-skill 不可用" [disabled] [ref=e52]
                  - generic [ref=e53]: oversized-skill
                  - generic [ref=e54]: 不可用
                - generic [ref=e55] [cursor=pointer]:
                  - checkbox "metadata-only" [ref=e56]
                  - generic [ref=e57]: metadata-only
                - generic [ref=e58]:
                  - checkbox "linked-skill 不可用" [disabled] [ref=e59]
                  - generic [ref=e60]: linked-skill
                  - generic [ref=e61]: 不可用
                - generic [ref=e62] [cursor=pointer]:
                  - checkbox "personal-note" [ref=e63]
                  - generic [ref=e64]: personal-note
              - group "插件 0 / 8" [ref=e65]:
                - generic [ref=e66]:
                  - text: 插件
                  - generic [ref=e67]: 0 / 8
                - generic [ref=e68] [cursor=pointer]:
                  - checkbox "测试插件" [ref=e69]
                  - generic [ref=e70]: 测试插件
                - generic [ref=e71] [cursor=pointer]:
                  - checkbox "测试扩展 0" [ref=e72]
                  - generic [ref=e73]: 测试扩展 0
                - generic [ref=e74] [cursor=pointer]:
                  - checkbox "测试扩展 1" [ref=e75]
                  - generic [ref=e76]: 测试扩展 1
                - generic [ref=e77] [cursor=pointer]:
                  - checkbox "测试扩展 2" [ref=e78]
                  - generic [ref=e79]: 测试扩展 2
                - generic [ref=e80] [cursor=pointer]:
                  - checkbox "测试扩展 3" [ref=e81]
                  - generic [ref=e82]: 测试扩展 3
                - generic [ref=e83] [cursor=pointer]:
                  - checkbox "测试扩展 4" [ref=e84]
                  - generic [ref=e85]: 测试扩展 4
                - generic [ref=e86] [cursor=pointer]:
                  - checkbox "测试扩展 5" [ref=e87]
                  - generic [ref=e88]: 测试扩展 5
                - generic [ref=e89] [cursor=pointer]:
                  - checkbox "测试扩展 6" [ref=e90]
                  - generic [ref=e91]: 测试扩展 6
                - generic [ref=e92] [cursor=pointer]:
                  - checkbox "测试扩展 7" [ref=e93]
                  - generic [ref=e94]: 测试扩展 7
                - generic [ref=e95] [cursor=pointer]:
                  - checkbox "测试扩展 8" [ref=e96]
                  - generic [ref=e97]: 测试扩展 8
                - generic [ref=e98] [cursor=pointer]:
                  - checkbox "测试扩展 9" [ref=e99]
                  - generic [ref=e100]: 测试扩展 9
                - generic [ref=e101] [cursor=pointer]:
                  - checkbox "测试扩展 10" [ref=e102]
                  - generic [ref=e103]: 测试扩展 10
                - generic [ref=e104] [cursor=pointer]:
                  - checkbox "测试扩展 11" [ref=e105]
                  - generic [ref=e106]: 测试扩展 11
              - group "连接器 0 / 16" [ref=e107]:
                - generic [ref=e108]:
                  - text: 连接器
                  - generic [ref=e109]: 0 / 16
                - generic [ref=e110] [cursor=pointer]:
                  - checkbox "test-server" [ref=e111]
                  - generic [ref=e112]: test-server
                - generic [ref=e113]:
                  - checkbox "offline 不可用" [disabled] [ref=e114]
                  - generic [ref=e115]: offline
                  - generic [ref=e116]: 不可用
            - generic [ref=e117]:
              - button "取消" [ref=e118] [cursor=pointer]
              - button "保存" [disabled] [ref=e119]
```

# Test source

```ts
  1  | import { test, expect, type Page, type CDPSession, type Locator } from '@playwright/test';
  2  | async function login(page:Page) {
  3  |  await page.goto('/?profile=1');await page.getByLabel('登录密码').fill('issue-fixture-login');await page.getByRole('button',{name:'继续',exact:true}).tap();await page.getByRole('textbox',{name:'消息',exact:true}).waitFor();
  4  | }
  5  | async function settings(page:Page,section:string) {await login(page);await page.getByRole('button',{name:'展开侧栏',exact:true}).tap();await page.getByRole('button',{name:'设置',exact:true}).tap();await page.getByRole('button',{name:section,exact:true}).tap();await page.getByRole('searchbox',{name:`搜索${section}`}).waitFor();}
  6  | async function swipe(cdp:CDPSession,x:number,y:number,dx:number,dy:number,cancel=false) {
  7  |  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x,y}]});
  8  |  for(let i=1;i<=16;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:0,x:x+dx*i/16,y:y+dy*i/16}]});await new Promise(r=>setTimeout(r,16));}
  9  |  await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});
  10 | }
  11 | async function center(locator:Locator,page:Page) {const r=(await locator.boundingBox())!,h=page.viewportSize()!.height;return{x:r.x+r.width/2,y:(Math.max(r.y,150)+Math.min(r.y+r.height,h-30))/2};}
  12 | async function chain(page:Page,cdp:CDPSession,inner:Locator,outer:Locator) {
  13 |  await inner.scrollIntoViewIfNeeded();const max=await inner.evaluate(e=>e.scrollHeight-e.clientHeight);expect(max).toBeGreaterThan(100);
  14 |  await inner.evaluate(e=>e.scrollTop=(e.scrollHeight-e.clientHeight)/2);let p=await center(inner,page);let before=await outer.evaluate(e=>e.scrollTop);let mid=await inner.evaluate(e=>e.scrollTop);
  15 |  await swipe(cdp,p.x,p.y+60,0,-120);await expect.poll(()=>inner.evaluate(e=>e.scrollTop)).toBeGreaterThan(mid+30);expect(await outer.evaluate(e=>e.scrollTop)).toBeCloseTo(before,0);
> 16 |  await page.waitForTimeout(600);await inner.evaluate(e=>e.scrollTop=0);before=await outer.evaluate(e=>e.scrollTop);p=await center(inner,page);await swipe(cdp,p.x,p.y-60,0,120);await expect.poll(()=>outer.evaluate(e=>e.scrollTop)).toBeLessThan(before-10);
     |                                                                                                                                                                                                                                       ^ Error: expect(received).toBeLessThan(expected)
  17 |  await page.waitForTimeout(600);await inner.scrollIntoViewIfNeeded();await inner.evaluate(e=>e.scrollTop=e.scrollHeight);await outer.evaluate(e=>e.scrollTop=Math.max(0,e.scrollHeight-e.clientHeight-120));before=await outer.evaluate(e=>e.scrollTop);p=await center(inner,page);await swipe(cdp,p.x,p.y+60,0,-120);await expect.poll(()=>outer.evaluate(e=>e.scrollTop)).toBeGreaterThan(before+10);
  18 | }
  19 | for(const width of [320,390])test(`真实触摸事件：专家内外滚动交接 ${width}`,async({page,context},info)=>{
  20 |  await page.setViewportSize({width,height:720});await settings(page,'专家');await page.getByRole('button',{name:'添加专家',exact:true}).tap();const cdp=await context.newCDPSession(page);await chain(page,cdp,page.locator('.expert-member-picker'),page.locator('.plugin-center-content'));await info.attach('expert-touch',{body:await page.screenshot(),contentType:'image/png'});
  21 |  await page.getByRole('button',{name:'返回',exact:true}).tap();await page.getByRole('button',{name:'关闭',exact:true}).tap();await page.getByRole('textbox',{name:'消息',exact:true}).tap();await expect(page.getByRole('textbox',{name:'消息',exact:true})).toBeFocused();expect(await page.locator('.modal-scrim').count()).toBe(0);
  22 | });
  23 | for(const reduced of [false,true])test(`手机抽屉动画及关闭后触摸恢复 ${reduced}`,async({page,context},info)=>{
  24 |  await page.emulateMedia({reducedMotion:reduced?'reduce':'no-preference'});await login(page);await page.evaluate(()=>{(window as any).motion=[];const start=performance.now();function sample(t:number){const node=document.querySelector('.sidebar');if(node){const r=node.getBoundingClientRect();(window as any).motion.push({t:t-start,x:r.x,width:r.width});}if(performance.now()-start<1100)requestAnimationFrame(sample);}requestAnimationFrame(sample);});
  25 |  await page.getByRole('button',{name:'展开侧栏',exact:true}).tap();await expect(page.getByRole('dialog',{name:'对话导航',exact:true})).toBeVisible();await page.waitForTimeout(600);
  26 |  const frames=await page.evaluate(()=>(window as any).motion as {t:number;x:number;width:number}[]);expect(frames.length).toBeGreaterThan(5);expect(Math.abs(frames.at(-1)!.x)).toBeLessThan(1);const middle=frames.filter(f=>f.x< -1 && f.x> -f.width+1);if(reduced)expect(middle).toHaveLength(0);else expect(middle.length).toBeGreaterThan(2);await info.attach('drawer-frames',{body:JSON.stringify({reduced,frames}),contentType:'application/json'});
  27 |  await page.touchscreen.tap(page.viewportSize()!.width-15,400);await expect(page.getByRole('dialog',{name:'对话导航',exact:true})).toHaveCount(0);await page.getByRole('textbox',{name:'消息',exact:true}).tap();await expect(page.getByRole('textbox',{name:'消息',exact:true})).toBeFocused();
  28 | });
  29 | test('触摸分类横滑不改变分类，竖向目录仍可滚动',async({page,context},info)=>{
  30 |  await settings(page,'连接器');const nav=page.getByRole('navigation',{name:'设置分类'}),cdp=await context.newCDPSession(page),r=(await nav.boundingBox())!;
  31 |  await swipe(cdp,300,r.y+r.height/2,-230,0);await expect.poll(()=>nav.evaluate(e=>e.scrollLeft)).toBeGreaterThan(100);await expect(page.getByRole('button',{name:'连接器',exact:true})).toHaveAttribute('aria-current','page');
  32 |  const outer=page.locator('.plugin-center-content');await swipe(cdp,195,620,0,-300);await expect.poll(()=>outer.evaluate(e=>e.scrollTop)).toBeGreaterThan(100);await info.attach('horizontal-and-vertical',{body:await page.screenshot(),contentType:'image/png'});
  33 | });
  34 | test('平板触控调整宽度、取消释放与下一次操作',async({page,context},info)=>{
  35 |  await page.setViewportSize({width:1100,height:844});await login(page);const cdp=await context.newCDPSession(page),handle=page.getByRole('separator',{name:'调整左侧栏宽度'});let r=(await handle.boundingBox())!;await swipe(cdp,r.x+r.width/2,300,100,0,true);await expect(page.locator('.panel-drag-shield')).toHaveCount(0);const width=Number(await handle.getAttribute('aria-valuenow'));expect(width).toBeGreaterThan(300);await page.reload();await expect(handle).toHaveAttribute('aria-valuenow',String(width));await page.getByRole('button',{name:'设置',exact:true}).tap();await expect(page.getByRole('button',{name:'连接器',exact:true})).toBeVisible();await info.attach('tablet-cancel',{body:await page.screenshot(),contentType:'image/png'});
  36 | });
  37 | test('触摸工作流程边缘交接聊天且默认折叠',async({page,context},info)=>{
  38 |  await login(page);const send=async(text:string)=>{const count=await page.getByText('测试回复完成。',{exact:true}).count();await page.getByRole('textbox',{name:'消息',exact:true}).fill(text);await page.getByRole('button',{name:'发送消息',exact:true}).tap();await expect(page.getByText('测试回复完成。',{exact:true})).toHaveCount(count+1);};
  39 |  await send(Array.from({length:45},(_,i)=>`前文${i}滚动验收`).join('\n'));await page.getByRole('button',{name:'展开侧栏',exact:true}).tap();const threadId=await page.locator('.history-row.selected').getAttribute('data-thread-id');await page.touchscreen.tap(375,400);
  40 |  const response=await page.request.post('/api/test/process',{data:{threadId,count:36},headers:{Origin:'http://127.0.0.1:3169'}});expect(response.ok()).toBe(true);await send(Array.from({length:25},(_,i)=>`后文${i}继续阅读`).join('\n'));
  41 |  const toggle=page.getByRole('button',{name:'后续过程 · 36 项',exact:true});await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.tap();const inner=page.getByRole('region',{name:'执行过程详情'}).last();await chain(page,await context.newCDPSession(page),inner,page.locator('.conversation'));await info.attach('process-touch',{body:await page.screenshot(),contentType:'image/png'});
  42 | });
  43 | 
```