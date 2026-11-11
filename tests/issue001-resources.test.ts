import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  utimes,
  mkdir,
  writeFile,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { database, DATABASE_VERSION } from "../server/db.js";
import { ExtensionResources } from "../server/extension-resources.js";
import { fileDigest } from "../server/import-files.js";

const files = (text: string) => [
  {
    path: "SKILL.md",
    data: Buffer.from(text),
    sha256: fileDigest(text),
    mode: 0o600,
  },
];
test("publication preserves referenced bytes across upgrades, uninstall and restart; unrelated packages do not share a lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "issue001-resources-"));
  let db = database(directory);
  try {
    const resources = new ExtensionResources(db),
      id = fileDigest("first"),
      other = fileDigest("second");
    const first = await resources.prepare(id, files("first version"));
    resources.publish(
      first,
      {
        kind: "plugin",
        name: "sample",
        content: { pluginId: "sample@market", version: "1.0" },
      },
      null,
      () => {},
    );
    resources.pin("thread:original", {
      config: {
        plugins: { "sample@market": { enabled: true, local_root: first.path } },
      },
    });
    const next = await resources.prepare(id, files("second version"));
    let release!: () => void;
    const held = resources.exclusive(
      [id],
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await assert.rejects(
      resources.exclusive([id], async () => {}),
      /正在修改/,
    );
    await assert.rejects(
      new ExtensionResources(db).exclusive([id], async () => {}),
      /正在修改/,
      "workspaces and installers share resource ownership",
    );
    await resources.exclusive([other], async () => {
      const second = await resources.prepare(other, files("independent"));
      resources.publish(
        second,
        { kind: "skills", name: "other", content: {} },
        null,
        () => {},
      );
    });
    release();
    await held;
    resources.publish(
      next,
      {
        kind: "plugin",
        name: "sample",
        content: { pluginId: "sample@market", version: "2.0" },
      },
      first.digest,
      () => {},
    );
    assert.equal(
      await readFile(join(first.path, "SKILL.md"), "utf8"),
      "first version",
    );
    assert.equal(resources.pins()["sample@market"].local_root, next.path);
    assert.throws(
      () =>
        resources.publish(
          first,
          { kind: "plugin", name: "sample", content: {} },
          first.digest,
          () => {},
        ),
      /已被更新/,
    );
    resources.retire(id);
    assert.equal(resources.pins()["sample@market"], undefined);
    db.raw.prepare("UPDATE extension_resource_versions SET created=0").run();
    db.raw.close();
    db = database(directory);
    assert.equal(
      (db.raw.prepare("PRAGMA user_version").get() as any).user_version,
      DATABASE_VERSION,
    );
    const restored = new ExtensionResources(db);
    await restored.collect();
    assert.equal(
      await readFile(join(first.path, "SKILL.md"), "utf8"),
      "first version",
      "old history and App references survive restart",
    );
    await assert.rejects(readFile(join(next.path, "SKILL.md")), {
      code: "ENOENT",
    });
    assert.equal(
      (
        db.raw
          .prepare("SELECT count(*) n FROM extension_resource_refs")
          .get() as any
      ).n,
      1,
    );
  } finally {
    db.raw.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("collection rechecks a republished version and removes only old unregistered preparation directories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "issue001-collection-")),
    db = database(directory);
  try {
    const resources = new ExtensionResources(db),
      id = fileDigest("republish");
    const prepared = await resources.prepare(id, files("preserve current"));
    const data = {
      kind: "plugin",
      name: "sample",
      content: { pluginId: "sample@market" },
    };
    resources.publish(prepared, data, null, () => {});
    resources.retire(id);
    db.raw.prepare("UPDATE extension_resource_versions SET created=0").run();
    const exclusive = resources.exclusive.bind(resources);
    let published = false;
    resources.exclusive = async (ids, work) => {
      if (!published) {
        published = true;
        resources.publish(prepared, data, null, () => {});
      }
      return exclusive(ids, work);
    };
    await resources.collect();
    assert.equal(
      await readFile(join(prepared.path, "SKILL.md"), "utf8"),
      "preserve current",
    );
    const orphan = await resources.prepare(
      fileDigest("orphan"),
      files("stale preparation"),
    );
    await utimes(dirname(orphan.path), new Date(0), new Date(0));
    const recent = await resources.prepare(
      fileDigest("recent"),
      files("recent preparation"),
    );
    const busy = await resources.prepare(
      fileDigest("busy"),
      files("busy preparation"),
    );
    await utimes(dirname(busy.path), new Date(0), new Date(0));
    const outside = join(directory, "outside");
    await mkdir(outside);
    await writeFile(join(outside, "keep"), "safe");
    await symlink(outside, join(resources.root, fileDigest("link")));
    await resources.exclusive([busy.id], () =>
      new ExtensionResources(db).collect(),
    );
    await assert.rejects(readFile(join(orphan.path, "SKILL.md")), {
      code: "ENOENT",
    });
    assert.equal(
      await readFile(join(recent.path, "SKILL.md"), "utf8"),
      "recent preparation",
    );
    assert.equal(
      await readFile(join(busy.path, "SKILL.md"), "utf8"),
      "busy preparation",
    );
    assert.equal(await readFile(join(outside, "keep"), "utf8"), "safe");
    await resources.discardPrepared(recent);
    await assert.rejects(readFile(join(recent.path, "SKILL.md")), {
      code: "ENOENT",
    });
    await resources.discardPrepared(prepared);
    assert.equal(
      await readFile(join(prepared.path, "SKILL.md"), "utf8"),
      "preserve current",
    );
  } finally {
    db.raw.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("standalone skill retirement changes discoverability without editing its immutable package", async () => {
  const directory = await mkdtemp(join(tmpdir(), "issue001-skills-")),
    db = database(directory);
  try {
    const resources = new ExtensionResources(db),
      id = fileDigest("skills");
    const prepared = await resources.prepare(id, files("skill content"));
    resources.publish(
      prepared,
      { kind: "skills", name: "bundle", content: {} },
      null,
      () => {},
    );
    const path = join(prepared.path, "SKILL.md");
    assert.equal(resources.skillAvailable(path), true);
    resources.removeSkill(path);
    assert.equal(resources.skillAvailable(path), false);
    assert.equal(await readFile(path, "utf8"), "skill content");
    assert.throws(
      () =>
        resources.publish(
          prepared,
          { kind: "skills", name: "bundle", content: {} },
          prepared.digest,
          () => {
            throw Error("transaction cancelled");
          },
        ),
      /transaction cancelled/,
    );
    assert.equal(
      resources.skillAvailable(path),
      false,
      "a failed publish cannot restore removed capabilities",
    );
  } finally {
    db.raw.close();
    await rm(directory, { recursive: true, force: true });
  }
});
