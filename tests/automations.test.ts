import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { database } from "../server/db.js";
import { automations } from "../server/automations.js";
import { nextOccurrence } from "../server/automation-schedule.js";
import {
  automationSchema,
  type AutomationSchedule,
} from "../shared/automations.js";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
const trigger = (
  patch: Partial<AutomationSchedule> = {},
): AutomationSchedule => ({
  id: randomUUID(),
  frequency: "daily",
  time: "08:00",
  timezone: "Asia/Shanghai",
  date: "2026-11-16",
  weekdays: [],
  ...patch,
});
const input = () =>
  automationSchema.parse({
    name: "晨间简报",
    prompt: "查询今天的天气",
    triggers: [trigger()],
  });
test("timezone, DST, month-end and leap dates preserve wall-time and skip nonexistent dates", () => {
  assert.equal(
    new Date(
      nextOccurrence(trigger(), Date.parse("2026-11-16T00:00Z"))!,
    ).toISOString(),
    "2026-11-17T00:00:00.000Z",
  );
  assert.equal(
    new Date(
      nextOccurrence(
        trigger({ frequency: "monthly", date: "2026-01-31" }),
        Date.parse("2026-02-01T00:00Z"),
      )!,
    ).toISOString(),
    "2026-03-31T00:00:00.000Z",
  );
  assert.equal(
    new Date(
      nextOccurrence(
        trigger({ frequency: "yearly", date: "2024-02-29" }),
        Date.parse("2025-01-01T00:00Z"),
      )!,
    ).toISOString(),
    "2028-02-29T00:00:00.000Z",
  );
  const spring = trigger({
    timezone: "America/New_York",
    time: "02:30",
    date: "2026-01-01",
  });
  assert.equal(
    new Date(
      nextOccurrence(spring, Date.parse("2026-03-08T05:00Z"))!,
    ).toISOString(),
    "2026-03-08T07:30:00.000Z",
  );
  const fall = trigger({
    timezone: "America/New_York",
    time: "01:30",
    date: "2026-01-01",
  });
  assert.equal(
    new Date(
      nextOccurrence(fall, Date.parse("2026-11-01T05:30Z"))!,
    ).toISOString(),
    "2026-11-02T06:30:00.000Z",
  );
  assert.equal(
    nextOccurrence(
      trigger({ frequency: "once" }),
      Date.parse("2026-11-17T00:00Z"),
    ),
    null,
  );
});
async function fixture(fn: (f: any) => Promise<void>) {
  const path = mkdtempSync(join(tmpdir(), "newbot-automation-"));
  const db = database(path);
  let clock = Date.parse("2026-11-15T00:00Z"),
    calls: any[] = [];
  let state = "running";
  const dependencies = {
    now: () => clock,
    ready: () => true,
    validate: async () => {},
    submit: async (p: any) => {
      calls.push(p);
      return {
        statusCode: 200,
        body: { threadId: randomUUID(), turn: { id: randomUUID() } },
      };
    },
    probe: async () => ({ state }),
    cancel: async () => {
      state = "cancelled";
    },
  };
  const a = automations(db, dependencies);
  try {
    await fn({
      a,
      db,
      path,
      calls,
      dependencies,
      setClock: (v: number) => (clock = v),
      setState: (v: string) => (state = v),
    });
  } finally {
    await a.close();
    db.raw.close();
    rmSync(path, { recursive: true, force: true });
  }
}
test("durable schedule, concurrent ticks, isolated runs, snapshot and no overlap", () =>
  fixture(async ({ a, calls, setClock, setState }: any) => {
    const t = await a.save({
      id: randomUUID(),
      expectedRevision: 0,
      content: input(),
    });
    setClock(Date.parse("2026-11-20T01:00Z"));
    await Promise.all([a.tick(), a.tick(), a.tick()]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].threadId, undefined);
    await a.tick();
    assert.equal(calls.length, 1);
    assert.equal(a.read(t.id).runs[0].state, "running");
    assert.equal(
      a.read(t.id).runs[0].scheduledAt,
      Date.parse("2026-11-20T00:00Z"),
    );
    setState("succeeded");
    await a.tick();
    assert.equal(a.notices().length, 1);
    const r = a.runNow(t.id, t.revision, randomUUID());
    assert.equal(a.runNow(t.id, t.revision, r.requestId).id, r.id);
    await a.tick();
    assert.equal(calls.length, 2);
    assert.notEqual(calls[0].requestId, calls[1].requestId);
    const changed = await a.save({
      id: t.id,
      expectedRevision: t.revision,
      content: { ...input(), name: "更名" },
    });
    assert.equal(
      a.read(t.id).runs.find((x: any) => x.id === r.id).name,
      "晨间简报",
    );
    assert.equal(changed.revision, 2);
    await assert.rejects(
      a.save({ id: t.id, expectedRevision: 1, content: input() }),
    );
  }));
test("pause/delete cancel queued work; stale actions fail; started work is not silently cancelled", () =>
  fixture(async ({ a, calls }: any) => {
    const t = await a.save({
      id: randomUUID(),
      expectedRevision: 0,
      content: input(),
    });
    a.runNow(t.id, 1, randomUUID());
    const paused = a.control(t.id, 1, "pause");
    await a.tick();
    assert.equal(calls.length, 0);
    assert.throws(() => a.control(t.id, 1, "resume"));
    a.runNow(t.id, paused.revision, randomUUID());
    await a.tick();
    assert.equal(calls.length, 1);
    a.control(t.id, paused.revision, "delete");
    assert.equal(a.list().length, 0);
    assert.equal(calls.length, 1);
  }));
