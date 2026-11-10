// Read migrated native history only. Never starts a model Turn.
import assert from "node:assert/strict";
import { Codex } from "../server/codex.ts";
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
const home = resolve(process.env.NEWBOT_CODEX_HOME || ".data/codex");
const manifest = JSON.parse(
  await readFile(home + "/newbot-migration.json", "utf8"),
);
const c = new Codex(
  resolve(process.env.AGENT_WORKSPACE || ".data/workspace"),
  () => ({ CODEX_HOME: home }),
);
const db = new DatabaseSync(home + "/thread_history_1.sqlite", {
  readOnly: true,
});
const result = {
  threads: 0,
  turns: 0,
  items: 0,
  allOriginalIds: true,
  allTurnCountsMatch: true,
  allItemCountsMatch: true,
  personalAuthCopied: existsSync(home + "/auth.json"),
  personalPluginsCopied: existsSync(home + "/plugins"),
  modelTurns: 0,
};
try {
  await c.start();
  assert.equal(c.state, "ready", c.reason);
  for (const id of manifest.threadIds) {
    let cursor,
      turns = 0,
      items = 0;
    do {
      const page = await c.call("thread/turns/list", {
        threadId: id,
        limit: 100,
        cursor,
        itemsView: "full",
      });
      turns += page.data.length;
      items += page.data.reduce((n, t) => n + t.items.length, 0);
      cursor = page.nextCursor || undefined;
    } while (cursor);
    assert.equal(
      turns,
      db
        .prepare("select count(*) as n from thread_turns where thread_id=?")
        .get(id).n,
      "Native turn count must match",
    );
    assert.equal(
      items,
      db
        .prepare("select count(*) as n from thread_items where thread_id=?")
        .get(id).n,
      "Native item count must match",
    );
    const thread = await c.call("thread/read", {
      threadId: id,
      includeTurns: false,
    });
    assert.equal(thread.thread.id, id);
    result.threads++;
    result.turns += turns;
    result.items += items;
  }
  await writeFile(
    ".issue/2026-11-09/evidence-04/runtime-migration-verified.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} finally {
  db.close();
  await c.stopAndWait();
}
