import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { database } from "../server/db.js";
import { a2uiStore } from "../server/a2ui-store.js";
import { a2uiManager } from "../server/a2ui.js";
import { A2uiFixtureCodex, formMessages } from "./a2ui-fixture.js";
import type { A2uiView } from "../shared/a2ui-chat.js";
function setup() {
  const directory = mkdtempSync(join(tmpdir(), "newbot-ui-store-"));
  const db = database(directory);
  db.raw.prepare("INSERT INTO threads VALUES('t','form','fixture',1,0)").run();
  const view = (): A2uiView => ({
    id: randomUUID(),
    threadId: "t",
    turnId: "turn",
    itemId: randomUUID(),
    surfaceId: "monitor-demo",
    revision: 1,
    state: "display",
    messages: formMessages(),
  });
  return {
    db,
    directory,
    view,
    close() {
      try {
        db.raw.close();
      } catch {
        /* Already closed by migration test. */
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("v3 migration adds bounded UI tables while preserving existing credentials and history", () => {
  const c = setup();
  try {
    c.db.raw.exec(
      "DROP TABLE a2ui_receipts; DROP TABLE a2ui_drafts; DROP TABLE a2ui_calls; DROP TABLE a2ui_views; PRAGMA user_version=3",
    );
    c.db.set("password", "keep-hash");
    const directory = c.directory;
    c.db.raw.close();
    const next = database(directory);
    assert.equal(
      (next.raw.prepare("PRAGMA user_version").get() as any).user_version,
      7,
    );
    assert.equal(next.get("password"), "keep-hash");
    assert.ok(next.owns("t"));
    assert.equal(
      (next.raw.prepare("PRAGMA integrity_check").get() as any).integrity_check,
      "ok",
    );
    next.raw.close();
  } finally {
    try {
      c.close();
    } catch {
      /* DB already closed; remove test files below. */
    }
  }
});
test("snapshot quota failure is atomic and preserves the last saved form", () => {
  const c = setup();
  try {
    const store = a2uiStore(c.db, { views: 1, bytes: 65536 });
    const view = c.view();
    store.save(view, new Set([view.itemId]));
    assert.throws(() => store.save(c.view(), new Set(["another"])), /未能保存/);
    assert.equal(store.load(view.id)?.view.revision, 1);
    const full = a2uiStore(c.db, { views: 1, bytes: 1 });
    assert.throws(
      () => full.save({ ...view, revision: 2 }, new Set([view.itemId])),
      /未能保存/,
    );
    assert.equal(full.load(view.id)?.view.revision, 1);
    assert.equal(
      (c.db.raw.prepare("SELECT COUNT(*) n FROM a2ui_views").get() as any).n,
      1,
    );
  } finally {
    c.close();
  }
});
test("corrupt or unsupported saved descriptions degrade to fixed unavailable state", () => {
  for (const snapshot of [
    "{broken",
    JSON.stringify([
      {
        version: "v0.9",
        createSurface: { surfaceId: "monitor-demo", catalogId: "untrusted" },
      },
    ]),
  ]) {
    const c = setup();
    try {
      const store = a2uiStore(c.db),
        view = c.view();
      store.save(view, new Set([view.itemId]));
      c.db.raw
        .prepare("UPDATE a2ui_views SET snapshot=? WHERE id=?")
        .run(snapshot, view.id);
      const ui = a2uiManager(
        new A2uiFixtureCodex(),
        c.db,
        () => {},
        () => false,
      );
      const restored = ui.read(view.id);
      assert.equal(restored.state, "unavailable");
      assert.equal(restored.reason, "invalid");
      assert.deepEqual(restored.messages, []);
      assert.equal(restored.token, undefined);
      ui.close();
    } finally {
      c.close();
    }
  }
});
test("incomplete historical surface is displayed as unavailable without an active action", () => {
  const c = setup();
  try {
    const store = a2uiStore(c.db),
      view = c.view();
    view.messages = [view.messages[0]];
    store.save(view, new Set([view.itemId]));
    const ui = a2uiManager(
      new A2uiFixtureCodex(),
      c.db,
      () => {},
      () => false,
    );
    assert.equal(ui.read(view.id).reason, "incomplete");
    assert.equal(ui.read(view.id).token, undefined);
    ui.close();
  } finally {
    c.close();
  }
});
test("evicted SDK instances restore historical forms from bounded durable snapshots", () => {
  const c = setup();
  try {
    const store = a2uiStore(c.db),
      views: A2uiView[] = [];
    for (let i = 0; i < 40; i++) {
      const view = c.view();
      view.turnId = `turn-${i}`;
      store.save(view, new Set([view.itemId]));
      views.push(view);
    }
    const ui = a2uiManager(
      new A2uiFixtureCodex(),
      c.db,
      () => {},
      () => false,
    );
    for (const view of views) assert.equal(ui.read(view.id).state, "display");
    assert.equal(ui.read(views[0].id).state, "display");
    assert.equal(ui.pending, 0);
    ui.close();
  } finally {
    c.close();
  }
});
test("drafts expire after their retention window and corrupt field types never escape storage", () => {
  const c = setup();
  try {
    const store = a2uiStore(c.db),
      view = c.view();
    view.state = "waiting";
    store.save(view, new Set([view.itemId]));
    store.saveDraft(view.id, 1, 0, { name: "ordinary" });
    c.db.raw
      .prepare("UPDATE a2ui_drafts SET content=? WHERE view_id=?")
      .run('{"name":{"object":"invalid"}}', view.id);
    assert.equal(store.draft(view.id, 1).values, undefined);
    c.db.raw
      .prepare("UPDATE a2ui_drafts SET expires=0 WHERE view_id=?")
      .run(view.id);
    assert.deepEqual(store.draft(view.id, 1), { version: 0 });
  } finally {
    c.close();
  }
});
