import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.js";
import { importTree } from "../server/import-files.js";
import { automationSchema } from "../shared/automations.js";
import { FakeCodex } from "./fixture.js";

async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "events-service-")),
    root = join(dir, "package"),
    file = join(dir, "mail.json");
  cpSync(resolve(".data/event-plugins/mailbox-events"), root, {
    recursive: true,
  });
  const rows: {
    id: number;
    mailbox: string;
    subject: string;
    unread: boolean;
  }[] = [];
  writeFileSync(file, "[]");
  let clock = Date.now();
  const codex = new FakeCodex();
  const options = {
    directory: join(dir, "data"),
    cwd: join(dir, "work"),
    codex,
    providerRuntime: null,
    password: "events-test-password",
    automationTimer: false,
    automationClock: () => clock,
  };
  let ctx = await createServer(options);
  await ctx.service.settings();
  const tree = await importTree(root);
  ctx.db.raw.prepare("INSERT INTO extension_packages VALUES(?,?,?,?,?,?)").run(
    "events-package",
    "plugin",
    "mailbox-events",
    root,
    tree.digest,
    JSON.stringify({
      pluginId: "mailbox-events@newbot-imports",
      installed: true,
    }),
  );
  const providerId = (await ctx.subscriptions.catalog()).providers[0].id,
    connectionId = randomUUID();
  await ctx.subscriptions.saveAccount({
    id: connectionId,
    revision: 0,
    providerId,
    label: "Inbox",
    values: { file },
    secrets: {},
  });
  return {
    get ctx() {
      return ctx;
    },
    root,
    providerId,
    connectionId,
    codex,
    create: () =>
      ctx.automations.save({
        id: randomUUID(),
        expectedRevision: 0,
        content: automationSchema.parse({
          name: "Plugin event",
          prompt: "Summarize event",
          triggers: [],
          eventTriggers: [
            {
              id: randomUUID(),
              source: "subscription",
              providerId,
              connectionId,
              events: ["mail.received"],
              arguments: { mailbox: "inbox" },
            },
          ],
          notification: "none",
        }),
      }),
    async tick(add = false) {
      if (add) {
        rows.push({
          id: rows.length + 1,
          mailbox: "inbox",
          subject: "new message",
          unread: true,
        });
        writeFileSync(file, JSON.stringify(rows));
      }
      clock += 65000;
      await ctx.subscriptions.tick();
      await ctx.automations.tick();
    },
    async restart() {
      await ctx.app.close();
      ctx = await createServer(options);
      await codex.start();
      await ctx.service.settings();
    },
    async close() {
      await ctx.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("current plugin: shared subscription delivers once per task and subsequent events use the same conversations", async () => {
  const f = await fixture();
  try {
    const tasks = await Promise.all([f.create(), f.create()]);
    await f.tick();
    await f.tick(true);
    const first = tasks.map((t) => f.ctx.automations.read(t.id).runs[0]);
    for (const run of first) {
      assert.equal(run.state, "running");
      f.codex.finish(run.threadId!);
    }
    await f.ctx.automations.tick();
    await f.tick(true);
    for (
      let attempt = 0;
      attempt < 30 &&
      tasks.some((t) => f.ctx.automations.read(t.id).runs.length < 2);
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      await f.tick();
    }
    tasks.forEach((t, i) => {
      const r = f.ctx.automations.read(t.id).runs[0];
      assert.equal(r.threadId, first[i].threadId);
      assert.notEqual(r.id, first[i].id);
      f.codex.finish(r.threadId!);
    });
    await f.ctx.automations.tick();
    await f.tick();
    assert(tasks.every((t) => f.ctx.automations.read(t.id).runs.length === 2));
  } finally {
    await f.close();
  }
});
test("stale account writes fail; account deletion pauses tasks; modified plugin digest revokes its source", async () => {
  const f = await fixture();
  try {
    const task = await f.create();
    await f.tick();
    await assert.rejects(
      f.ctx.subscriptions.saveAccount({
        id: f.connectionId,
        revision: 0,
        providerId: f.providerId,
        label: "stale",
      }),
      /已变化/,
    );
    f.ctx.subscriptions.removeAccount({ id: f.connectionId, revision: 1 });
    assert.equal(f.ctx.automations.read(task.id).task.enabled, false);
    await assert.rejects(
      f.ctx.automations.resume(
        task.id,
        f.ctx.automations.read(task.id).task.revision,
      ),
      /连接/,
    );
    writeFileSync(join(f.root, "newbot-events.json"), "{}");
    assert.equal((await f.ctx.subscriptions.catalog()).providers.length, 0);
    await f.tick(true);
    assert.equal(f.ctx.automations.read(task.id).runs.length, 0);
  } finally {
    await f.close();
  }
});
test("uninstall pauses tasks and reinstall does not silently resume them; v1 manifest contributes no event source", async () => {
  const f = await fixture();
  try {
    await f.create();
    await f.tick();
    f.ctx.db.raw.prepare("UPDATE extension_packages SET content=?").run(
      JSON.stringify({
        pluginId: "mailbox-events@newbot-imports",
        installed: false,
      }),
    );
    assert.equal((await f.ctx.subscriptions.catalog()).providers.length, 0);
    assert(f.ctx.automations.list().every((t) => !t.enabled));
    f.ctx.db.raw.prepare("UPDATE extension_packages SET content=?").run(
      JSON.stringify({
        pluginId: "mailbox-events@newbot-imports",
        installed: true,
      }),
    );
    assert.equal((await f.ctx.subscriptions.catalog()).providers.length, 1);
    assert(f.ctx.automations.list().every((t) => !t.enabled));
    writeFileSync(
      join(f.root, "newbot-events.json"),
      JSON.stringify({
        version: 1,
        sources: [{ id: "old", label: "old", adapter: "old" }],
      }),
    );
    const tree = await importTree(f.root);
    f.ctx.db.raw
      .prepare("UPDATE extension_packages SET digest=?")
      .run(tree.digest);
    assert.equal((await f.ctx.subscriptions.catalog()).providers.length, 0);
  } finally {
    await f.close();
  }
});
test("rename and restart preserve encrypted configuration, cursor, deduplication and fixed conversation", async () => {
  const f = await fixture();
  try {
    const task = await f.create();
    await f.tick();
    await f.tick(true);
    const first = f.ctx.automations.read(task.id).runs[0];
    f.codex.finish(first.threadId!);
    await f.ctx.automations.tick();
    await f.ctx.subscriptions.saveAccount({
      id: f.connectionId,
      revision: 1,
      providerId: f.providerId,
      label: "Renamed",
    });
    const account = f.ctx.db.raw
      .prepare("SELECT * FROM automation_event_accounts")
      .get();
    await f.restart();
    await f.tick();
    assert.deepEqual(
      f.ctx.db.raw.prepare("SELECT * FROM automation_event_accounts").get(),
      account,
    );
    assert.equal(f.ctx.automations.read(task.id).runs.length, 1);
    await f.tick(true);
    const second = f.ctx.automations.read(task.id).runs[0];
    assert.equal(second.state, "running");
    assert.equal(second.threadId, first.threadId);
    assert.notEqual(second.id, first.id);
    assert.equal(f.ctx.automations.read(task.id).runs.length, 2);
  } finally {
    await f.close();
  }
});