test("restart reconciles dispatched work without replay, retry is a new explicit request", () =>
  fixture(async ({ a, db, dependencies, calls }: any) => {
    const t = await a.save({
      id: randomUUID(),
      expectedRevision: 0,
      content: input(),
    });
    const r = a.runNow(t.id, 1, randomUUID());
    await a.tick();
    await a.close();
    const resumed = automations(db, {
      ...dependencies,
      probe: async () => ({ state: "unknown" }),
    });
    try {
      await resumed.tick();
      assert.equal(calls.length, 1);
      assert.equal(resumed.read(t.id).runs[0].state, "unknown");
      assert.equal(resumed.list()[0].name, t.name);
      resumed.markRead(r.id);
      assert.equal(resumed.notices().length, 0);
    } finally {
      await resumed.close();
    }
  }));
test("automatic HTTP execution shares ordinary validation, modes, cancellation and authentication", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-auto-http-"));
  const codex = new FakeCodex();
  let now = Date.parse("2026-11-15T00:00Z");
  const ctx = await createServer({
    directory,
    cwd: join(directory, "work"),
    codex,
    providerRuntime: null,
    password: "long-test-password",
    origins: ["http://localhost:3100"],
    automationClock: () => now,
    automationTimer: false,
  });
  try {
    await ctx.service.settings();
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://localhost:3100" },
      payload: { password: "long-test-password" },
    });
    const headers = {
      origin: "http://localhost:3100",
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    assert.equal(
      (await ctx.app.inject({ url: "/api/automations" })).statusCode,
      401,
    );
    const task = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/automations/save",
        headers,
        payload: { id: randomUUID(), expectedRevision: 0, content: input() },
      })
    ).json();
    assert(task.id, JSON.stringify(task));
    const id = randomUUID();
    const run = await ctx.app.inject({
      method: "POST",
      url: "/api/automations/run",
      headers,
      payload: { id: task.id, revision: 1, requestId: id },
    });
    assert.equal(run.statusCode, 200, run.body);
    await ctx.automations.tick();
    const r = ctx.automations.read(task.id).runs[0];
    assert.equal(r.state, "running", JSON.stringify(r));
    assert.equal(ctx.service.runtimeSettings.get(r.threadId!).mode, "chat");
    codex.finish(r.threadId!);
    await ctx.automations.tick();
    assert.equal(ctx.automations.read(task.id).runs[0].state, "succeeded");
    assert.equal(ctx.automations.notices().length, 1);
    const second = ctx.automations.runNow(task.id, 1, randomUUID());
    await ctx.automations.tick();
    const r2 = ctx.automations
      .read(task.id)
      .runs.find((x) => x.id === second.id)!;
    assert.notEqual(r2.threadId, r.threadId);
    await ctx.automations.stop(second.id);
    assert.equal(
      ctx.automations.read(task.id).runs.find((x) => x.id === second.id)!.state,
      "cancelled",
    );
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("capacity retries preserve request; private authorization blocks instead of granting itself", () =>
  fixture(async ({ a, calls, dependencies }: any) => {
    const task = await a.save({
      id: randomUUID(),
      expectedRevision: 0,
      content: input(),
    });
    const run = a.runNow(task.id, 1, randomUUID());
    dependencies.submit = async (p: any) => {
      calls.push(p);
      return { statusCode: 429, body: { error: "busy" } };
    };
    await a.tick();
    assert.equal(a.result(run.id).state, "queued");
    let cancelled = false;
    dependencies.cancel = async () => {
      cancelled = true;
    };
    dependencies.submit = async (p: any) => {
      calls.push(p);
      return { statusCode: 200, body: { state: "awaiting_credentials" } };
    };
    await a.tick();
    assert.equal(a.result(run.id).state, "blocked");
    assert.equal(cancelled, true);
    assert.equal(calls[0].requestId, calls[1].requestId);
    await a.tick();
    assert.equal(calls.length, 2);
  }));
test("pagination retains unread counts and pinned attachments survive cleanup until task deletion", () =>
  fixture(async ({ a, db, path, setState }: any) => {
    const { fileStore } = await import("../server/files.js");
    const files = fileStore(path, db);
    const file = files.save("schedule.txt", Buffer.from("scheduled context"));
    db.raw.prepare("UPDATE attachments SET created=1 WHERE id=?").run(file.id);
    const task = await a.save({
      id: randomUUID(),
      expectedRevision: 0,
      content: { ...input(), attachments: [file.id] },
    });
    assert.equal(files.cleanup(), 0);
    for (let i = 0; i < 55; i++) {
      a.runNow(task.id, 1, randomUUID());
      await a.tick();
      setState("succeeded");
      await a.tick();
    }
    const first = a.read(task.id);
    assert.equal(first.runs.length, 50);
    assert.equal(first.task.unread, 55);
    assert(first.nextCursor);
    const second = a.read(task.id, first.nextCursor);
    assert.equal(second.runs.length, 5);
    assert.equal(second.nextCursor, null);
    assert.equal(
      new Set([...first.runs, ...second.runs].map((r: any) => r.id)).size,
      55,
    );
    a.control(task.id, 1, "delete");
    assert.equal(files.cleanup(), 1);
  }));
