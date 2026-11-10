import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ComposerDrafts } from "../web/composer-drafts.js";
import { mergeOlderHistory, mergeRecentHistory } from "../shared/history.js";
import { reduceAgentEvent } from "../shared/events.js";
import { EventType } from "@ag-ui/core";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import type { Thread } from "../shared/types.js";
const turn = (id: string) => ({
  id,
  status: "completed",
  items: [{ id: id + "-a", type: "agentMessage", text: id }],
});
test("late acknowledgement removes sent attachments but preserves later typing and another conversation draft", () => {
  const d = new ComposerDrafts();
  d.setText("$new", "original");
  d.setFiles("$new", [{ id: "sent", name: "a.txt" }]);
  const sent = d.get("$new");
  d.setText("$new", "next message");
  d.setFiles("$new", [...sent.files, { id: "next", name: "b.txt" }]);
  d.setText("other", "other draft");
  d.acknowledge(sent, "created");
  assert.equal(d.get("created").text, "next message");
  assert.deepEqual(
    d.get("created").files.map((f) => f.id),
    ["next"],
  );
  assert.equal(d.get("other").text, "other draft");
});
test("late uploads and acknowledgements cannot revive an explicitly reset or signed-out draft", () => {
  const d = new ComposerDrafts();
  d.setText("$new", "old");
  const sent = d.get("$new");
  d.reset("$new");
  d.setText("$new", "new");
  d.addFiles(sent, [{ id: "late", name: "late.txt" }]);
  d.acknowledge(sent);
  assert.equal(d.get("$new").text, "new");
  assert.equal(d.get("$new").files.length, 0);
  const another = d.get("$new");
  d.clear();
  d.addFiles(another, [{ id: "late", name: "late.txt" }]);
  assert.equal(d.get("$new").files.length, 0);
});
test("attachment success stays in its original conversation when selection changes", () => {
  const d = new ComposerDrafts(),
    scope = d.get("a");
  d.setText("b", "unrelated");
  d.addFiles(scope, [{ id: "file", name: "ok.txt" }]);
  assert.equal(d.get("a").files.length, 1);
  assert.equal(d.get("b").files.length, 0);
  assert.equal(d.get("b").text, "unrelated");
});
test("older pages deduplicate with the current live turn winning and reject cross-thread or stuck cursors", () => {
  const current = {
    id: "a",
    historyCursor: "c1",
    turns: [{ ...turn("live"), status: "inProgress" }],
  };
  const result = mergeOlderHistory(
    current,
    {
      id: "a",
      historyCursor: "c2",
      turns: [turn("old"), turn("old"), turn("live")],
    },
    "c1",
  );
  assert.deepEqual(
    result.turns.map((t) => t.id),
    ["old", "live"],
  );
  assert.equal(result.turns[1].status, "inProgress");
  assert.throws(() => mergeOlderHistory(current, { id: "b", turns: [] }, "c1"));
  assert.throws(() =>
    mergeOlderHistory(
      current,
      { id: "a", historyCursor: "c1", turns: [] },
      "c1",
    ),
  );
});
test("recent snapshots and streamed deltas preserve explicitly loaded history and the oldest cursor", () => {
  const current = {
    id: "a",
    historyCursor: "older",
    turns: Array.from({ length: 60 }, (_, i) => turn(String(i))),
  };
  const fresh = {
    id: "a",
    historyCursor: "recent",
    turns: current.turns.slice(-30),
  };
  const merged = mergeRecentHistory(current, fresh);
  assert.equal(merged.turns.length, 60);
  assert.equal(merged.historyCursor, "older");
  const streamed = reduceAgentEvent(
    merged,
    {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "59-a",
      delta: " next",
      metadata: { threadId: "a", runId: "59" },
    },
    true,
  );
  assert.equal(streamed.turns.length, 60);
  assert.equal(streamed.turns[59].items[0].text, "59 next");
  assert.equal(
    reduceAgentEvent(
      current,
      { type: EventType.STATE_SNAPSHOT, snapshot: { thread: fresh } },
      true,
    ).turns.length,
    60,
  );
  assert.equal(
    reduceAgentEvent(current, {
      type: EventType.STATE_SNAPSHOT,
      snapshot: { thread: fresh },
    }).turns.length,
    30,
  );
});
test("abandoning an unseen request fences late POSTs across restart without starting native work", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-abandon-")),
    origin = "http://127.0.0.1:3136",
    id = randomUUID();
  let ctx = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "workspace"),
    password: "recovery-test-password",
    origins: [origin],
    codex: new FakeCodex(),
  });
  try {
    await ctx.app.ready();
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "recovery-test-password" },
    });
    const headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    const abandon = () =>
      ctx.app.inject({
        method: "POST",
        url: `/api/agent/runs/${id}/abandon`,
        headers,
        payload: {},
      });
    assert.equal((await abandon()).json().state, "abandoned");
    assert.equal((await abandon()).json().state, "abandoned");
    await ctx.app.close();
    ctx = await createServer({
    providerRuntime: null,
      directory,
      cwd: join(directory, "workspace"),
      password: "recovery-test-password",
      origins: [origin],
      codex: new FakeCodex(),
    });
    await ctx.app.ready();
    const late = await ctx.app.inject({
      method: "POST",
      url: "/api/agent/run",
      headers,
      payload: { requestId: id, text: "must not execute" },
    });
    assert.equal(late.statusCode, 409);
    assert.equal(late.json().state, "abandoned");
    assert.equal(
      (ctx.runtime as FakeCodex).calls.filter(
        (c) => c.method === "turn/start" || c.method === "thread/start",
      ).length,
      0,
    );
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("abandon refuses a recorded or in-flight request and preserves its authoritative state", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-abandon-existing-")),
    origin = "http://127.0.0.1:3136",
    codex = new FakeCodex(),
    ctx = await createServer({
    providerRuntime: null,
      directory,
      cwd: join(directory, "workspace"),
      password: "recovery-test-password",
      origins: [origin],
      codex,
    });
  try {
    await ctx.app.ready();
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "recovery-test-password" },
    });
    const headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    for (const state of ["reserved", "dispatching", "unknown", "accepted"]) {
      const id = randomUUID();
      ctx.db.raw
        .prepare("INSERT INTO runs VALUES(?,?,?,NULL,NULL,?,?,?)")
        .run(id, "f", state, randomUUID(), Date.now(), Date.now());
      const response = await ctx.app.inject({
        method: "POST",
        url: `/api/agent/runs/${id}/abandon`,
        headers,
        payload: {},
      });
      assert.equal(response.statusCode, 409);
      assert.equal(response.json().state, state);
    }
    assert.equal(
      codex.calls.filter((c) => c.method === "turn/start").length,
      0,
    );
    const denied = await ctx.app.inject({
      method: "POST",
      url: `/api/agent/runs/${randomUUID()}/abandon`,
      headers: { ...headers, origin: "https://app.invalid" },
      payload: {},
    });
    assert.equal(denied.statusCode, 403);
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy accepted receipts cannot be fenced as unseen and remain readable", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-legacy-fence-")),
    origin = "http://127.0.0.1:3136",
    id = randomUUID(),
    ctx = await createServer({
    providerRuntime: null,
      directory,
      cwd: join(directory, "workspace"),
      password: "recovery-test-password",
      origins: [origin],
      codex: new FakeCodex(),
    });
  try {
    await ctx.app.ready();
    ctx.db.set(
      `run:${id}`,
      JSON.stringify({
        threadId: "legacy-thread",
        turn: { id: "legacy-turn" },
      }),
    );
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "recovery-test-password" },
    });
    const headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/agent/runs/${id}/abandon`,
      headers,
      payload: {},
    });
    assert.equal(response.statusCode, 409);
    const status = await ctx.app.inject({
      url: `/api/agent/runs/${id}`,
      headers,
    });
    assert.equal(status.json().turn.id, "legacy-turn");
    assert.equal(
      ctx.db.raw.prepare("SELECT * FROM runs WHERE request_id=?").get(id),
      undefined,
    );
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("archive is blocked while a native turn is starting before its first event", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-archive-start-")),
    codex = new FakeCodex(),
    ctx = await createServer({
    providerRuntime: null,
      directory,
      cwd: join(directory, "workspace"),
      password: "recovery-test-password",
      codex,
    });
  let release!: () => void;
  try {
    await ctx.app.ready();
    await ctx.service.settings();
    const thread = (await ctx.service.handle("thread/start", {})) as Thread;
    let reached!: () => void;
    const entered = new Promise<void>((r) => (reached = r)),
      gate = new Promise<void>((r) => (release = r));
    const resume = codex.resume.bind(codex);
    codex.resume = async (id, provider) => {
      reached();
      await gate;
      return resume(id, provider);
    };
    const operation = ctx.service.handle("turn/start", {
      threadId: thread.id,
      text: "starting",
    });
    await entered;
    await assert.rejects(
      () => ctx.service.handle("thread/archive", { threadId: thread.id }),
      /停止/,
    );
    release();
    await operation;
    assert.equal(
      (
        ctx.db.raw
          .prepare("SELECT archived FROM threads WHERE id=?")
          .get(thread.id) as any
      ).archived,
      0,
    );
  } finally {
    release?.();
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
