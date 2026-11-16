import {chromium} from 'playwright-core';
const browser=await chromium.launch({headless:true}); const page=await browser.newPage({viewport:{width:390,height:720},isMobile:true,hasTouch:true});
await page.setContent(`<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}.outer{height:600px;overflow:auto}.inner{height:250px;overflow:auto;background:#ddd}</style><div class=outer><div style="height:300px">before</div><div class=inner><div style="height:1500px">inner</div></div><div style="height:1000px">after</div></div>`);
await page.locator('.outer').evaluate(e=>e.scrollTop=200);
const cdp=await page.context().newCDPSession(page);
await page.locator('.inner').evaluate(e=>e.scrollTop=600);
for(let j=0;j<9;j++) {await page.waitForTimeout(800);await page.waitForTimeout(50);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:0,x:195,y:140}]});for(let i=1;i<=16;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:0,x:195,y:140+i*15*(j===0?-1:1)}]});await page.waitForTimeout(16)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(800);console.log(await page.evaluate(()=>Array.from(document.querySelectorAll('.inner,.outer')).map(e=>({class:e.className,top:e.scrollTop}))));}
await browser.close();
