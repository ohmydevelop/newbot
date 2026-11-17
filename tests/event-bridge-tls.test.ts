import {test} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:https";
import {execFileSync} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {eventRequest} from "../server/event-subscriptions/tls.js";

test("private HTTPS: configured CA allows actual TLS, stays scoped to one origin, and cannot bypass hostname checks",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"event-tls-"));
 execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-keyout",join(dir,"key.pem"),"-out",join(dir,"cert.pem"),"-days","1","-subj","/CN=127.0.0.1","-addext","subjectAltName=IP:127.0.0.1"],{stdio:"ignore"});
 const ca=readFileSync(join(dir,"cert.pem"),"utf8"),key=readFileSync(join(dir,"key.pem"));
 const servers=[0,1].map(()=>createServer({cert:ca,key},(_req,res)=>{res.setHeader("Content-Type","application/json");res.end('{"ok":true}');}));
 await Promise.all(servers.map(server=>new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve))));
 const urls=servers.map(server=>`https://127.0.0.1:${(server.address() as {port:number}).port}`);
 const trusted=eventRequest(urls[0],ca),untrusted=eventRequest(urls[0]);
 try{await assert.rejects(untrusted.fetch(urls[0]));assert.deepEqual(await trusted.fetch(urls[0]).then(r=>r.json()),{ok:true});await assert.rejects(trusted.fetch(urls[1]));await assert.rejects(trusted.fetch(urls[0].replace("127.0.0.1","localhost")));}
 finally{await trusted.close();await untrusted.close();await Promise.all(servers.map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));rmSync(dir,{recursive:true,force:true});}
});
