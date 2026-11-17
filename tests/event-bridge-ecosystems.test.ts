import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {relayServer} from "../services/event-relay/server.js";

test("packaged OpenClaw JS and Hermes Python hooks publish through real outbound HTTP without host provider changes",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"event-hooks-")),relay=relayServer({directory:join(dir,"relay"),adminToken:"a".repeat(40)});
 await relay.app.listen({host:"127.0.0.1",port:0});const route=relay.store.createRoute();
 const env={...process.env,NEWBOT_EVENT_URL:`http://127.0.0.1:${(relay.app.server.address() as {port:number}).port}/v1/routes/${route.id}/events`,NEWBOT_EVENT_TOKEN:route.producer,NEWBOT_EVENT_SOURCE:"urn:test:hooks"};
 try{
  const module=resolve(".data/event-plugins/openclaw-event-bridge/handler.js");
  await promisify(execFile)(process.execPath,["--input-type=module","-e",`const {default:hook}=await import(${JSON.stringify(module)});await hook({type:"message",action:"received",context:{content:"hello",cfg:{password:"never-export-this"}}});await new Promise(r=>setTimeout(r,500));`],{env:{...env,NEWBOT_EVENT_OUTBOX:join(dir,"openclaw")},timeout:10000});
  const python=resolve(".data/event-plugins/hermes-event-bridge/handler.py");
  await promisify(execFile)("python3",["-c",`import importlib.util,asyncio\ns=importlib.util.spec_from_file_location("bridge",${JSON.stringify(python)})\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nasyncio.run(m.handle("agent:end",{"response":"done","token":"never-export-this"}))\nm.flush()`],{env:{...env,NEWBOT_EVENT_OUTBOX:join(dir,"hermes")},timeout:10000});
  const page=relay.store.lease(route.id);assert.deepEqual(page.events.map(e=>e.type).sort(),["hermes.agent.completed","openclaw.message.received"]);assert(!JSON.stringify(page).includes("never-export-this"));
 }finally{await relay.app.close();rmSync(dir,{recursive:true,force:true});}
});
