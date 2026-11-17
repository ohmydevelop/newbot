import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { database } from "../server/db.js";
import { importTree } from "../server/import-files.js";
import { automationSchema } from "../shared/automations.js";
import { FakeCodex } from "./fixture.js";

test("D5: v20 migration adds account storage without rewriting legacy task records",()=>{
  const dir=mkdtempSync(join(tmpdir(),"events-migration-"));let db=database(dir);
  try {
    const id=randomUUID(),content=JSON.stringify({name:"legacy",triggers:[],eventTriggers:[{id:randomUUID(),source:"github"}]});
    db.raw.prepare("INSERT INTO automation_tasks VALUES(?,1,?,1,NULL,1,1,0)").run(id,content);
    db.raw.exec("DROP TABLE automation_event_accounts; PRAGMA user_version=20;");db.raw.close();db=database(dir);
    assert.equal(db.raw.prepare("PRAGMA user_version").get()!.user_version,23);
    assert.equal(db.raw.prepare("SELECT content FROM automation_tasks WHERE id=?").get(id)!.content,content);
    assert((db.raw.prepare("PRAGMA table_info(automation_event_accounts)").all() as {name:string}[]).some(c=>c.name==="generation"));
  }finally{db.raw.close();rmSync(dir,{recursive:true,force:true});}
});

