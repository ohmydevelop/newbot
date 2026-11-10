import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { SkillsCodex } from "./skill-fixture.js";
import { runStore } from "../server/runs.js";
import { database } from "../server/db.js";
import type { Json } from "../shared/types.js";
const origin = "http://127.0.0.1:3100",
  password = "skill-run-test-password";
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "newbot-skill-use-"));
  const codex = new SkillsCodex(directory);
  const options = {
    providerRuntime: null,
    directory: join(directory, "app"),
    cwd: join(directory, "workspace"),
    codex,
    password,
    origins: [origin],
  };
  let ctx = await createServer(options);
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password },
  });
  const headers = {
    origin,
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
  };
  const post = (payload: any) =>
    ctx.app.inject({ method: "POST", url: "/api/agent/run", headers, payload });
  const doc = await ctx.service.skills.read(
    (await ctx.service.skills.list()).skills[0].id,
  );
  const selected = { id: doc.skill.id, sha256: doc.sha256 };
  return {
    directory,
    codex,
    options,
    headers,
    post,
    selected,
    doc,
    getRun(id: string) {
      return runStore(ctx.db).get(id);
    },
    get ctx() {
      return ctx;
    },
    async restart() {
      await ctx.app.close();
      ctx = await createServer(options);
    },
    async close() {
      await ctx.app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("selected skills become ordered native skill inputs derived from fresh discovery, alongside normal text and attachments", async () => {
  const c = await setup();
  try {
    c.codex.skills[1].enabled = true;
    const other = await c.ctx.service.skills.read(
      (await c.ctx.service.skills.list()).skills[1].id,
    );
    const file = (
      await c.ctx.app.inject({
        method: "POST",
        url: "/api/attachments?name=note.txt",
        headers: { ...c.headers, "content-type": "application/octet-stream" },
        payload: Buffer.from("fixture attachment"),
      })
    ).json();
    const requestId = randomUUID();
    const result = await c.post({
      requestId,
      text: "Review using the selected skills",
      attachments: [file.id],
      skills: [c.selected, { id: other.skill.id, sha256: other.sha256 }],
    });
    assert.equal(result.statusCode, 200, result.body);
    const call = c.codex.calls
      .filter((call) => call.method === "turn/start")
      .at(-1)!;
    assert.deepEqual(
      call.params.input.filter((input: Json) => input.type === "skill"),
      [
        { type: "skill", name: "code-review", path: c.doc.skill.path },
        { type: "skill", name: "disabled-skill", path: other.skill.path },
      ],
    );
    assert.equal(
      call.params.input.filter((input: Json) => input.type === "text").length,
      2,
    );
    const view = (
      await c.ctx.app.inject({
        url: `/api/threads/${result.json().threadId}`,
        headers: c.headers,
      })
    ).json();
    const item = view.turns[0].items.find(
      (i: Json) => i.type === "userMessage",
    );
    assert.equal(item.skillRefs.length, 2);
    assert.equal(item.skillRefs[0].displayName, "代码审查");
    assert.equal(item.skillRefs[0].sha256, c.selected.sha256);
    assert.ok(item.content.some((i: Json) => i.type === "attachment"));
    assert.ok(!JSON.stringify(item.skillRefs).includes(c.directory));
    const snapshot = c.ctx.service.events.snapshot(
      result.json().threadId,
    ) as any;
    assert.equal(
      snapshot.snapshot.thread.turns[0].items[0].skillRefs[0].sha256,
      c.selected.sha256,
    );
  } finally {
    await c.close();
  }
});
test("skill selections reject forged fields, duplicates, stale hashes, disabled, missing and unsafe skills before reserving or creating a thread", async () => {
  const c = await setup();
  try {
    const disabled = (await c.ctx.service.skills.list()).skills[1];
    const disabledDoc = await c.ctx.service.skills.read(disabled.id);
    const invalid: any[] = [
      [{ ...c.selected, path: "/etc/passwd" }],
      [c.selected, c.selected],
      Array.from({ length: 9 }, (_, n) => ({
        id: String(n).repeat(64),
        sha256: c.selected.sha256,
      })),
      [{ id: "a".repeat(64), sha256: c.selected.sha256 }],
      [{ id: c.selected.id, sha256: "f".repeat(64) }],
      [{ id: disabled.id, sha256: disabledDoc.sha256 }],
    ];
    for (const skills of invalid) {
      const requestId = randomUUID();
      const response = await c.post({
        requestId,
        text: "must not dispatch",
        skills,
      });
      assert.ok(response.statusCode >= 400, response.body);
      assert.equal(c.getRun(requestId), undefined);
    }
    unlinkSync(c.doc.skill.path);
    assert.equal(
      (
        await c.post({
          requestId: randomUUID(),
          text: "missing",
          skills: [c.selected],
        })
      ).statusCode,
      410,
    );
    assert.equal(
      c.codex.calls.filter(
        (call) =>
          call.method === "thread/start" || call.method === "turn/start",
      ).length,
      0,
    );
  } finally {
    await c.close();
  }
});
test("pre-dispatch revalidation catches changes after initial validation, releases references and never invokes a model", async () => {
  const c = await setup();
  try {
    const resume = c.codex.resume.bind(c.codex);
    c.codex.resume = async (...args) => {
      const result = await resume(...args);
      writeFileSync(c.doc.skill.path, "# Changed after validation");
      return result;
    };
    const requestId = randomUUID();
    const response = await c.post({
      requestId,
      text: "must fail closed",
      skills: [c.selected],
    });
    assert.equal(response.statusCode, 409, response.body);
    assert.equal(c.getRun(requestId)!.state, "rejected");
    assert.equal(
      (c.ctx.db.raw.prepare("SELECT COUNT(*) n FROM run_skills").get() as any)
        .n,
      0,
    );
    assert.equal(
      c.codex.calls.filter((call) => call.method === "turn/start").length,
      0,
    );
  } finally {
    await c.close();
  }
});
test("successful retries preserve idempotency even when a skill later disappears; empty selections keep old fingerprints", async () => {
  const c = await setup();
  try {
    const requestId = randomUUID(),
      payload = { requestId, text: "once", skills: [c.selected] };
    const response = await c.post(payload);
    assert.equal(response.statusCode, 200, response.body);
    c.codex.finish(response.json().threadId);
    c.codex.skills = [];
    assert.equal(
      (await c.post(payload)).json().turn.id,
      response.json().turn.id,
    );
    assert.equal((await c.post({ ...payload, skills: [] })).statusCode, 400);
    const secondId = randomUUID();
    const first = await c.post({ requestId: secondId, text: "ordinary" });
    assert.equal(first.statusCode, 200);
    assert.equal(
      (
        await c.post({ requestId: secondId, text: "ordinary", skills: [] })
      ).json().turn.id,
      first.json().turn.id,
    );
    assert.equal(
      c.codex.calls.filter((call) => call.method === "turn/start").length,
      2,
    );
  } finally {
    await c.close();
  }
});
test("skill references survive restart and archive, retain original names/hashes after edits, and are associated with the correct user item only", async () => {
  const c = await setup();
  try {
    const response = await c.post({
      requestId: randomUUID(),
      text: "remember skill",
      skills: [c.selected],
    });
    const threadId = response.json().threadId;
    c.codex.finish(threadId);
    c.codex.skills[0].name = "renamed";
    c.codex.skills[0].enabled = false;
    writeFileSync(c.doc.skill.path, "# Updated skill instructions");
    await c.ctx.service.handle("thread/archive", { threadId });
    await c.restart();
    const view = await c.ctx.service.read(threadId);
    const ref = view.turns[0].items[0].skillRefs![0];
    assert.equal(ref.name, "code-review");
    assert.equal(ref.sha256, c.selected.sha256);
    const current = await c.ctx.service.skills.read(c.selected.id);
    assert.notEqual(current.sha256, ref.sha256);
    assert.equal(current.skill.enabled, false);
    const wrong = structuredClone(view);
    wrong.turns[0].items[0].id = "other-user";
    wrong.turns[0].items[0].clientId = "other-client";
    delete wrong.turns[0].items[0].skillRefs;
    c.ctx.service.skillUses.decorate(wrong);
    assert.equal(wrong.turns[0].items[0].skillRefs, undefined);
    assert.equal(
      (
        await c.ctx.app.inject({
          url: "/api/threads/not-owned",
          headers: c.headers,
        })
      ).statusCode,
      400,
    );
  } finally {
    await c.close();
  }
});
test("unknown dispatch keeps skill references, reconciles by canonical native client ID, and never dispatches a duplicate", async () => {
  const c = await setup();
  try {
    const emit = c.codex.emit.bind(c.codex);
    c.codex.emit = ((event: string, ...args: any[]) => {
      if (
        event === "event" &&
        args[0]?.method === "item/completed" &&
        args[0].params.item.type === "userMessage"
      )
        return false;
      return emit(event, ...args);
    }) as typeof c.codex.emit;
    const call = c.codex.call.bind(c.codex);
    c.codex.call = (async (method: any, params: any) => {
      const value = await call(method, params);
      if (method === "turn/start") throw new Error("lost native response");
      return value;
    }) as typeof c.codex.call;
    const requestId = randomUUID();
    assert.equal(
      (await c.post({ requestId, text: "unknown", skills: [c.selected] }))
        .statusCode,
      400,
    );
    assert.equal(c.getRun(requestId)!.state, "unknown");
    const response = await c.ctx.app.inject({
      url: `/api/agent/runs/${requestId}`,
      headers: c.headers,
    });
    assert.equal(response.json().state, "accepted");
    c.codex.finish(response.json().threadId);
    const view = await c.ctx.service.read(response.json().threadId);
    assert.equal(
      view.turns[0].items[0].skillRefs![0].sha256,
      c.selected.sha256,
    );
    assert.equal(
      (
        await c.post({ requestId, text: "unknown", skills: [c.selected] })
      ).json().turn.id,
      response.json().turn.id,
    );
    assert.equal(
      c.codex.calls.filter((entry) => entry.method === "turn/start").length,
      1,
    );
  } finally {
    await c.close();
  }
});
test("v2 database upgrade adds only the skill reference table and keeps existing sessions and conversations", () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-v2-skills-"));
  try {
    const before = database(directory);
    before.raw.exec("DROP TABLE run_skills; PRAGMA user_version=2;");
    before.raw
      .prepare("INSERT INTO threads VALUES('old','existing','fixture',1,0)")
      .run();
    before.raw
      .prepare("INSERT INTO sessions VALUES('keep',9999999999999)")
      .run();
    before.raw.close();
    const after = database(directory);
    assert.equal(
      (after.raw.prepare("PRAGMA user_version").get() as any).user_version,
      7,
    );
    assert.equal(after.owns("old"), true);
    assert.equal(
      (after.raw.prepare("SELECT COUNT(*) n FROM sessions").get() as any).n,
      1,
    );
    assert.equal(
      (after.raw.prepare("SELECT COUNT(*) n FROM run_skills").get() as any).n,
      0,
    );
    after.raw.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
