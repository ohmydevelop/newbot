import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { database } from "../server/db.js";
import { credentialVault } from "../server/credential-vault.js";
import { webhookDelivery } from "../server/event-subscriptions/webhook.js";
import { mcpEventAdapter } from "../server/event-subscriptions/mcp-adapter.js";
import type { EventPeer } from "../server/event-subscriptions/connection.js";

test("MCP webhook: direct host HTTP without relay, signed verification, durable duplicate/restart, host commit ack, expiry and teardown", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-hook-")),
    work = join(dir, "work");
  mkdirSync(work);
  let app = Fastify(),
    origin = "";
  let db = database(join(dir, "host")),
    vault = credentialVault(db, db.directory, work);
  let delivery: { url: string; secret: string } | undefined,
    subscribeCount = 0,
    unsubscribed = false,
    active = true;
  const toLocal: typeof fetch = (input, init) =>
    fetch(String(input).replace("https://newbot.test", origin), init);
  async function send(body: any, id: string, change?: Record<string, string>) {
    const raw = JSON.stringify(body),
      stamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac(
      "sha256",
      Buffer.from(delivery!.secret.slice(6), "base64"),
    )
      .update(`${id}.${stamp}.${raw}`)
      .digest("base64");
    return toLocal(delivery!.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "webhook-id": id,
        "webhook-timestamp": stamp,
        "webhook-signature": "v1," + signature,
        "x-mcp-subscription-id": "subscription",
        ...change,
      },
      body: raw,
    });
  }
  const peer: EventPeer = {
    close: async () => {},
    request: async (method, params) => {
      if (method === "events/list")
        return {
          events: [
            {
              name: "message.received",
              delivery: ["webhook"],
              inputSchema: { type: "object", properties: {} },
              payloadSchema: { type: "object" },
            },
          ],
        };
      if (method === "events/unsubscribe") {
        unsubscribed = true;
        return {};
      }
      assert.equal(method, "events/subscribe");
      delivery = params.delivery as typeof delivery;
      subscribeCount++;
      const challenge = randomBytes(16).toString("hex");
      const result = await send({ type: "verification", challenge }, "verify");
      assert.equal(result.status, 200);
      assert.deepEqual(await result.json(), { challenge });
      return {
        id: "subscription",
        cursor: "remote-position",
        refreshBefore: new Date(Date.now() + 3600000).toISOString(),
      };
    },
  };
  let hook = webhookDelivery(
      db,
      vault,
      "https://newbot.test",
      async () => peer,
    ),
    adapter = mcpEventAdapter(async () => peer, hook);
  async function listen() {
    hook.register(app);
    await app.listen({ port: 0, host: "127.0.0.1" });
    origin = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  }
  await listen();
  const context = {
    connectionId: "account.1",
    resource: JSON.stringify({ name: "message.received", arguments: {} }),
    cursor: null as string | null,
    signal: AbortSignal.timeout(10000),
  };
  try {
    const baseline = await adapter.pull(context);
    context.cursor = baseline.cursor;
    assert.equal(baseline.events.length, 0);
    const event = {
      eventId: "one",
      name: "message.received",
      timestamp: "2026-11-17T00:00:00Z",
      data: { text: "private-event" },
      cursor: "one",
    };
    assert.equal(
      (await send(event, "one", { "webhook-signature": "v1,wrong" })).status,
      401,
    );
    assert.equal(
      (await send(event, "one", { "webhook-timestamp": "1" })).status,
      401,
    );
    assert.equal(
      (await send(event, "one", { "x-mcp-subscription-id": "other" })).status,
      401,
    );
    assert.equal((await send(event, "one")).status, 200);
    assert.equal(
      (await send({ ...event, cursor: "later" }, "one")).status,
      200,
    );
    const page = await adapter.pull(context);
    assert.equal(page.events.length, 1);
    assert.equal(page.events[0].payload.text, "private-event");
    assert(page.receipt);
    assert(
      !JSON.stringify(
        db.raw.prepare("SELECT * FROM automation_event_webhooks").all(),
      ).includes(delivery!.secret),
    );
    await app.close();
    vault.close();
    db.raw.close();
    db = database(join(dir, "host"));
    vault = credentialVault(db, db.directory, work);
    hook = webhookDelivery(
      db,
      vault,
      "https://newbot.test",
      async () => peer,
      () => active,
    );
    app = Fastify();
    await listen();
    adapter = mcpEventAdapter(async () => peer, hook);
    await adapter.acknowledge(context, page.receipt!);
    await adapter.acknowledge(context, page.receipt!);
    assert.equal((await adapter.pull(context)).events.length, 0);
    assert.equal(subscribeCount, 1);
    active = false;
    assert.equal(
      (await send({ ...event, eventId: "revoked" }, "revoked")).status,
      410,
    );
    await hook.reconcile(new Set());
    assert(unsubscribed);
    assert.equal((await send(event, "one")).status, 410);
  } finally {
    vault.close();
    db.raw.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
