import { eventPublisher } from "../../packages/event-bridge/publisher.js";
let publisher:ReturnType<typeof eventPublisher>|undefined;
export function normalizeOpenClaw(event:{type:string;action:string;sessionKey?:string;timestamp?:Date;context?:Record<string,unknown>}) {
 const key=event.type+":"+event.action;
 const type=({"message:received":"openclaw.message.received","message:sent":"openclaw.message.sent","command:reset":"openclaw.session.reset"} as Record<string,string>)[key];
 if(!type)return null;
 const context=event.context || {},data:Record<string,string|boolean>={};
 for(const k of ["messageId","channelId","conversationId","accountId"])if(typeof context[k]==="string")data[k]=context[k].slice(0,500);
 if(typeof context.content==="string")data.text=context.content.slice(0,1000);
 if(typeof context.success==="boolean")data.success=context.success;
 if(event.sessionKey)data.session=event.sessionKey.slice(0,500);
 return {type,data};
}
export default async function handler(event:Parameters<typeof normalizeOpenClaw>[0]) {
 const normalized=normalizeOpenClaw(event);if(!normalized)return;
 if(!publisher){const {NEWBOT_EVENT_URL:url,NEWBOT_EVENT_TOKEN:token,NEWBOT_EVENT_SOURCE:source,NEWBOT_EVENT_OUTBOX:directory}=process.env;
 if(!url||!token||!source||!directory)throw new Error("Newbot event bridge is not configured");
 publisher=eventPublisher({url,token,source,directory});}
 publisher.enqueue(normalized.type,normalized.data);
 void publisher.flush().catch(()=>{});
}
