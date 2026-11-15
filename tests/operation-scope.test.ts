import { test } from "node:test";
import assert from "node:assert/strict";
import { createOperationScope } from "../web/operation-scope";

function fixture() {
  const busy: string[] = [];
  const scope = createOperationScope((value) => busy.push(value));
  scope.activate();
  return { scope, busy };
}

test("a late success or failure cannot replace the latest detail or release its busy state", async () => {
  const { scope, busy } = fixture();
  let complete!: (value: string) => void;
  let view = "initial";
  const first = scope.start("read", "detail:a")!;
  const response = new Promise<string>((resolve) => {
    complete = resolve;
  });
  const pending = response
    .then((value) => {
      if (first.isCurrent()) view = value;
    })
    .finally(first.finish);
  const next = scope.start("read", "detail:b")!;
  assert.equal(first.signal.aborted, true);
  complete("stale detail");
  await pending;
  assert.equal(view, "initial");
  assert.equal(busy.at(-1), "detail:b");
  assert.equal(first.isCurrent(), false); // also guards an old request's catch
  assert.equal(next.isCurrent(), true);
  view = "current detail";
  next.finish();
  assert.equal(view, "current detail");
  assert.equal(busy.at(-1), "");
});

test("refresh is locked synchronously across all awaits, and can retry after failure", () => {
  const { scope, busy } = fixture();
  const first = scope.start("read", "refresh")!;
  assert.equal(busy.at(-1), "refresh");
  assert.equal(scope.start("read", "refresh"), null);
  first.finish();
  assert.ok(scope.start("read", "refresh"));
});

test("a write supersedes stale reads and excludes double submits and reads until readback ends", () => {
  const { scope, busy } = fixture();
  const old = scope.start("read", "list")!;
  const write = scope.start("write", "save")!;
  assert.equal(old.signal.aborted, true);
  assert.equal(old.isCurrent(), false);
  assert.equal(scope.start("write", "save"), null);
  assert.equal(scope.start("write", "delete"), null);
  assert.equal(scope.start("read", "list"), null);
  old.finish();
  assert.equal(busy.at(-1), "save");
  write.finish();
  assert.ok(scope.start("read", "list"));
});

test("unmount cancels only reads; late writes cannot update or unlock a newly mounted page", () => {
  const { scope, busy } = fixture();
  const read = scope.start("read", "list")!;
  scope.dispose();
  assert.equal(read.signal.aborted, true);
  assert.equal(scope.start("read", "list"), null);
  scope.activate();
  const write = scope.start("write", "save")!;
  scope.dispose();
  assert.equal(write.signal.aborted, false); // server may already have committed
  assert.equal(write.isCurrent(), false);
  scope.activate(); // React effect replay or a fresh page lifetime
  const next = scope.start("read", "list")!;
  write.finish();
  assert.equal(busy.at(-1), "list");
  assert.equal(next.isCurrent(), true);
});

test("different pages do not share locks, and finished callbacks cannot unlock a later request", () => {
  const a = fixture(),
    b = fixture();
  const first = a.scope.start("write", "save")!;
  assert.ok(b.scope.start("read", "list"));
  first.finish();
  a.scope.start("write", "delete");
  first.finish();
  assert.equal(a.busy.at(-1), "delete");
});
