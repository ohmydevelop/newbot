import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { SubscriptionEngine } from "../server/event-subscriptions/engine.js";
import {
  ProviderRegistry,
  SourceFailure,
  type PullAdapter,
  type SourceEvent,
  type Target,
} from "../server/event-subscriptions/contracts.js";
import manifest from "../examples/event-subscriptions/plugin.json";

const target = (): Target => ({
  taskId: randomUUID(),
  triggerId: randomUUID(),
  revision: 1,
  events: [],
});
const event = (id: string): SourceEvent => ({
  id,
  type: "message.received",
  payload: { text: id },
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function fixture(
  fn: (f: {
    registry: ProviderRegistry;
    providerId: string;
    config: {
      providerId: string;
      connectionId: string;
      resource: string;
      targets: Target[];
    };
    source: PullAdapter;
    events: SourceEvent[];
    accepted: Map<string, string[]>;
    counts: { pull: number; ack: number };
    now: () => number;
    advance: (ms?: number) => void;
    make: (
      overrides?: Partial<ConstructorParameters<typeof SubscriptionEngine>[0]>,
    ) => SubscriptionEngine;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "subscription-unit-"));
  const engines = new Set<SubscriptionEngine>();
  const events: SourceEvent[] = [];
  let now = 10000;
  const counts = { pull: 0, ack: 0 };
  const source: PullAdapter = {
    async pull({ cursor }) {
      counts.pull++;
      return {
        cursor: String(events.length),
        receipt: String(events.length),
        events: cursor === null ? [] : events.slice(Number(cursor)),
      };
    },
    async acknowledge() {
      counts.ack++;
    },
  };
  const registry = new ProviderRegistry(
    new Map([["loopback-pull-v1", source]]),
  );
  const providerId = registry.install(manifest);
  const accepted = new Map<string, string[]>();
  const config = {
    providerId,
    connectionId: "account-a",
    resource: "inbox",
    targets: [target(), target()],
  };
  const make = (
    overrides: Partial<
      ConstructorParameters<typeof SubscriptionEngine>[0]
    > = {},
  ) => {
    const engine = new SubscriptionEngine({
      directory,
      registry,
      now: () => now,
      pollMs: 1000,
      deliver: async (t, e, id) => {
        const key = t.taskId + ":" + id;
        if (!accepted.has(key)) accepted.set(key, [e.id]);
        return "accepted";
      },
      ...overrides,
    });
    engines.add(engine);
    const close = engine.close.bind(engine);
    engine.close = async () => {
      if (engines.delete(engine)) await close();
    };
    return engine;
  };
  try {
    await fn({
      registry,
      providerId,
      config,
      source,
      events,
      accepted,
      counts,
      now: () => now,
      advance: (ms = 2000) => {
        now += ms;
      },
      make,
    });
  } finally {
    for (const engine of engines) await engine.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

test("E1/E5: declarative installation permits only host adapters; shared subscription and baseline skip historical events", () =>
  fixture(async (f) => {
    assert.throws(() =>
      f.registry.install({ ...manifest, execute: "arbitrary.js" }),
    );
    assert.throws(() =>
      f.registry.install({
        ...manifest,
        source: { ...manifest.source, adapter: "unknown" },
      }),
    );
    const a = f.make();
    const id = a.subscribe(f.config);
    assert.equal(
      a.subscribe({ ...f.config, targets: [...f.config.targets].reverse() }),
      id,
    );
    f.events.push(event("historical"));
    await Promise.all([a.tick(), a.tick(), a.tick()]);
    assert.equal(f.counts.pull, 1);
    assert.equal(f.accepted.size, 0);
    f.events.push(event("fresh"));
    f.advance();
    await a.tick();
    assert.equal(f.counts.pull, 2);
    assert.equal(f.accepted.size, 2);
    assert.deepEqual(a.inspect(id).deliveries, { accepted: 2 });
  }));

test("E2/E4: saved cursor survives ack failure and database reopen; successful target survives lost receipt and failed peer", () =>
  fixture(async (f) => {
    let a = f.make();
    const id = a.subscribe(f.config);
    await a.tick();
    f.source.acknowledge = async () => {
      throw new Error("secret-upstream-detail");
    };
    await a.close();
    let fail = true;
    const handled = new Set<string>();
    a = f.make({
      deliver: async (t, e, key) => {
        if (t.taskId === f.config.targets[1].taskId && fail)
          throw new Error("target offline");
        handled.add(t.taskId + ":" + key);
        if (fail) throw new Error("receipt lost after acceptance");
        return "accepted";
      },
    });
    f.events.push(event("a"));
    f.advance();
    await a.tick();
    assert.equal(a.inspect(id).cursor, "1");
    assert.equal(a.inspect(id).awaitingAck, true);
    assert.equal(a.inspect(id).state, "retry");
    assert.equal(handled.size, 1);
    await a.close();
    fail = false;
    let ack = "";
    f.source.acknowledge = async (_, r) => {
      ack = r;
    };
    a = f.make({
      deliver: async (t, e, key) => {
        handled.add(t.taskId + ":" + key);
        return "accepted";
      },
    });
    f.advance();
    await a.tick();
    assert.equal(ack, "1");
    assert.equal(handled.size, 2);
    assert.deepEqual(a.inspect(id).deliveries, { accepted: 2 });
    assert.equal(a.inspect(id).awaitingAck, false);
  }));

test("E3: leases prevent concurrent polling; expired worker response is fenced after takeover", () =>
  fixture(async (f) => {
    const wait = deferred<Awaited<ReturnType<PullAdapter["pull"]>>>();
    let calls = 0;
    f.source.pull = async () =>
      ++calls === 1 ? wait.promise : { cursor: "new", events: [] };
    const a = f.make({ leaseMs: 100 });
    const b = f.make({ leaseMs: 100 });
    const id = a.subscribe(f.config);
    const work = a.tick();
    await new Promise((r) => setImmediate(r));
    await b.tick();
    assert.equal(calls, 1);
    f.advance(101);
    await b.tick();
    assert.equal(calls, 2);
    wait.resolve({ cursor: "obsolete", events: [] });
    await work;
    assert.equal(a.inspect(id).cursor, "new");
  }));

test("E3/E5: disabling and uninstall fence in-flight responses; reinstall does not silently resume", () =>
  fixture(async (f) => {
    const a = f.make();
    const id = a.subscribe(f.config);
    await a.tick();
    const wait = deferred<Awaited<ReturnType<PullAdapter["pull"]>>>();
    f.source.pull = async () => wait.promise;
    f.advance();
    const work = a.tick();
    await new Promise((r) => setImmediate(r));
    a.uninstall(f.providerId);
    wait.resolve({ cursor: "1", events: [event("late")] });
    await work;
    assert.equal(a.inspect(id).cursor, "0");
    assert.equal(a.inspect(id).state, "disabled");
    f.registry.install(manifest);
    await a.tick();
    assert.equal(a.inspect(id).state, "disabled");
    assert.equal(f.accepted.size, 0);
  }));

test("E4: failed target preserves FIFO while its peer progresses, target removal cancels backlog", () =>
  fixture(async (f) => {
    let broken = true;
    const calls: string[] = [];
    const a = f.make({
      deliver: async (t, e) => {
        if (t.taskId === f.config.targets[0].taskId && broken)
          throw new Error("offline");
        calls.push(t.taskId + ":" + e.id);
        return "accepted";
      },
    });
    const id = a.subscribe(f.config);
    await a.tick();
    f.events.push(event("a"), event("b"));
    f.advance();
    await a.tick();
    f.advance();
    await a.tick();
    assert.deepEqual(calls, [
      f.config.targets[1].taskId + ":a",
      f.config.targets[1].taskId + ":b",
    ]);
    broken = false;
    f.advance();
    await a.tick();
    f.advance();
    await a.tick();
    assert.deepEqual(calls.slice(2), [
      f.config.targets[0].taskId + ":a",
      f.config.targets[0].taskId + ":b",
    ]);
    broken = true;
    f.events.push(event("c"));
    f.advance();
    await a.tick();
    a.subscribe({ ...f.config, targets: [f.config.targets[1]] });
    f.advance();
    await a.tick();
    assert.equal(a.inspect(id).deliveries.discarded, 1);
  }));

test("E6: typed auth/gap errors stop polling until explicit retry; transient failures obey delay", () =>
  fixture(async (f) => {
    const a = f.make();
    const id = a.subscribe(f.config);
    let calls = 0;
    f.source.pull = async () => {
      calls++;
      throw new SourceFailure("auth_required");
    };
    await a.tick();
    f.advance(60000);
    await a.tick();
    assert.equal(calls, 1);
    assert.equal(a.inspect(id).state, "auth_required");
    a.setEnabled(id, true);
    f.source.pull = async () => {
      calls++;
      throw new SourceFailure("gap");
    };
    await a.tick();
    f.advance(60000);
    await a.tick();
    assert.equal(calls, 2);
    assert.equal(a.inspect(id).state, "gap");
    a.setEnabled(id, true);
    f.source.pull = async () => {
      calls++;
      throw new SourceFailure("retry", 10000);
    };
    await a.tick();
    f.advance(9999);
    await a.tick();
    assert.equal(calls, 3);
    f.advance(1);
    await a.tick();
    assert.equal(calls, 4);
  }));

test("E2/E6/E7: capacity and conflicting IDs roll back entire page and cursor; canonical key order deduplicates", () =>
  fixture(async (f) => {
    const a = f.make({ maxEvents: 2 });
    const id = a.subscribe(f.config);
    await a.tick();
    f.events.push({ ...event("a"), payload: { a: 1, b: 2 } });
    f.advance();
    await a.tick();
    f.source.pull = async () => ({
      cursor: "dup",
      events: [{ ...event("a"), payload: { b: 2, a: 1 } }],
    });
    f.advance();
    await a.tick();
    assert.equal(f.accepted.size, 2);
    f.source.pull = async () => ({
      cursor: "bad",
      events: [event("b"), { ...event("a"), payload: { changed: true } }],
    });
    f.advance();
    await a.tick();
    assert.equal(a.inspect(id).state, "conflict");
    assert.equal(a.inspect(id).cursor, "dup");
    a.setEnabled(id, true);
    f.source.pull = async () => ({
      cursor: "too-many",
      events: [event("b"), event("c")],
    });
    await a.tick();
    assert.equal(a.inspect(id).state, "capacity");
    assert.equal(a.inspect(id).cursor, "dup");
    assert.equal(f.accepted.size, 2);
  }));

test("E7: identical event IDs in different connections remain distinct", () =>
  fixture(async (f) => {
    const a = f.make();
    a.subscribe(f.config);
    a.subscribe({ ...f.config, connectionId: "account-b" });
    await a.tick();
    f.events.push(event("same"));
    f.advance();
    await a.tick();
    assert.equal(f.accepted.size, 4);
  }));

test("E5/E6: unknown event type and nonempty baseline cannot advance checkpoint or acknowledge", () =>
  fixture(async (f) => {
    const a = f.make();
    const id = a.subscribe(f.config);
    f.source.pull = async () => ({
      cursor: "history",
      receipt: "history",
      events: [event("old")],
    });
    await a.tick();
    assert.equal(a.inspect(id).state, "conflict");
    assert.equal(a.inspect(id).cursor, null);
    assert.equal(f.counts.ack, 0);
    a.setEnabled(id, true);
    f.source.pull = async () => ({ cursor: "baseline", events: [] });
    await a.tick();
    f.source.pull = async () => ({
      cursor: "bad",
      receipt: "bad",
      events: [{ ...event("unknown"), type: "unregistered.event" }],
    });
    f.advance();
    await a.tick();
    assert.equal(a.inspect(id).cursor, "baseline");
    assert.equal(a.inspect(id).state, "conflict");
    assert.equal(f.counts.ack, 0);
    assert.equal(f.accepted.size, 0);
  }));

test("E3: replacing an installed provider fences its previous in-flight adapter generation", () =>
  fixture(async (f) => {
    const a = f.make();
    const id = a.subscribe(f.config);
    await a.tick();
    const wait = deferred<Awaited<ReturnType<PullAdapter["pull"]>>>();
    f.source.pull = async () => wait.promise;
    f.advance();
    const work = a.tick();
    await new Promise((r) => setImmediate(r));
    f.registry.install(manifest);
    wait.resolve({
      cursor: "late",
      receipt: "late",
      events: [event("old-generation")],
    });
    await work;
    assert.equal(a.inspect(id).cursor, "0");
    assert.equal(f.accepted.size, 0);
    assert.equal(f.counts.ack, 1);
  }));
