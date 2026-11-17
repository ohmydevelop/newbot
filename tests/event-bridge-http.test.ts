import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:https";
import {randomUUID} from "node:crypto";
import {execFileSync} from "node:child_process";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {WebStandardStreamableHTTPServerTransport} from "@modelcontextprotocol/server";
import {eventServer} from "../packages/event-bridge/server.js";
import {openEventConnection} from "../server/event-subscriptions/connection.js";
import {discoverEvents,mcpEventAdapter} from "../server/event-subscriptions/mcp-adapter.js";
import {importTree} from "../server/import-files.js";
import {pluginDescriptors} from "../server/plugin-descriptor.js";

test("real MCP Streamable HTTP over private HTTPS discovers and consumes events using saved CA without an Agent loop",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"event-mcp-http-"));
 execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",join(dir,"key.pem"),"-out",join(dir,"cert.pem"),"-days","1","-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1"],{stdio:"ignore"});
 let published=false;
 const server=eventServer("http-events",[{name:"test.event",delivery:["poll"],inputSchema:{type:"object"},payloadSchema:{type:"object"}}],async input=>({cursor:published?"1":"0",events:input.cursor!==null && input.cursor!=="1" && published?[{eventId:"one",name:"test.event",timestamp:"2026-11-17T00:00:00Z",data:{message:"HTTP event"}}]:[]}));
 const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:()=>randomUUID(),enableJsonResponse:true});await server.connect(transport);
 const ca=readFileSync(join(dir,"cert.pem"),"utf8");
 const http=createServer({cert:ca,key:readFileSync(join(dir,"key.pem"))},async(req,res)=>{
  try{
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   const response=await transport.handleRequest(new Request(`https://${req.headers.host}${req.url}`,{method:req.method,headers:req.headers as Record<string,string>,...(!["GET","HEAD"].includes(req.method!)?{body:Buffer.concat(chunks)}:{})}));
   res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)for await(const chunk of response.body as any)res.write(chunk);res.end();
  }catch{res.writeHead(500);res.end();}
 });
 await new Promise<void>(resolve=>http.listen(0,"127.0.0.1",resolve));
 writeFileSync(join(dir,".mcp.json"),JSON.stringify({mcpServers:{events:{url:`https://127.0.0.1:${(http.address() as {port:number}).port}/mcp`}}}));
 const tree=await importTree(dir),[descriptor]=await pluginDescriptors("https-events",dir,tree.digest);
 const peer=await openEventConnection({descriptor,values:{},secrets:{},caCertificate:ca});
 try{
  assert.equal((await discoverEvents(peer))[0].name,"test.event");const adapter=mcpEventAdapter(async()=>peer);
  const context={connectionId:"test",resource:JSON.stringify({name:"test.event",arguments:{}}),cursor:null as string|null,signal:AbortSignal.timeout(10000)};
  context.cursor=(await adapter.pull(context)).cursor;published=true;const page=await adapter.pull(context);assert.equal(page.events[0].payload.message,"HTTP event");
 }finally{await peer.close();await server.close();http.closeAllConnections();await new Promise<void>(resolve=>http.close(()=>resolve()));rmSync(dir,{recursive:true,force:true});}
});
