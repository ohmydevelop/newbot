import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pluginDescriptors } from "../server/plugin-descriptor.js";
import { importTree } from "../server/import-files.js";
import { openEventConnection } from "../server/event-subscriptions/connection.js";
import {
  discoverEvents,
  mcpEventAdapter,
} from "../server/event-subscriptions/mcp-adapter.js";
import { schemaValidator } from "../shared/event-schema.js";

test("Bridge: imported mailbox package discovers schema and polls over real SDK stdio without a provider registration", async () => {
  const dir = await mkdtemp(join(tmpdir(), "bridge-wire-"));
  const file = join(dir, "messages.json"),
    root = resolve(".data/event-plugins/mailbox-events");
  await writeFile(
    file,
    JSON.stringify([{ id: 1, mailbox: "inbox", subject: "old", unread: true }]),
  );
  const tree = await importTree(root);
  const [descriptor] = await pluginDescriptors(
    "mailbox-events@newbot-imports",
    root,
    tree.digest,
  );
  const peer = await openEventConnection({
    descriptor,
    values: { file },
    secrets: {},
  });
  try {
    const events = await discoverEvents(peer);
    assert.equal(events[0].name, "mail.received");
    assert.equal(events[0].inputSchema.properties?.mailbox.title, "信箱");
    const adapter = mcpEventAdapter(async () => peer);
    const context = {
      connectionId: "mailbox-account",
      resource: JSON.stringify({
        name: "mail.received",
        arguments: { mailbox: "inbox", unread: true },
      }),
      cursor: null as string | null,
      signal: AbortSignal.timeout(15000),
    };
    const baseline = await adapter.pull(context);
    assert.equal(baseline.events.length, 0);
    await writeFile(
      file,
      JSON.stringify([
        { id: 1, mailbox: "inbox", subject: "old", unread: true },
        { id: 2, mailbox: "inbox", subject: "new", unread: true },
      ]),
    );
    const next = await adapter.pull({ ...context, cursor: baseline.cursor });
    assert.equal(next.events[0].payload.subject, "new");
    assert.equal(next.events[0].envelope?.specversion, "1.0");
    if (next.receipt)
      await adapter.acknowledge(
        { ...context, cursor: next.cursor },
        next.receipt,
      );
    assert.equal(
      (await adapter.pull({ ...context, cursor: next.cursor })).events.length,
      0,
    );
  } finally {
    await peer.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("Bridge: schema refuses executable/reference and unknown data fields", () => {
  assert.throws(() =>
    schemaValidator({ type: "object", $ref: "https://untrusted/schema" }),
  );
  assert.throws(() =>
    schemaValidator(
      JSON.parse(
        '{"type":"object","properties":{"__proto__":{"type":"string"}}}',
      ),
    ),
  );
  const v = schemaValidator({
    type: "object",
    properties: { mailbox: { type: "string", minLength: 1 } },
    required: ["mailbox"],
  });
  assert.throws(() => v.parse({ mailbox: "", repository: "org/repo" }));
  assert.deepEqual(v.parse({ mailbox: "inbox" }), { mailbox: "inbox" });
});

test("Bridge: installed v2 plugin → encrypted account → actual subprocess events → task queue → same conversation", async () => {
  const { createServer } = await import("../server/index.js");
  const { FakeCodex } = await import("./fixture.js");
  const { automationSchema } = await import("../shared/automations.js");
  const { randomUUID } = await import("node:crypto");
  const dir = await mkdtemp(join(tmpdir(), "bridge-service-")),
    file = join(dir, "messages.json"),
    root = resolve(".data/event-plugins/mailbox-events");
  await writeFile(file, "[]");
  let clock = Date.now();
  const codex = new FakeCodex();
  const ctx = await createServer({
    directory: join(dir, "data"),
    cwd: join(dir, "work"),
    codex,
    providerRuntime: null,
    password: "bridge-test-password",
    automationTimer: false,
    automationClock: () => clock,
  });
  try {
    await ctx.service.settings();
    const tree = await importTree(root);
    ctx.db.raw
      .prepare("INSERT INTO extension_packages VALUES(?,?,?,?,?,?)")
      .run(
        "mailbox-package",
        "plugin",
        "mailbox-events",
        root,
        tree.digest,
        JSON.stringify({
          pluginId: "mailbox-events@newbot-imports",
          installed: true,
        }),
      );
    const provider = (await ctx.subscriptions.catalog()).providers[0];
    assert.equal(provider.events[0].id, "mail.received");
    const connectionId = randomUUID();
    await ctx.subscriptions.saveAccount({
      id: connectionId,
      revision: 0,
      providerId: provider.id,
      label: "Inbox",
      values: { file },
      secrets: {},
    });
    const task = await ctx.automations.save({
      id: randomUUID(),
      expectedRevision: 0,
      content: automationSchema.parse({
        name: "mailbox",
        prompt: "Read incoming event",
        triggers: [],
        eventTriggers: [
          {
            id: randomUUID(),
            source: "subscription",
            providerId: provider.id,
            connectionId,
            events: ["mail.received"],
            arguments: { mailbox: "inbox" },
          },
        ],
        notification: "none",
      }),
    });
    await ctx.subscriptions.tick();
    await writeFile(
      file,
      JSON.stringify([
        { id: 1, mailbox: "inbox", subject: "First", unread: true },
      ]),
    );
    clock += 65000;
    await ctx.subscriptions.tick();
    await ctx.automations.tick();
    const first = ctx.automations.read(task.id).runs[0];
    assert.equal(first.state, "running");
    codex.finish(first.threadId!);
    await ctx.automations.tick();
    await ctx.subscriptions.saveAccount({
      id: connectionId,
      revision: 1,
      providerId: provider.id,
      label: "Renamed",
    });
    await writeFile(
      file,
      JSON.stringify([
        { id: 1, mailbox: "inbox", subject: "First", unread: true },
        { id: 2, mailbox: "inbox", subject: "Second", unread: true },
      ]),
    );
    clock += 65000;
    await ctx.subscriptions.tick();
    await ctx.automations.tick();
    for (
      let retry = 0;
      retry < 20 && ctx.automations.read(task.id).runs.length < 2;
      retry++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      clock += 2000;
      await ctx.subscriptions.tick();
      await ctx.automations.tick();
    }
    const second = ctx.automations.read(task.id).runs[0];
    assert.equal(second.threadId, first.threadId);
    assert.notEqual(second.id, first.id);
    assert.equal(ctx.automations.read(task.id).runs.length, 2);
    ctx.subscriptions.removeAccount({ id: connectionId, revision: 2 });
    assert.equal(ctx.automations.read(task.id).task.enabled, false);
  } finally {
    await ctx.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bridge: real HTTP relay and MCP subprocess acknowledge only after durable host acceptance, two filtered subscriptions share no cursor", async () => {
  const { relayServer } = await import("../services/event-relay/server.js");
  const { SubscriptionEngine } = await import(
    "../server/event-subscriptions/engine.js"
  );
  const { ProviderRegistry } = await import(
    "../server/event-subscriptions/contracts.js"
  );
  const { randomUUID } = await import("node:crypto");
  const dir = await mkdtemp(join(tmpdir(), "bridge-relay-"));
  const { app, store } = relayServer({
    directory: join(dir, "relay"),
    adminToken: "a".repeat(40),
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const address = app.server.address() as { port: number };
  const route = store.createRoute();
  const root = resolve(".data/event-plugins/relay-events"),
    tree = await importTree(root),
    [descriptor] = await pluginDescriptors(
      "relay-events@newbot-imports",
      root,
      tree.digest,
    );
  const peer = await openEventConnection({
    descriptor,
    values: { url: `http://127.0.0.1:${address.port}`, route: route.id },
    secrets: { token: route.consumer },
  });
  let now = Date.now();
  const adapter = mcpEventAdapter(async () => peer),
    registry = new ProviderRegistry(new Map([["mcp", adapter]]));
  const id = registry.install({
      version: 1,
      pluginId: "relay",
      source: {
        id: "source",
        label: "Relay",
        adapter: "mcp",
        events: ["event.received"],
      },
    }),
    delivered: string[] = [];
  const engine = new SubscriptionEngine({
    directory: join(dir, "engine"),
    registry,
    now: () => now,
    deliver: async (target) => {
      delivered.push(target.taskId);
      return "accepted";
    },
  });
  try {
    const targets = [randomUUID(), randomUUID(), randomUUID()];
    for (const [i, taskId] of targets.entries())
      engine.subscribe({
        providerId: id,
        connectionId: i === 2 ? "second-account" : "relay",
        resource: JSON.stringify({
          name: "event.received",
          arguments: { types: i === 1 ? "message.received" : "" },
        }),
        targets: [{ taskId, triggerId: randomUUID(), revision: 1, events: [] }],
      });
    await engine.tick();
    store.publish(route.id, {
      specversion: "1.0",
      source: "test",
      id: "one",
      type: "message.received",
      time: new Date().toISOString(),
      data: { text: "hello" },
    });
    now += 65000;
    await engine.tick();
    assert.deepEqual(delivered.sort(), targets.sort());
    now += 65000;
    await engine.tick();
    assert.equal(delivered.length, 3);
  } finally {
    await engine.close();
    await peer.close();
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Bridge publisher: disk outbox survives failed delivery and process reopen; source hook excludes config and credentials", async () => {
  const { eventPublisher } = await import(
    "../packages/event-bridge/publisher.js"
  );
  const { normalizeOpenClaw } = await import(
    "../examples/openclaw-event-bridge/handler.js"
  );
  const dir = await mkdtemp(join(tmpdir(), "bridge-outbox-"));
  const bodies: string[] = [];
  let publisher = eventPublisher({
    directory: dir,
    url: "http://127.0.0.1:1/events",
    token: "token",
    source: "source",
    request: async () => {
      throw new Error("offline");
    },
  });
  try {
    const observation = normalizeOpenClaw({
      type: "message",
      action: "received",
      context: {
        content: "hello",
        cfg: { token: "secret" },
        messageId: "external",
      },
    })!;
    assert.deepEqual(observation.data, {
      messageId: "external",
      text: "hello",
    });
    publisher.enqueue(observation.type, observation.data, "fixed-id");
    await assert.rejects(publisher.flush());
    await publisher.close();
    publisher = eventPublisher({
      directory: dir,
      url: "http://127.0.0.1:1/events",
      token: "token",
      source: "source",
      request: async (_url, init) => {
        bodies.push(String(init?.body));
        return Response.json({ accepted: true });
      },
    });
    await publisher.flush();
    await publisher.flush();
    assert.equal(bodies.length, 1);
    assert.equal(JSON.parse(bodies[0]).id, "fixed-id");
    assert(!bodies[0].includes("secret"));
  } finally {
    await publisher.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("event failure contract: transport loss retries, authorization and incompatible definitions stop, backoff survives RPC",async()=>{
 const {eventFailure}=await import("../packages/event-bridge/core.js");
 assert.equal(eventFailure(new Error("offline")).code,"retry");
 assert.equal(eventFailure({code:-32024}).code,"auth_required");
 assert.equal(eventFailure({code:-32601}).code,"conflict");
 const error=eventFailure({code:-32000,data:{"io.newbot/failure":"retry",retryAfterMs:60000}});assert.equal(error.retryAfterMs,60000);
});
