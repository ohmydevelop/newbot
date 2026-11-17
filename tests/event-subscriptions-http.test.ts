import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { loopbackPullAdapter } from "../examples/event-subscriptions/loopback-pull.js";
import { upstreamFixture } from "../examples/event-subscriptions/upstream-fixture.js";
import {
  ProviderRegistry,
  SourceFailure,
} from "../server/event-subscriptions/contracts.js";
import { SubscriptionEngine } from "../server/event-subscriptions/engine.js";
import manifest from "../examples/event-subscriptions/plugin.json";

test("E1/E6: HTTP adapter restricts origin, blocks redirects, bounds payload and maps auth/rate/gap failures", async () => {
  for (const address of [
    "https://example.com/",
    "http://localhost/",
    "http://127.0.0.1/path",
    "http://name:pass@127.0.0.1/",
  ])
    assert.throws(() => loopbackPullAdapter(address, () => ""));
  const u = await upstreamFixture();
  const adapter = loopbackPullAdapter(u.endpoint, () => u.token);
  const context = () => ({
    connectionId: "account",
    resource: "inbox",
    cursor: null,
    signal: AbortSignal.timeout(1000),
  });
  try {
    for (const [status, code] of [
      [401, "auth_required"],
      [403, "auth_required"],
      [410, "gap"],
      [429, "retry"],
      [503, "retry"],
    ] as const) {
      u.controls.status = status;
      await assert.rejects(
        adapter.pull(context()),
        (e) =>
          e instanceof SourceFailure &&
          e.code === code &&
          e.retryAfterMs === 2000,
      );
    }
    u.controls.status = 200;
    u.controls.redirect = true;
    await assert.rejects(adapter.pull(context()));
    assert.equal(
      u.requests.some((r) => r.path === "/redirect-target"),
      false,
    );
    u.controls.redirect = false;
    u.controls.oversized = true;
    await assert.rejects(
      adapter.pull(context()),
      (e) => e instanceof SourceFailure && e.code === "capacity",
    );
    u.controls.oversized = false;
    assert.deepEqual(await adapter.pull(context()), {
      cursor: "0",
      receipt: "0",
      events: [],
    });
    await adapter.acknowledge(context(), "0");
    assert.deepEqual(u.acknowledgments, ["0"]);
    u.controls.hang = true;
    await assert.rejects(
      adapter.pull({ ...context(), signal: AbortSignal.timeout(20) }),
    );
  } finally {
    await u.close();
  }
});

test("E1/E3: background worker runs without a browser and close aborts an in-flight request without advancing cursor", async () => {
  const u = await upstreamFixture();
  const directory = mkdtempSync(join(tmpdir(), "subscription-http-"));
  const adapter = loopbackPullAdapter(u.endpoint, () => u.token);
  const registry = new ProviderRegistry(
    new Map([["loopback-pull-v1", adapter]]),
  );
  const providerId = registry.install(manifest);
  let delivered = 0;
  const options = {
    directory,
    registry,
    pollMs: 10,
    timeoutMs: 1000,
    deliver: async () => {
      delivered++;
      return "accepted" as const;
    },
  };
  let engine = new SubscriptionEngine(options);
  const stop = new AbortController();
  let work: Promise<void> | undefined;
  try {
    const id = engine.subscribe({
      providerId,
      connectionId: "account",
      resource: "inbox",
      targets: [
        {
          taskId: randomUUID(),
          triggerId: randomUUID(),
          revision: 1,
          events: [],
        },
      ],
    });
    await engine.tick();
    u.events.push({
      id: "new",
      type: "message.received",
      payload: { text: "local" },
    });
    work = engine.run(stop.signal);
    for (let n = 0; n < 100 && delivered === 0; n++) await sleep(10);
    assert.equal(delivered, 1);
    u.controls.hang = true;
    const count = u.requests.length;
    for (let n = 0; n < 100 && u.requests.length === count; n++)
      await sleep(10);
    assert(u.requests.length > count);
    await engine.close();
    await work;
    engine = new SubscriptionEngine(options);
    assert.equal(engine.inspect(id).cursor, "1");
    assert.deepEqual(engine.inspect(id).deliveries, { accepted: 1 });
  } finally {
    stop.abort();
    await engine.close();
    await work;
    await u.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
