import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { database, DATABASE_VERSION } from "../server/db.js";
import { RunnerControl } from "../server/runner/control.js";
import { RunnerLedger } from "../server/runner/ledger.js";
const fingerprint = "a".repeat(64);
async function fixture(run: (x: any) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), "runner-control-")),
    db = database(join(dir, "server"));
  let now = 1000;
  const control = new RunnerControl(db, () => now),
    node = control.enroll("test", fingerprint),
    scope = randomUUID(),
    bootId = randomUUID();
  control.grant(node.id, scope, 1);
  const hello = control.connect(node.id, node.token, {
    protocol: 1,
    bootId,
    fingerprint,
  });
  const ledger = new RunnerLedger(join(dir, "runner"), node.id);
  ledger.activate(hello.epoch, hello.grants);
  const command = (more = {}) => ({
    id: randomUUID(),
    nodeId: node.id,
    scope,
    revision: 1,
    method: "turn/start",
    params: { threadId: randomUUID() },
    ...more,
  });
  const exchange = (events = ledger.events(), more = {}) =>
    control.exchange(node.id, node.token, {
      bootId,
      epoch: hello.epoch,
      events,
      ...more,
    });
  try {
    await run({
      dir,
      db,
      control,
      node,
      scope,
      bootId,
      hello,
      ledger,
      command,
      exchange,
      advance: (ms: number) => (now += ms),
    });
  } finally {
    ledger.close();
    control.close();
    db.raw.close();
    await rm(dir, { recursive: true, force: true });
  }
}
test("lost command response and lost event ack do not repeat execution; terminal result cannot be overwritten", () =>
  fixture(async (x) => {
    const { control, command, exchange, ledger, node, db } = x;
    const c = command();
    control.queue(c);
    const lost = exchange();
    const repeated = exchange();
    assert.deepEqual(lost.commands, repeated.commands);
    let executions = 0;
    await ledger.execute(repeated.commands[0], async () => {
      executions++;
      return { turn: { id: "one" } };
    });
    await ledger.execute(lost.commands[0], async () => {
      executions++;
      return null;
    });
    const events = ledger.events();
    const a = exchange(events),
      b = exchange(events);
    assert.equal(a.ack, b.ack);
    assert.equal(executions, 1);
    assert.equal(control.receipt(c.id).state, "completed");
    const altered = {
      ...events[0],
      seq: events[0].seq + 1,
      body: { id: c.id, state: "unknown" },
    };
    assert.throws(() => exchange([altered]), /终态/);
    assert.equal(
      (
        db.raw
          .prepare("SELECT ack FROM runner_nodes WHERE id=?")
          .get(node.id) as any
      ).ack,
      a.ack,
    );
    ledger.acknowledge(b.ack);
    assert.equal(ledger.events().length, 0);
    assert.throws(
      () => control.queue({ ...c, params: { changed: true } }),
      /不同内容/,
    );
  }));
test("event gaps, conflicting duplicates and foreign scope cannot advance acknowledgements", () =>
  fixture(async ({ ledger, exchange, scope, db, node }: any) => {
    ledger.event("notification", scope, { message: "one" });
    const e = ledger.events()[0];
    assert.throws(() => exchange([{ ...e, seq: 2 }]), /不连续/);
    assert.throws(() => exchange([{ ...e, scope: randomUUID() }]), /不属于/);
    exchange([e]);
    assert.throws(
      () => exchange([{ ...e, body: { different: true } }]),
      /不一致/,
    );
    assert.equal(
      (
        db.raw
          .prepare("SELECT ack FROM runner_nodes WHERE id=?")
          .get(node.id) as any
      ).ack,
      1,
    );
  }));
