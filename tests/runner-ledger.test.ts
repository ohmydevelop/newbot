import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { RunnerLedger } from "../server/runner/ledger.js";
import type { RunnerCommand } from "../shared/runner-control.js";
async function fixture(
  run: (x: {
    dir: string;
    nodeId: string;
    scope: string;
    ledger: RunnerLedger;
    command: RunnerCommand;
  }) => Promise<void>,
) {
  const dir = await mkdtemp(join(tmpdir(), "runner-ledger-")),
    nodeId = randomUUID(),
    scope = randomUUID(),
    ledger = new RunnerLedger(dir, nodeId);
  ledger.activate(1, [{ scope, revision: 1 }]);
  const command: RunnerCommand = {
    id: randomUUID(),
    nodeId,
    scope,
    revision: 1,
    epoch: 1,
    method: "turn/start",
    params: {
      threadId: randomUUID(),
      input: [{ text: "synthetic ordinary prompt" }],
    },
    ephemeral: false,
  };
  try {
    await run({ dir, nodeId, scope, ledger, command });
  } finally {
    try {
      ledger.close();
    } catch {}
    await rm(dir, { recursive: true, force: true });
  }
}
test("concurrent duplicate commands and lost acknowledgements execute only once and retain identical receipts across restart", () =>
  fixture(async ({ dir, nodeId, scope, ledger, command }) => {
    let calls = 0,
      release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const perform = async () => {
      calls++;
      await gate;
      return { turn: { id: "original-turn" } };
    };
    const a = ledger.execute(command, perform),
      b = ledger.execute(command, perform);
    release();
    assert.deepEqual(await a, await b);
    assert.equal(calls, 1);
    const events = ledger.events();
    assert.equal(events.length, 1);
    ledger.acknowledge(events[0].seq);
    ledger.close();
    const reopened = new RunnerLedger(dir, nodeId);
    try {
      reopened.activate(2, [{ scope, revision: 2 }]);
      const receipt = await reopened.execute(
        { ...command, epoch: 2 },
        async () => {
          calls++;
          return null;
        },
      );
      assert.equal(receipt.state, "completed");
      assert.deepEqual(receipt.result, { turn: { id: "original-turn" } });
      assert.equal(calls, 1);
      assert.equal(reopened.events().length, 1);
    } finally {
      reopened.close();
    }
  }));
test("conflicting IDs, old epochs, unrelated owners, disabled scopes and stale revisions cannot issue new work", () =>
  fixture(async ({ scope, ledger, command }) => {
    await ledger.execute(command, async () => ({ ok: true }));
    assert.throws(
      () =>
        ledger.execute(
          { ...command, params: { different: true } },
          async () => null,
        ),
      /不同内容/,
    );
    for (const c of [
      { ...command, id: randomUUID(), nodeId: randomUUID() },
      { ...command, id: randomUUID(), epoch: 2 },
      { ...command, id: randomUUID(), revision: 0 },
      { ...command, id: randomUUID(), scope: randomUUID() },
    ])
      assert.throws(() => ledger.execute(c, async () => null), /过期/);
    ledger.activate(2, []);
    assert.throws(
      () => ledger.execute({ ...command, epoch: 2 }, async () => null),
      /过期/,
    );
    assert.throws(() => ledger.activate(1, [{ scope, revision: 1 }]), /代次/);
  }));
test("crash in dispatch window stays unknown after reopen; accepted-only commands remain distinguishable", () =>
  fixture(async ({ dir, nodeId, scope, ledger, command }) => {
    // Persist the exact state reached immediately before native IO, then model a process crash.
    const { epoch: _, ...identity } = command;
    ledger.sql
      .prepare("INSERT INTO receipts VALUES(?,?,?,?,?,'dispatching',NULL)")
      .run(command.id, ledger.cipher.fingerprint(identity), 1, scope, 1);
    ledger.close();
    const restarted = new RunnerLedger(dir, nodeId);
    try {
      restarted.activate(2, [{ scope, revision: 1 }]);
      let calls = 0;
      assert.equal(
        (
          await restarted.execute({ ...command, epoch: 2 }, async () => {
            calls++;
            return null;
          })
        ).state,
        "unknown",
      );
      assert.equal(calls, 0);
      assert.equal(restarted.events()[0].kind, "receipt");
    } finally {
      restarted.close();
    }
  }));
test("uncertain failures are not replayed, and private parameters/results are not plaintext in node state", () =>
  fixture(async ({ dir, ledger, command }) => {
    const secret = "SYNTHETIC_PRIVATE_NODE_MARKER";
    let calls = 0;
    command.params = { secret };
    command.ephemeral = true;
    const result = await ledger.execute(command, async () => {
      calls++;
      throw Error(secret);
    });
    assert.equal(result.state, "unknown");
    await ledger.execute(command, async () => {
      calls++;
      return secret;
    });
    assert.equal(calls, 1);
    const other = { ...command, id: randomUUID() };
    await ledger.execute(other, async () => ({ value: secret }));
    for (const name of await readdir(dir)) {
      if (name === "transport.key") continue;
      const bytes = await readFile(join(dir, name));
      assert.ok(!bytes.includes(Buffer.from(secret)), name);
    }
    assert.throws(() => ledger.acknowledge(500), /范围/);
    const events = ledger.events();
    ledger.acknowledge(events.at(-1)!.seq);
    assert.equal(ledger.events().length, 0);
  }));
test("missing or tampered encryption material cannot turn a known command into fresh work", () =>
  fixture(async ({ dir, nodeId, ledger, command }) => {
    await ledger.execute(command, async () => ({ ok: true }));
    ledger.close();
    await rm(join(dir, "transport.key"));
    assert.throws(() => new RunnerLedger(dir, nodeId), /密钥缺失/);
  }));
