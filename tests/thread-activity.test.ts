import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { database } from "../server/db.js";
import { threadActivity } from "../server/thread-activity.js";
import { EventFeed } from "../server/event-feed.js";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { randomUUID } from "node:crypto";
import { EventType } from "@ag-ui/core";

test("activity is durable, ignores stale terminal/started/read events, and reaches all subscribed conversations", () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-activity-"));
  let db = database(dir);
  try {
    for (const id of ["a", "b"]) db.addThread(id, "fixture");
    let activity: ReturnType<typeof threadActivity>;
    const feed = new EventFeed(() => [activity.snapshot()]);
    activity = threadActivity(db, (e) => feed.push(e));
    const state = (id = "a") =>
      (db.list() as any[]).find((t) => t.id === id).activity;
    const emit = (id: string, turn: string, status?: string) =>
      activity.notification({
        method: status ? "turn/completed" : "turn/started",
        params: { threadId: id, turn: { id: turn, status } },
      });
    activity.prepare("a", "r1");
    assert.equal(state().state, "preparing");
    emit("a", "t1");
    activity.prepare("a", "duplicate");
    activity.rejected("a", "duplicate", false);
    assert.equal(state().state, "running");
    activity.approval(1, { threadId: "a", turnId: "t1" });
    activity.approval(2, { threadId: "a", turnId: "t1" });
    activity.resolved(1);
    assert.equal(state().state, "waiting");
    activity.resolved(2);
    assert.equal(state().state, "running");
    emit("a", "t1", "completed");
    const complete = state().revision;
    emit("a", "t1");
    assert.equal(state().revision, complete);
    const read: any = { id: "a", turns: [{ id: "t1", status: "completed" }] };
    activity.reconcile(read, false, true);
    assert.equal(state().seenRevision, complete);
    activity.prepare("a", "r2");
    emit("a", "t2");
    emit("a", "t1", "failed");
    emit("a", "t1");
    activity.reconcile(read, false, true, complete);
    assert.equal(state().state, "running");
    assert.equal(state().turnId, "t2");
    activity.prepare("b", "rb");
    emit("b", "tb");
    emit("b", "tb", "failed");
    assert.equal(state("b").state, "failed");
    const initial = feed.read(undefined, "a");
    assert.ok(
      (initial.events[0] as any).value.some((r: any) => r.threadId === "b"),
    );
    emit("b", "tb", "interrupted");
    const update = feed.read(initial.cursor, "a");
    assert.ok(update.events.some((e: any) => e.value.threadId === "b"));
    db.raw.close();
    db = database(dir);
    activity = threadActivity(db, (e) => feed.push(e));
    assert.equal(state().state, "unknown");
    assert.equal(state("b").state, "interrupted");
    activity.reconcile(
      { id: "a", turns: [{ id: "t2", status: "inProgress" }] } as any,
      false,
    );
    assert.equal(state().state, "unknown");
    activity.reconcile(
      { id: "a", turns: [{ id: "t2", status: "completed" }] } as any,
      false,
      true,
    );
    assert.equal(state().state, "completed");
  } finally {
    db.raw.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("accepted run is running until native completion; offline has an unknown outcome", async () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-activity-api-")),
    codex = new FakeCodex(),
    origin = "http://127.0.0.1:3100";
  const ctx = await createServer({
    directory: dir,
    cwd: join(dir, "work"),
    codex,
    providerRuntime: null,
    password: "activity-test-login",
    origins: [origin],
  });
  try {
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "activity-test-login" },
    });
    const headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    const run = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers,
      payload: { text: "activity", requestId: randomUUID() },
    });
    assert.equal(run.statusCode, 200, run.body);
    const id = run.json().threadId;
    const list = async () =>
      (await ctx.app.inject({ url: "/api/threads", headers })).json();
    assert.equal(run.json().state, "accepted");
    assert.equal((await list())[0].activity.state, "running");
    codex.emit("approval", {
      id: 33,
      method: "item/commandExecution/requestApproval",
      params: { threadId: id, turnId: run.json().turn.id, command: "test" },
    });
    assert.equal((await list())[0].activity.state, "waiting");
    codex.emit("resolved", 33);
    assert.equal((await list())[0].activity.state, "running");
    codex.finish(id);
    assert.equal((await list())[0].activity.state, "completed");
    const next = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers,
      payload: { threadId: id, text: "again", requestId: randomUUID() },
    });
    assert.equal(next.statusCode, 200, next.body);
    codex.state = "offline";
    codex.emit("status");
    assert.equal((await list())[0].activity.state, "unknown");
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sidebar consumes background summary updates and a late list response cannot overwrite a newer event", async () => {
  const descriptors = new Map(
    ["window", "localStorage", "sessionStorage"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const storage = {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  };
  Object.assign(globalThis, {
    window: { innerWidth: 1200 },
    localStorage: storage,
    sessionStorage: storage,
  });
  const { consume, loadThreads, useApp } = await import("../web/store.js");
  const originalFetch = globalThis.fetch;
  let resolve: (r: Response) => void = () => {};
  const older = {
    state: "running",
    turnId: "t1",
    revision: 3,
    updated: 1,
    seenRevision: 0,
  };
  useApp.setState({
    threads: [
      {
        id: "b",
        title: "B",
        provider: "p",
        updated: 1,
        archived: 0,
        activity: older as any,
      },
    ],
    selectedId: "a",
  });
  try {
    globalThis.fetch = async () =>
      new Promise<Response>((done) => {
        resolve = done;
      });
    const loading = loadThreads();
    consume({
      type: EventType.CUSTOM,
      name: "newbot.activity",
      value: {
        threadId: "b",
        activity: { ...older, state: "failed", revision: 4 },
      },
    });
    resolve(
      new Response(
        JSON.stringify([
          {
            id: "b",
            title: "B",
            provider: "p",
            updated: 1,
            archived: 0,
            activity: older,
          },
        ]),
        { status: 200,headers:{"Content-Type":"application/json"} },
      ),
    );
    await loading;
    assert.equal(useApp.getState().threads[0].activity?.state, "failed");
    consume({
      type: EventType.CUSTOM,
      name: "newbot.activity",
      value: { threadId: "b", activity: { ...older, state: "completed" } },
    });
    assert.equal(useApp.getState().threads[0].activity?.state, "failed");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    useApp.setState({ threads: [], selectedId: null });
  }
});

