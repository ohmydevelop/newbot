import {readFile} from 'node:fs/promises';
import {createHmac,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export function eventHeaders(source,secret,raw,{id=randomUUID(),timestamp=String(Math.floor(Date.now()/1000)),event='issues'}={}) {
  const mac=(input,key=secret,encoding='hex')=>createHmac('sha256',key).update(input).digest(encoding);
  if(source==='openclaw')return {authorization:'Bearer '+secret,'idempotency-key':id};
  if(source==='github')return {'x-hub-signature-256':'sha256='+mac(raw),'x-github-delivery':id,'x-github-event':event};
  if(source==='hermes')return {'x-webhook-timestamp':timestamp,'x-webhook-signature-v2':mac(timestamp+'.'+raw)};
  if(source==='webhook')return {'webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+mac(id+'.'+timestamp+'.'+raw,Buffer.from(secret.replace(/^whsec_/,''),'base64'),'base64')};
  throw Error('Unknown source: webhook, github, hermes or openclaw required');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [url,source,file,id]=process.argv.slice(2),secret=process.env.NEWBOT_EVENT_SECRET;
 if(!url||!source||!file||!secret)throw Error('Usage: NEWBOT_EVENT_SECRET=... node scripts/send-automation-event.mjs URL SOURCE JSON_FILE [EVENT_ID]');
 const target=new URL(url);
 if(target.protocol!=='https:'&&!(target.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(target.hostname)))throw Error('HTTPS or loopback is required');
 if(target.username||target.password||target.search||target.hash)throw Error('Use the exact event endpoint without credentials or query parameters');
 const raw=await readFile(file,'utf8');JSON.parse(raw);
 if(Buffer.byteLength(raw)>64000)throw Error('Event exceeds 64 KB');
 const response=await fetch(target,{method:'POST',redirect:'error',headers:{'content-type':'application/json',...eventHeaders(source,secret,raw,{id})},body:raw,signal:AbortSignal.timeout(15000)});
 console.log(JSON.stringify({status:response.status,result:await response.json()}));if(!response.ok)process.exitCode=1;
}
