import {chromium,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const output=new URL('./',import.meta.url);
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1280,height:844},colorScheme:'dark'});
try {
 await p.goto('https://integration-love-angela-heated.trycloudflare.com');
 await p.getByLabel('登录密码').fill((await readFile('/home/a/Documents/ChatGPT/newbot/.data/initial-password','utf8')).trim());
 await p.getByRole('button',{name:'继续',exact:true}).click();
 const current=p.locator('.history-link').filter({hasText:'上线验收：只回复'}).first();await current.waitFor();
 const old=p.locator('.history-link').filter({hasText:/UI1[234]|界面验收|部署验收/}).first();
 if(await old.count()) {await old.click();await expect(p.getByRole('button',{name:'交互模式：工作',exact:true})).toBeVisible({timeout:30000});}
 await current.click();await expect(p.getByRole('button',{name:'交互模式：聊天',exact:true})).toBeEnabled({timeout:30000});
 await expect(p.getByText('聊天模式上线正常',{exact:true})).toBeVisible();
 await expect(p.getByText('正在生成相关追问...',{exact:true})).not.toBeVisible();
 await p.getByRole('button',{name:'收起侧栏',exact:true}).click();
 await expect(p.getByRole('button',{name:'展开侧栏',exact:true})).toBeVisible();
 await p.screenshot({path:new URL('live-chat-desktop.png',output).pathname});
 const path=new URL('live-browser.json',output);const report=JSON.parse(await readFile(path,'utf8'));
 report.checks.push('settled-desktop-history-recapture');if(await old.count())report.checks.push('legacy-chat-work-mode-ui');
 await writeFile(path,JSON.stringify(report,null,2)+'\n');
} finally {await b.close();}