test("waiting combines approval, input and A2UI without leaking content or reviving ended turns", () => {
  const dir=mkdtempSync(join(tmpdir(),"newbot-waiting-")); const db=database(dir);
  try {
    db.addThread("a","fixture"); const events:any[]=[];
    const activity=threadActivity(db,e=>events.push(e));
    const start=()=>activity.notification({method:"turn/started",params:{threadId:"a",turn:{id:"t"}}});
    const state=()=> (db.list()[0] as any).activity;
    start(); activity.approval(1,{threadId:"a",turnId:"t",command:"private-test-value"},"item/commandExecution/requestApproval");
    const revision=state().revision;
    activity.approval(2,{threadId:"a",turnId:"t"},"item/tool/requestUserInput");
    activity.uiWaiting("a",[{id:"form",turnId:"t"}]);
    assert.deepEqual([state().waiting.reason,state().waiting.count],["mixed",3]);
    assert.ok(state().revision>revision); start(); assert.equal(state().state,"waiting");
    activity.resolved(1); assert.deepEqual([state().waiting.reason,state().waiting.count],["input",2]);
    activity.resolved(2); assert.equal(state().waiting.target.kind,"a2ui");
    activity.uiWaiting("a",[]); assert.equal(state().state,"running");
    activity.notification({method:"turn/completed",params:{threadId:"a",turn:{id:"t",status:"completed"}}});
    activity.approval(3,{threadId:"a",turnId:"t"}); activity.uiWaiting("a",[{id:"late",turnId:"t"}]);
    assert.equal(state().state,"completed"); assert.equal(state().waiting,undefined);
    assert.ok(!JSON.stringify(events).includes("private-test-value"));
  } finally { db.raw.close();rmSync(dir,{recursive:true,force:true}); }
});
