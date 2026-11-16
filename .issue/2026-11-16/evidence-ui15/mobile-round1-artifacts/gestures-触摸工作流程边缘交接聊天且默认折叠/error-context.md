# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gestures.spec.ts >> 触摸工作流程边缘交接聊天且默认折叠
- Location: tests/mobile/gestures.spec.ts:37:1

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 1175
Received:   1185

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "跳到消息输入" [ref=e4] [cursor=pointer]:
    - /url: "#message-input"
  - main "聊天工作区" [ref=e5]:
    - generic [ref=e6]:
      - generic [ref=e7]:
        - button "展开侧栏" [ref=e8] [cursor=pointer]
        - strong [ref=e9]: 前文0滚动验收 前文1滚动验收 前文2滚动验收 前文3滚动验收 前文4滚
      - generic [ref=e10]:
        - button "会话私密授权" [ref=e12] [cursor=pointer]
        - button "打开右侧栏" [ref=e13] [cursor=pointer]
    - generic "发送状态"
    - generic [ref=e15]:
      - generic [ref=e16]:
        - generic [ref=e17]: 前文0滚动验收 前文1滚动验收 前文2滚动验收 前文3滚动验收 前文4滚动验收 前文5滚动验收 前文6滚动验收 前文7滚动验收 前文8滚动验收 前文9滚动验收 前文10滚动验收 前文11滚动验收 前文12滚动验收 前文13滚动验收 前文14滚动验收 前文15滚动验收 前文16滚动验收 前文17滚动验收 前文18滚动验收 前文19滚动验收 前文20滚动验收 前文21滚动验收 前文22滚动验收 前文23滚动验收 前文24滚动验收 前文25滚动验收 前文26滚动验收 前文27滚动验收 前文28滚动验收 前文29滚动验收 前文30滚动验收 前文31滚动验收 前文32滚动验收 前文33滚动验收 前文34滚动验收 前文35滚动验收 前文36滚动验收 前文37滚动验收 前文38滚动验收 前文39滚动验收 前文40滚动验收 前文41滚动验收 前文42滚动验收 前文43滚动验收 前文44滚动验收
        - button "用时 1 秒" [ref=e22] [cursor=pointer]
        - article "助手回复" [ref=e24]:
          - paragraph [ref=e26]: 测试回复完成。
          - button "复制回答" [ref=e28] [cursor=pointer]
        - generic [ref=e29]:
          - button "后续过程 · 36 项" [expanded] [active] [ref=e31] [cursor=pointer]
          - region "执行过程详情" [ref=e34]:
            - generic [ref=e35]:
              - group [ref=e36]:
                - generic "使用 fixture 已完成" [ref=e37] [cursor=pointer]:
                  - generic [ref=e41]: 使用 fixture
                  - generic [ref=e42]: 已完成
              - group [ref=e45]:
                - generic "执行命令 已完成" [ref=e46] [cursor=pointer]:
                  - generic [ref=e49]: 执行命令
                  - generic [ref=e50]: 已完成
              - group [ref=e53]:
                - generic "使用 fixture 已完成" [ref=e54] [cursor=pointer]:
                  - generic [ref=e58]: 使用 fixture
                  - generic [ref=e59]: 已完成
              - group [ref=e62]:
                - generic "执行命令 已完成" [ref=e63] [cursor=pointer]:
                  - generic [ref=e66]: 执行命令
                  - generic [ref=e67]: 已完成
              - group [ref=e70]:
                - generic "使用 fixture 已完成" [ref=e71] [cursor=pointer]:
                  - generic [ref=e75]: 使用 fixture
                  - generic [ref=e76]: 已完成
              - group [ref=e79]:
                - generic "执行命令 已完成" [ref=e80] [cursor=pointer]:
                  - generic [ref=e83]: 执行命令
                  - generic [ref=e84]: 已完成
              - group [ref=e87]:
                - generic "使用 fixture 已完成" [ref=e88] [cursor=pointer]:
                  - generic [ref=e92]: 使用 fixture
                  - generic [ref=e93]: 已完成
              - group [ref=e96]:
                - generic "执行命令 已完成" [ref=e97] [cursor=pointer]:
                  - generic [ref=e100]: 执行命令
                  - generic [ref=e101]: 已完成
              - group [ref=e104]:
                - generic "使用 fixture 已完成" [ref=e105] [cursor=pointer]:
                  - generic [ref=e109]: 使用 fixture
                  - generic [ref=e110]: 已完成
              - group [ref=e113]:
                - generic "执行命令 已完成" [ref=e114] [cursor=pointer]:
                  - generic [ref=e117]: 执行命令
                  - generic [ref=e118]: 已完成
              - group [ref=e121]:
                - generic "使用 fixture 已完成" [ref=e122] [cursor=pointer]:
                  - generic [ref=e126]: 使用 fixture
                  - generic [ref=e127]: 已完成
              - group [ref=e130]:
                - generic "执行命令 已完成" [ref=e131] [cursor=pointer]:
                  - generic [ref=e134]: 执行命令
                  - generic [ref=e135]: 已完成
              - group [ref=e138]:
                - generic "使用 fixture 已完成" [ref=e139] [cursor=pointer]:
                  - generic [ref=e143]: 使用 fixture
                  - generic [ref=e144]: 已完成
              - group [ref=e147]:
                - generic "执行命令 已完成" [ref=e148] [cursor=pointer]:
                  - generic [ref=e151]: 执行命令
                  - generic [ref=e152]: 已完成
              - group [ref=e155]:
                - generic "使用 fixture 已完成" [ref=e156] [cursor=pointer]:
                  - generic [ref=e160]: 使用 fixture
                  - generic [ref=e161]: 已完成
              - group [ref=e164]:
                - generic "执行命令 已完成" [ref=e165] [cursor=pointer]:
                  - generic [ref=e168]: 执行命令
                  - generic [ref=e169]: 已完成
              - group [ref=e172]:
                - generic "使用 fixture 已完成" [ref=e173] [cursor=pointer]:
                  - generic [ref=e177]: 使用 fixture
                  - generic [ref=e178]: 已完成
              - group [ref=e181]:
                - generic "执行命令 已完成" [ref=e182] [cursor=pointer]:
                  - generic [ref=e185]: 执行命令
                  - generic [ref=e186]: 已完成
              - group [ref=e189]:
                - generic "使用 fixture 已完成" [ref=e190] [cursor=pointer]:
                  - generic [ref=e194]: 使用 fixture
                  - generic [ref=e195]: 已完成
              - group [ref=e198]:
                - generic "执行命令 已完成" [ref=e199] [cursor=pointer]:
                  - generic [ref=e202]: 执行命令
                  - generic [ref=e203]: 已完成
              - group [ref=e206]:
                - generic "使用 fixture 已完成" [ref=e207] [cursor=pointer]:
                  - generic [ref=e211]: 使用 fixture
                  - generic [ref=e212]: 已完成
              - group [ref=e215]:
                - generic "执行命令 已完成" [ref=e216] [cursor=pointer]:
                  - generic [ref=e219]: 执行命令
                  - generic [ref=e220]: 已完成
              - group [ref=e223]:
                - generic "使用 fixture 已完成" [ref=e224] [cursor=pointer]:
                  - generic [ref=e228]: 使用 fixture
                  - generic [ref=e229]: 已完成
              - group [ref=e232]:
                - generic "执行命令 已完成" [ref=e233] [cursor=pointer]:
                  - generic [ref=e236]: 执行命令
                  - generic [ref=e237]: 已完成
              - group [ref=e240]:
                - generic "使用 fixture 已完成" [ref=e241] [cursor=pointer]:
                  - generic [ref=e245]: 使用 fixture
                  - generic [ref=e246]: 已完成
              - group [ref=e249]:
                - generic "执行命令 已完成" [ref=e250] [cursor=pointer]:
                  - generic [ref=e253]: 执行命令
                  - generic [ref=e254]: 已完成
              - group [ref=e257]:
                - generic "使用 fixture 已完成" [ref=e258] [cursor=pointer]:
                  - generic [ref=e262]: 使用 fixture
                  - generic [ref=e263]: 已完成
              - group [ref=e266]:
                - generic "执行命令 已完成" [ref=e267] [cursor=pointer]:
                  - generic [ref=e270]: 执行命令
                  - generic [ref=e271]: 已完成
              - group [ref=e274]:
                - generic "使用 fixture 已完成" [ref=e275] [cursor=pointer]:
                  - generic [ref=e279]: 使用 fixture
                  - generic [ref=e280]: 已完成
              - group [ref=e283]:
                - generic "执行命令 已完成" [ref=e284] [cursor=pointer]:
                  - generic [ref=e287]: 执行命令
                  - generic [ref=e288]: 已完成
              - group [ref=e291]:
                - generic "使用 fixture 已完成" [ref=e292] [cursor=pointer]:
                  - generic [ref=e296]: 使用 fixture
                  - generic [ref=e297]: 已完成
              - group [ref=e300]:
                - generic "执行命令 已完成" [ref=e301] [cursor=pointer]:
                  - generic [ref=e304]: 执行命令
                  - generic [ref=e305]: 已完成
              - group [ref=e308]:
                - generic "使用 fixture 已完成" [ref=e309] [cursor=pointer]:
                  - generic [ref=e313]: 使用 fixture
                  - generic [ref=e314]: 已完成
              - group [ref=e317]:
                - generic "执行命令 已完成" [ref=e318] [cursor=pointer]:
                  - generic [ref=e321]: 执行命令
                  - generic [ref=e322]: 已完成
              - group [ref=e325]:
                - generic "使用 fixture 已完成" [ref=e326] [cursor=pointer]:
                  - generic [ref=e330]: 使用 fixture
                  - generic [ref=e331]: 已完成
              - group [ref=e334]:
                - generic "执行命令 已完成" [ref=e335] [cursor=pointer]:
                  - generic [ref=e338]: 执行命令
                  - generic [ref=e339]: 已完成
      - generic [ref=e342]:
        - generic [ref=e343]: 后文0继续阅读 后文1继续阅读 后文2继续阅读 后文3继续阅读 后文4继续阅读 后文5继续阅读 后文6继续阅读 后文7继续阅读 后文8继续阅读 后文9继续阅读 后文10继续阅读 后文11继续阅读 后文12继续阅读 后文13继续阅读 后文14继续阅读 后文15继续阅读 后文16继续阅读 后文17继续阅读 后文18继续阅读 后文19继续阅读 后文20继续阅读 后文21继续阅读 后文22继续阅读 后文23继续阅读 后文24继续阅读
        - button "用时 1 秒" [ref=e348] [cursor=pointer]
        - article "助手回复" [ref=e350]:
          - paragraph [ref=e352]: 测试回复完成。
          - button "复制回答" [ref=e354] [cursor=pointer]
        - generic "推荐追问" [ref=e355]:
          - status [ref=e356]: 追问生成失败，请稍后重试
          - button "重试生成追问" [ref=e357] [cursor=pointer]
    - generic [ref=e358]:
      - button "回到最新消息" [ref=e359] [cursor=pointer]
      - generic [ref=e360]:
        - textbox "消息" [ref=e361]:
          - /placeholder: 询问任何问题
        - generic [ref=e362]:
          - generic [ref=e363]:
            - button "添加附件" [ref=e364] [cursor=pointer]
            - button "选择专家或插件" [ref=e365] [cursor=pointer]
            - button "选择技能" [ref=e366] [cursor=pointer]
          - generic [ref=e367]:
            - button "选择模型" [ref=e368] [cursor=pointer]:
              - generic [ref=e369]: 测试模型
            - button "会话审批：请求批准" [ref=e370] [cursor=pointer]
          - button "发送消息" [disabled] [ref=e371]
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