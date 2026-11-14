import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
test("attachment-only submission reaches native once, preserves attachment identity, and rejects an empty message", async () => {
  const directory = await mkdtemp(join(tmpdir(), "newbot-media-")),
    origin = "http://127.0.0.1:3152",
    codex = new FakeCodex();
  const ctx = await createServer({
    directory,
    cwd: directory,
    providerRuntime: null,
    codex,
    password: "test-media-login",
    origins: [origin],
  });
  try {
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "test-media-login" },
    });
    const headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    const empty = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers,
      payload: { text: " ", requestId: randomUUID() },
    });
    assert.equal(empty.statusCode, 400);
    const uploaded = await ctx.app.inject({
      method: "POST",
      url: "/api/attachments?name=note.txt",
      headers: { ...headers, "content-type": "application/octet-stream" },
      payload: Buffer.from("Synthetic attachment"),
    });
    assert.equal(uploaded.statusCode, 200);
    const expert = await ctx.service.experts.save({name:"附件专家",instructions:"ATTACHMENT_EXPERT_PROMPT",skillIds:[],pluginIds:[],connectorIds:[]});
    const payload = {
      expertId: expert.id,
      text: "",
      attachments: [uploaded.json().id],
      requestId: randomUUID(),
    };
    const sent = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers,
      payload,
    });
    assert.equal(sent.statusCode, 200, sent.body);
    const again = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers,
      payload,
    });
    assert.equal(again.statusCode, 200, again.body);
    assert.equal(
      codex.calls.filter((c) => c.method === "turn/start").length,
      1,
    );
    const user = ctx.service.events.threads
      .get(sent.json().threadId)!
      .turns[0].items.find((i) => i.type === "userMessage");
    assert.ok(user);
    const input = codex.calls.find((c) => c.method === "turn/start")!.params
      .input;
    assert.ok(
      input.every((i: any) => i.type !== "text" || i.text.trim().length > 0),
    );
    assert.ok(JSON.stringify(input).includes("Synthetic attachment"));
    assert.ok(input.some((i:any)=>i.text?.includes("ATTACHMENT_EXPERT_PROMPT")));
    const history=await ctx.app.inject({url:"/api/threads/"+sent.json().threadId,headers});
    assert.equal(history.statusCode,200,history.body);
    assert.doesNotMatch(JSON.stringify(history.json().turns.flatMap((t:any)=>t.items.filter((i:any)=>i.type === "userMessage"))),/ATTACHMENT_EXPERT_PROMPT/);
    const file = await ctx.app.inject({
      url: `/api/files/${uploaded.json().id}`,
      headers,
    });
    assert.equal(file.statusCode, 200);
    assert.equal(file.body, "Synthetic attachment");
  } finally {
    await ctx.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