test("revocation and lease expiry require stopped confirmation before another node can own a workspace", () =>
  fixture(async ({ control, node, scope, bootId, hello, advance }: any) => {
    const other = control.enroll("second", fingerprint);
    assert.throws(() => control.grant(other.id, scope, 2), /并行接管/);
    assert.throws(
      () =>
        control.connect(node.id, node.token, {
          protocol: 1,
          bootId: randomUUID(),
          fingerprint,
        }),
      /有效租约/,
    );
    advance(31000);
    assert.throws(
      () =>
        control.connect(node.id, node.token, {
          protocol: 1,
          bootId: randomUUID(),
          fingerprint,
        }),
      /尚未确认停止/,
    );
    assert.throws(() => control.grant(other.id, scope, 2), /并行接管/);
    control.revoke(node.id);
    assert.throws(() => control.grant(other.id, scope, 2), /并行接管/);
    assert.throws(() => control.authenticate(node.id, node.token), /失效/);
    control.release(node.id, node.token, bootId, hello.epoch);
    control.grant(other.id, scope, 2);
    assert.throws(
      () =>
        control.queue({
          id: randomUUID(),
          nodeId: node.id,
          scope,
          revision: 1,
          method: "turn/start",
          params: {},
        }),
      /失效/,
    );
  }));
test("restart preserves encrypted ordinary commands but expires undelivered private bodies and never replays sent uncertainty", () =>
  fixture(async ({ control, node, db, command, exchange, dir }: any) => {
    const secret = "SYNTHETIC_CONTROL_SECRET";
    const ordinary = command({ params: { text: secret } }),
      privateQueued = command({
        method: "thread/start",
        params: { apiKey: secret },
      });
    control.queue(ordinary);
    control.queue(privateQueued);
    exchange();
    const unsent = command({
        method: "thread/start",
        params: { apiKey: secret },
      }),
      ordinaryUnsent = command({ params: { text: secret } });
    control.queue(unsent);
    control.queue(ordinaryUnsent);
    control.close();
    const restarted = new RunnerControl(db, () => 2000);
    try {
      assert.equal(restarted.receipt(privateQueued.id).state, "unknown");
      assert.equal(restarted.receipt(unsent.id).state, "expired");
      assert.equal(restarted.receipt(ordinary.id).state, "sent");
      assert.equal(restarted.receipt(ordinaryUnsent.id).state, "queued");
      for (const name of await readdir(join(dir, "server"))) {
        if (!name.startsWith("newbot.sqlite")) continue;
        assert.ok(
          !(await readFile(join(dir, "server", name))).includes(
            Buffer.from(secret),
          ),
        );
      }
      assert.ok(!JSON.stringify(restarted.nodes()).includes(node.token));
      assert.throws(() => restarted.authenticate(node.id, "wrong"), /验证/);
    } finally {
      restarted.close();
    }
  }));
test("native fingerprint and grant revision checks reject incompatible or stale work", () =>
  fixture(
    async ({
      control,
      node,
      bootId,
      scope,
      command,
      exchange,
      ledger,
    }: any) => {
      assert.throws(
        () =>
          control.connect(node.id, node.token, {
            protocol: 1,
            bootId,
            fingerprint: "b".repeat(64),
          }),
        /不匹配/,
      );
      const c = command();
      control.queue(c);
      const sent = exchange().commands[0];
      control.grant(node.id, scope, 2);
      ledger.activate(1, [{ scope, revision: 2 }]);
      assert.throws(() => ledger.execute(sent, async () => null), /修订/);
      ledger.reject(sent);
      exchange();
      assert.equal(control.receipt(c.id).state, "rejected");
      assert.throws(
        () => ledger.reject({ ...sent, params: { changed: true } }),
        /不同内容/,
      );
      assert.throws(() => control.grant(node.id, scope, 1), /回退/);
    },
  ));
test("v16 metadata survives additive control-plane migration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runner-schema-"));
  let db = database(dir);
  try {
    db.raw
      .prepare("INSERT INTO metadata VALUES(?,?)")
      .run("migration-proof", "keep");
    db.raw.exec(
      "DROP TABLE runner_inbox; DROP TABLE runner_commands; DROP TABLE runner_grants; DROP TABLE runner_nodes; PRAGMA user_version=16",
    );
    db.raw.close();
    db = database(dir);
    assert.equal(
      (db.raw.prepare("PRAGMA user_version").get() as any).user_version,
      DATABASE_VERSION,
    );
    assert.equal(
      (
        db.raw
          .prepare("SELECT value FROM metadata WHERE key=?")
          .get("migration-proof") as any
      ).value,
      "keep",
    );
  } finally {
    db.raw.close();
    await rm(dir, { recursive: true, force: true });
  }
});
