import { test } from "node:test";
import assert from "node:assert/strict";
import { EventType, type Event } from "@ag-ui/core";
import { EventFeed } from "../server/event-feed.js";
test("bounded polling buffers reset on gaps and process changes", () => {
  const snapshot: Event = {
    type: EventType.STATE_SNAPSHOT,
    snapshot: { recovered: true },
  };
  const feed = new EventFeed(() => [snapshot], 1024, 2);
  const first = feed.read();
  feed.push({ type: EventType.CUSTOM, name: "test", value: 1 });
  const next = feed.read(first.cursor);
  assert.equal(next.reset, false);
  assert.equal(next.events.length, 1);
  feed.push({ type: EventType.CUSTOM, name: "test", value: 2 });
  feed.push({ type: EventType.CUSTOM, name: "test", value: 3 });
  assert.equal(feed.read(first.cursor).reset, true);
  assert.deepEqual(feed.read(first.cursor).events, [snapshot]);
  assert.equal(feed.read(next.cursor).reset, false);
  const restart = new EventFeed(() => [snapshot]);
  assert.equal(restart.read(next.cursor).reset, true);
});
