import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RelayStore } from "../services/event-relay/store.js";
import { relayServer } from "../services/event-relay/server.js";
const event = {
  specversion: "1.0",
  id: "one",
  source: "producer",
  type: "message.received",
  time: "2026-11-17T00:00:00Z",
  data: { text: "private-content-relay" },
};
test("Relay: durable encrypted acceptance, duplicate/conflict, lease takeover and isolated idempotent ack", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-"));
  let now = 1,
    db = new RelayStore(dir, () => now, 1);
  try {
    const route = db.createRoute(),
      other = db.createRoute();
    assert(db.authorize(route.id, route.producer, "producer"));
    assert(!db.authorize(route.id, route.producer, "consumer"));
    db.publish(route.id, event);
    assert.equal(db.publish(route.id, event).duplicate, true);
    assert.throws(
      () => db.publish(route.id, { ...event, data: { text: "changed" } }),
      /conflict/,
    );
    assert.throws(
      () => db.publish(route.id, { ...event, id: "two" }),
      /capacity/,
    );
    const first = db.lease(route.id);
    assert.equal(db.lease(route.id).events.length, 0);
    db.close();
    db = new RelayStore(dir, () => now, 1);
    now += 61000;
    const second = db.lease(route.id);
    assert.notEqual(first.receipt, second.receipt);
    assert.equal(second.events[0].data.text, event.data.text);
    assert.throws(() => db.ack(other.id, second.receipt!), /expired/);
    assert.throws(() => db.ack(route.id, first.receipt!), /expired/);
    db.ack(route.id, second.receipt!);
    db.ack(route.id, second.receipt!);
    assert.equal(db.lease(route.id).events.length, 0);
    assert(
      !readFileSync(join(dir, "relay.sqlite")).includes(
        Buffer.from(event.data.text),
      ),
    );
    db.revoke(route.id);
    assert(!db.authorize(route.id, route.consumer, "consumer"));
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Relay: actual HTTP caller roles cannot publish or acknowledge another route", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-http-")),
    admin = "a".repeat(40),
    { app } = relayServer({ directory: dir, adminToken: admin });
  try {
    const route = (
      await app.inject({
        method: "POST",
        url: "/v1/routes",
        headers: { authorization: "Bearer " + admin },
      })
    ).json();
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/v1/routes/${route.id}/events`,
          headers: { authorization: "Bearer " + route.consumer },
          payload: event,
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: `/v1/routes/${route.id}/events`,
          headers: { authorization: "Bearer " + route.producer },
          payload: event,
        })
      ).statusCode,
      200,
    );
    const lease = (
      await app.inject({
        method: "POST",
        url: `/v1/routes/${route.id}/lease`,
        headers: { authorization: "Bearer " + route.consumer },
        payload: { waitMs: 0 },
      })
    ).json();
    assert.equal(lease.events.length, 1);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("Relay: two durable subscriber groups each receive the same event and acknowledgments do not steal a peer's delivery", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-fanout-")),
    db = new RelayStore(dir);
  try {
    const route = db.createRoute();
    db.subscribe(route.id, "a");
    db.subscribe(route.id, "b");
    db.publish(route.id, event);
    const a = db.lease(route.id, "a");
    db.ack(route.id, a.receipt!, "a");
    const b = db.lease(route.id, "b");
    assert.equal(b.events[0].id, "one");
    assert.equal(db.lease(route.id, "a").events.length, 0);
    db.ack(route.id, b.receipt!, "b");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Relay: crash after host commit can release an expired receipt; superseded receipts do not acknowledge the current lease or wedge the host",async()=>{
 const dir=mkdtempSync(join(tmpdir(),"relay-stale-"));let now=1;
 const {app,store}=relayServer({directory:dir,adminToken:"a".repeat(40),now:()=>now});
 try{
  const route=store.createRoute();store.publish(route.id,event);const old=store.lease(route.id);now+=61000;
  const current=store.lease(route.id);assert.notEqual(current.receipt,old.receipt);
  const res=await app.inject({method:"POST",url:`/v1/routes/${route.id}/ack`,headers:{authorization:"Bearer "+route.consumer},payload:{receipt:old.receipt}});
  assert.equal(res.statusCode,200);assert.deepEqual(res.json(),{acknowledged:false,obsolete:true});
  assert.equal(store.lease(route.id).events.length,0);now+=61000;
  store.ack(route.id,current.receipt!);assert.equal(store.lease(route.id).events.length,0);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
