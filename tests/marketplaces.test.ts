import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { database } from "../server/db.js";
import { ExtensionRuntime } from "../server/extension-runtime.js";
import { marketplaceLibrary } from "../server/marketplaces.js";
import { marketplaceState } from "../server/marketplace-state.js";
test("independent marketplaces persist, isolate same-name plugins, reject stale operations and retain previous roots on failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "marketplaces-"));
  const db = database(dir);
  const ext = new ExtensionRuntime(db);
  ext.invalidate();
  let installed = false,
    fail = false,
    prepares = 0;
  const discover = async () =>
    ({
      marketplaces: marketplaceState(db).entries.map((e) => ({
        name: e.name,
        path: e.root,
        interface: null,
        plugins: [
          { id: `same@${e.name}`, name: "same", installed, enabled: true },
        ],
      })),
      marketplaceLoadErrors: [],
    }) as any;
  const prepare = async (_dir: string, source: any) => {
    prepares++;
    if (fail) throw new Error("offline");
    return {
      name: source.source.split("/").at(-1),
      displayName: source.source.split("/").at(-1),
      root: `/snapshots/${prepares}`,
      discard: async () => {},
    };
  };
  const lib = marketplaceLibrary(db, ext, discover, prepare);
  try {
    const a = {
      source: "team/one",
      operationId: randomUUID(),
      expectedRevision: "absent",
    };
    const first = await lib.mutate("marketplace/add", a);
    await lib.mutate("marketplace/add", a);
    assert.equal(prepares, 1);
    await assert.rejects(
      lib.mutate("marketplace/add", { ...a, source: "team/two" }),
      /操作编号/,
    );
    await assert.rejects(
      lib.mutate("marketplace/add", {
        ...a,
        operationId: randomUUID(),
        source: "team/two",
      }),
      /已变化/,
    );
    const revision = (await lib.list()).revision;
    await lib.mutate("marketplace/add", {
      source: "team/two",
      expectedRevision: revision,
      operationId: randomUUID(),
    });
    assert.equal((await lib.list()).entries.length, 2);
    assert.deepEqual(Object.keys(ext.marketplaceConfig()), ["one", "two"]);
    assert.equal(ext.marketplaceRoots().length, 2);
    assert.deepEqual(
      (await discover()).marketplaces.map((m: any) => m.plugins[0].id),
      ["same@one", "same@two"],
    );
    const restarted = new ExtensionRuntime(db);
    assert.deepEqual(restarted.marketplaceConfig(), ext.marketplaceConfig());
    const before = marketplaceState(db);
    fail = true;
    await assert.rejects(
      lib.mutate("marketplace/upgrade", {
        id: first.id,
        expectedRevision: before.revision,
        operationId: randomUUID(),
      }),
      /offline/,
    );
    assert.deepEqual(marketplaceState(db), before);
    fail = false;
    installed = true;
    await assert.rejects(
      lib.mutate("marketplace/remove", {
        id: first.id,
        expectedRevision: before.revision,
        operationId: randomUUID(),
      }),
      /先卸载/,
    );
    installed = false;
    ext.setPlugin("same@one", true, true);
    await assert.rejects(lib.mutate("marketplace/remove", {id:first.id,expectedRevision:before.revision,operationId:randomUUID()}),/先卸载/);
    ext.setPlugin("same@one", false, false);
    await lib.mutate("marketplace/remove", {
      id: first.id,
      expectedRevision: before.revision,
      operationId: randomUUID(),
    });
    assert.deepEqual(Object.keys(ext.marketplaceConfig()), ["two"]);
  } finally {
    db.raw.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('reading a missing local marketplace does not create the source and returns a recoverable error',async()=>{
 const {prepareMarketplace}=await import('../server/marketplaces.js');
 const {access}=await import('node:fs/promises');
 const dir=await mkdtemp(join(tmpdir(),'market-source-')), source=join(dir,'missing');
 try {
  await assert.rejects(prepareMarketplace(dir,{source}),/来源地址和访问权限/);
  await assert.rejects(access(source));
 }finally{await rm(dir,{recursive:true,force:true})}
});
