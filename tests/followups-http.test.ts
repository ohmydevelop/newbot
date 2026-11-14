import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
test("followup endpoint requires authentication, owned thread and a strict server-owned context", async()=>{
 const directory=mkdtempSync(join(tmpdir(),"followups-http-"));
 const ctx=await createServer({directory,cwd:join(directory,"work"),codex:new FakeCodex(),providerRuntime:null,password:"followups-http-password",origins:["http://localhost"]});
 let calls=0;ctx.service.followups=Object.assign(async()=>{calls++;return ["具体问题一","具体问题二"]},{pending:()=>0});
 try {
  const url="/api/threads/one/turns/turn/followups";
  assert.equal((await ctx.app.inject({method:"POST",url,headers:{origin:"http://localhost"},payload:{}})).statusCode,401);
  const login=await ctx.app.inject({method:"POST",url:"/api/login",headers:{origin:"http://localhost"},payload:{password:"followups-http-password"}});
  const headers={origin:"http://localhost",cookie:login.headers["set-cookie"]!.toString().split(";")[0]};
  assert.equal((await ctx.app.inject({method:"POST",url,headers,payload:{}})).statusCode,400);
  ctx.db.addThread("one","fixture");
  assert.equal((await ctx.app.inject({method:"POST",url,headers,payload:{context:"override"}})).statusCode,400);
  const good=await ctx.app.inject({method:"POST",url,headers,payload:{}});
  assert.equal(good.statusCode,200);assert.equal(good.json().threadId,"one");assert.equal(good.json().turnId,"turn");assert.equal(calls,1);
 } finally {await ctx.app.close();rmSync(directory,{recursive:true,force:true});}
});