async function fixture(
  fn: (f: {
    ctx: Awaited<ReturnType<typeof createServer>>;
    root: string;
    codex: FakeCodex;
    rows: any[];
    calls: { url: string; authorization: string | null }[];
    advance: () => void;
    providerId: string;
    connectionId: string;
    create: () => Promise<any>;
  }) => Promise<void>,
) {
  const dir = mkdtempSync(join(tmpdir(), "events-service-"));
  const root = join(dir, "package");
  cpSync(resolve("examples/github-events"), root, { recursive: true });
  let clock = Date.now();
  const rows = [
    {
      id: 100,
      event: "closed",
      created_at: "2026-11-17T00:00:00Z",
      issue: { number: 1 },
    },
  ];
  const calls: { url: string; authorization: string | null }[] = [];
  const codex = new FakeCodex();
  codex.unload = async (id) => {
    codex.loaded.delete(id);
  };
  const call = codex.call.bind(codex);
  codex.call = async (m, p) => {
    const r: any = await call(m, p);
    if (m === "thread/resume") r.modelProvider = (p as any).modelProvider;
    return r;
  };
  const ctx = await createServer({
    directory: join(dir, "data"),
    cwd: join(dir, "work"),
    codex,
    providerRuntime: null,
    password: "events-test-password",
    automationTimer: false,
    automationClock: () => clock,
    eventSubscriptionFetch: async (url, init) => {
      calls.push({
        url: String(url),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return Response.json(rows);
    },
  });
  try {
    await ctx.service.settings();
    const tree = await importTree(root);
    ctx.db.raw
      .prepare("INSERT INTO extension_packages VALUES(?,?,?,?,?,?)")
      .run(
        "events-package",
        "plugin",
        "github-events",
        root,
        tree.digest,
        JSON.stringify({
          pluginId: "github-events@newbot-imports",
          installed: true,
        }),
      );
    const catalog = await ctx.subscriptions.catalog();
    assert.equal(catalog.providers.length, 1);
    const providerId = catalog.providers[0].id,
      connectionId = randomUUID();
    await ctx.subscriptions.saveAccount({
      id: connectionId,
      revision: 0,
      providerId,
      label: "Test",
      token: "test-secret-not-for-model",
    });
    const create = () =>
      ctx.automations.save({
        id: randomUUID(),
        expectedRevision: 0,
        content: automationSchema.parse({
          name: "插件事件",
          prompt: "汇总事件",
          triggers: [],
          eventTriggers: [
            {
              id: randomUUID(),
              source: "subscription",
              providerId,
              connectionId,
              repository: "owner/repo",
            },
          ],
          notification: "none",
        }),
      });
    await fn({
      ctx,
      root,
      codex,
      rows,
      calls,
      advance: () => {
        clock += 65000;
      },
      providerId,
      connectionId,
      create,
    });
  } finally {
    await ctx.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
}
test("D1-D5: installed declaration, encrypted account, shared outbound queue and persistent task thread", () =>
  fixture(async (f) => {
    const [a, b] = await Promise.all([f.create(), f.create()]);
    assert.equal(
      f.ctx.db.raw
        .prepare("SELECT COUNT(*) n FROM automation_event_routes")
        .get()!.n,
      0,
    );
    assert(
      !JSON.stringify(await f.ctx.subscriptions.catalog()).includes(
        "test-secret",
      ),
    );
    assert(
      !JSON.stringify(
        f.ctx.db.raw.prepare("SELECT * FROM automation_event_accounts").all(),
      ).includes("test-secret"),
    );
    await f.ctx.subscriptions.tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].authorization, "Bearer test-secret-not-for-model");
    assert(
      f.calls[0].url.startsWith("https://api.github.com/repos/owner/repo/"),
    );
    f.rows.unshift({
      id: 200,
      event: "reopened",
      created_at: "2026-11-17T01:00:00Z",
      issue: { number: 1 },
    });
    f.advance();
    await f.ctx.subscriptions.tick();
    assert.equal(f.calls.length, 2);
    await f.ctx.automations.tick();
    const first = [a, b].map((t) => f.ctx.automations.read(t.id).runs[0]);
    for (const r of first) {
      assert.equal(r.state, "running", JSON.stringify(r));
      f.codex.finish(r.threadId!);
    }
    await f.ctx.automations.tick();
    f.rows.unshift({
      id: 300,
      event: "closed",
      created_at: "2026-11-17T02:00:00Z",
      issue: { number: 1 },
    });
    f.advance();
    await f.ctx.subscriptions.tick();
    await f.ctx.automations.tick();
    for (const [i, t] of [a, b].entries()) {
      const r = f.ctx.automations.read(t.id).runs[0];
      assert.equal(r.threadId, first[i].threadId);
      assert.notEqual(r.turnId, first[i].turnId);
      f.codex.finish(r.threadId!);
    }
    await f.ctx.automations.tick();
    assert(
      !JSON.stringify(
        f.ctx.db.raw.prepare("SELECT snapshot FROM automation_runs").all(),
      ).includes("test-secret"),
    );
    f.advance();
    await f.ctx.subscriptions.tick();
    assert.equal(
      f.ctx.db.raw.prepare("SELECT COUNT(*) n FROM automation_runs").get()!.n,
      4,
    );
  }));
test("D1/D2/D3: stale account writes rejected; deletion pauses tasks; package tampering revokes source", () =>
  fixture(async (f) => {
    const task = await f.create();
    await f.ctx.subscriptions.tick();
    await assert.rejects(
      f.ctx.subscriptions.saveAccount({
        id: f.connectionId,
        revision: 0,
        providerId: f.providerId,
        label: "Stale",
        token: "wrong",
      }),
      /已变化/,
    );
    f.ctx.subscriptions.removeAccount({ id: f.connectionId, revision: 1 });
    assert.equal(f.ctx.automations.list()[0].enabled, false);
    await assert.rejects(
      f.ctx.automations.resume(task.id, f.ctx.automations.list()[0].revision),
      /连接/,
    );
    writeFileSync(join(f.root, "newbot-events.json"), "{}");
    assert.equal((await f.ctx.subscriptions.catalog()).providers.length, 0);
    f.advance();
    await f.ctx.subscriptions.tick();
    assert.equal(f.calls.length, 1);
  }));

test("D2/D4: renaming an account preserves the shared checkpoint and does not skip events", () =>
  fixture(async (f) => {
    const task = await f.create();
    await f.ctx.subscriptions.tick();
    await f.ctx.subscriptions.saveAccount({
      id: f.connectionId,
      revision: 1,
      providerId: f.providerId,
      label: "Renamed",
    });
    f.rows.unshift({
      id: 200,
      event: "closed",
      created_at: "2026-11-17T01:00:00Z",
      issue: { number: 1 },
    });
    f.advance();
    await f.ctx.subscriptions.tick();
    assert.equal(f.ctx.automations.read(task.id).runs.length, 1);
    const saved = (await f.ctx.subscriptions.catalog()).accounts[0];
    assert.equal(saved.label, "Renamed");
    assert.equal(saved.revision, 2);
  }));
test("D1/D5: uninstall pauses shared tasks; import without event declaration contributes nothing", () =>
  fixture(async (f) => {
    await f.create();
    await f.create();
    await f.ctx.subscriptions.tick();
    f.ctx.db.raw.prepare("UPDATE extension_packages SET content=?").run(
      JSON.stringify({
        installed: false,
        pluginId: "github-events@newbot-imports",
      }),
    );
    assert.equal((await f.ctx.subscriptions.catalog()).providers.length, 0);
    assert(f.ctx.automations.list().every((t) => !t.enabled));
    f.advance();
    await f.ctx.subscriptions.tick();
    assert.equal(f.calls.length, 1);
    f.ctx.db.raw.prepare("UPDATE extension_packages SET content=?").run(
      JSON.stringify({
        installed: true,
        pluginId: "github-events@newbot-imports",
      }),
    );
    assert.equal((await f.ctx.subscriptions.catalog()).providers.length, 1);
    assert(f.ctx.automations.list().every((t) => !t.enabled));
    const denied = await f.ctx.app.inject({
      method: "GET",
      url: "/api/automations/sources",
    });
    assert.equal(denied.statusCode, 401);
  }));

test("D2/D3/D4: server restart restores encrypted account and checkpoint without replay, then continues the same task thread", () =>
  fixture(async (f) => {
    const task = await f.create();
    await f.ctx.subscriptions.tick();
    f.rows.unshift({
      id: 200,
      event: "closed",
      created_at: "2026-11-17T01:00:00Z",
      issue: { number: 1 },
    });
    f.advance();
    await f.ctx.subscriptions.tick();
    await f.ctx.automations.tick();
    const first = f.ctx.automations.read(task.id).runs[0];
    assert.equal(first.state, "running");
    f.codex.finish(first.threadId!);
    await f.ctx.automations.tick();
    const directory = f.ctx.db.directory;
    await f.ctx.app.close();
    let now = Date.now() + 300000;
    const restarted = await createServer({
      directory,
      cwd: join(directory, "../work"),
      codex: f.codex,
      providerRuntime: null,
      password: "events-test-password",
      automationTimer: false,
      automationClock: () => now,
      eventSubscriptionFetch: async (_url, init) => {
        assert.equal(
          new Headers(init?.headers).get("authorization"),
          "Bearer test-secret-not-for-model",
        );
        return Response.json(f.rows);
      },
    });
    try {
      await f.codex.start();
      await restarted.service.settings();
      await restarted.subscriptions.tick();
      assert.equal(restarted.automations.read(task.id).runs.length, 1);
      f.rows.unshift({
        id: 300,
        event: "closed",
        created_at: "2026-11-17T02:00:00Z",
        issue: { number: 1 },
      });
      now += 65000;
      await restarted.subscriptions.tick();
      await restarted.automations.tick();
      const second = restarted.automations.read(task.id).runs[0];
      assert.equal(second.state, "running", JSON.stringify(second));
      assert.equal(second.threadId, first.threadId);
      assert.notEqual(second.turnId, first.turnId);
      f.codex.finish(second.threadId!);
      await restarted.automations.tick();
    } finally {
      await restarted.app.close();
    }
  }));
