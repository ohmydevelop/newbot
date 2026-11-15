import assert from "node:assert/strict";
import { test } from "node:test";
import { readCurrentConfiguration } from "../web/configuration-read";
import { createOperationScope } from "../web/operation-scope";

test("a directory response for an old provider revision is discarded and reread", async () => {
  let revision = "before",
    calls = 0;
  const result = await readCurrentConfiguration(
    () => revision,
    async () => {
      calls++;
      if (calls === 1) {
        revision = "after";
        return ["old-model"];
      }
      return ["new-model"];
    },
    () => true,
  );
  assert.deepEqual(result, ["new-model"]);
  assert.equal(calls, 2);
});

test("an obsolete directory failure does not hide the replacement provider's models", async () => {
  let revision = "before",
    calls = 0;
  assert.deepEqual(
    await readCurrentConfiguration(
      () => revision,
      async () => {
        if (++calls === 1) {
          revision = "after";
          throw new Error("old provider offline");
        }
        return ["available"];
      },
      () => true,
    ),
    ["available"],
  );
});

test("an old automatic read cannot overwrite a manual refresh or unlock it", async () => {
  let busy = "",
    release!: (models: string[]) => void;
  const scope = createOperationScope((value) => {
    busy = value;
  });
  scope.activate();
  const initial = scope.start("read", "catalog")!;
  const old = readCurrentConfiguration(
    () => "revision",
    () =>
      new Promise<string[]>((resolve) => {
        release = resolve;
      }),
    initial.isCurrent,
  );
  const refresh = scope.start("write", "refresh")!;
  const current = await readCurrentConfiguration(
    () => "revision",
    async () => ["fresh"],
    refresh.isCurrent,
  );
  release(["stale"]);
  assert.equal(await old, undefined);
  initial.finish();
  assert.equal(busy, "refresh");
  assert.deepEqual(current, ["fresh"]);
  refresh.finish();
  assert.equal(busy, "");
});

test("current failure is visible, disposed reads do not retry, and continuous edits are bounded", async () => {
  await assert.rejects(
    readCurrentConfiguration(
      () => "same",
      async () => {
        throw new Error("offline");
      },
      () => true,
    ),
    /offline/,
  );
  let live = true,
    calls = 0;
  assert.equal(
    await readCurrentConfiguration(
      () => "same",
      async () => {
        calls++;
        live = false;
        throw new Error("late");
      },
      () => live,
    ),
    undefined,
  );
  assert.equal(calls, 1);
  let revision = 0;
  await assert.rejects(
    readCurrentConfiguration(
      () => String(revision),
      async () => ++revision,
      () => true,
    ),
    /模型配置已变化/,
  );
  assert.equal(revision, 3);
});
