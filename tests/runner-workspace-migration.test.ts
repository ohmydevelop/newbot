import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { database } from "../server/db.js";
import { workspaces } from "../server/workspaces.js";
import { instanceLease } from "../server/instance-lease.js";
import {
  inspectWorkspaceMigration,
  migrateWorkspaces,
  rollbackWorkspaceMigration,
} from "../server/runner/workspace-migration.js";
import { ExtensionRuntime } from "../server/extension-runtime.js";
async function fixture(run: (x: any) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "newbot-migrate-")),
    directory = join(root, "server"),
    legacy = join(directory, "workspace"),
    target = join(root, "Newbot/workspaces");
  await mkdir(legacy, { recursive: true });
  const db = database(directory);
  db.addThread("legacy-a", "fixture");
  db.addThread("legacy-b", "fixture");
  const spaces = workspaces(directory, legacy, db),
    space = spaces.allocate();
  db.addThread("modern", "fixture");
  spaces.bind("modern", space);
  await mkdir(join(space.root, ".agents/skills/example"), { recursive: true });
  await writeFile(join(space.root, ".agents/skills/example/SKILL.md"), "skill");
  await writeFile(join(legacy, "legacy.txt"), "legacy");
  await mkdir(join(space.root, "empty"));
  await writeFile(join(space.root, "result.txt"), "immutable original");
  spaces.confirm("modern", "fixture", {
    resources: [
      {
        path: "/package/SKILL.md",
        projectPath: join(space.root, ".agents/skills/example/SKILL.md"),
        projectRoot: join(space.root, ".agents/skills/example"),
      },
    ],
    config: {
      skills: {
        config: [
          {
            path: join(space.root, ".agents/skills/example/SKILL.md"),
            enabled: false,
          },
        ],
      },
    },
  });
  db.raw.close();
  const lease = await instanceLease(directory);
  await lease.release(true);
  try {
    await run({ root, directory, legacy, target, space });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("offline workspace migration preserves original files, logical identities, projections and an immediate rollback", () =>
  fixture(async ({ directory, legacy, target, space }) => {
    const before = await inspectWorkspaceMigration(directory, target);
    assert.equal(before.groups.length, 2);
    await assert.rejects(stat(join(directory, "migrations")));
    const result = await migrateWorkspaces(directory, target);
    assert.equal(result.threads, 3);
    assert.equal(result.files, 3);
    assert.equal(
      await readFile(join(space.root, "result.txt"), "utf8"),
      "immutable original",
    );
    const db = database(directory);
    try {
      const spaces = workspaces(directory, legacy, db);
      assert.equal(spaces.root("modern"), join(target, space.id));
      assert.equal(spaces.root("legacy-a"), spaces.root("legacy-b"));
      assert.equal(
        await readFile(join(spaces.root("legacy-a"), "legacy.txt"), "utf8"),
        "legacy",
      );
      assert.equal(
        spaces.saved("modern").snapshot.config.skills.config[0].enabled,
        false,
      );
      assert.equal(
        spaces.saved("modern").snapshot.resources[0].projectPath,
        join(target, space.id, ".agents/skills/example/SKILL.md"),
      );
      assert.ok((await stat(join(target, space.id, "empty"))).isDirectory());
    } finally {
      db.raw.close();
    }
    await rollbackWorkspaceMigration(directory, result.id);
    const rolled = database(directory);
    try {
      assert.equal(
        workspaces(directory, legacy, rolled).root("modern"),
        space.root,
      );
    } finally {
      rolled.raw.close();
    }
    assert.equal(
      await readFile(join(target, space.id, "result.txt"), "utf8"),
      "immutable original",
    );
  }));
test("running instance, existing destination and symlink inputs cannot be migrated", () =>
  fixture(async ({ directory, target, space, root }) => {
    const live = await instanceLease(directory);
    await assert.rejects(migrateWorkspaces(directory, target), /仍在运行/);
    await live.release(true);
    await mkdir(target, { recursive: true });
    await assert.rejects(migrateWorkspaces(directory, target), /已存在/);
    await rm(target, { recursive: true });
    await symlink(
      join(root, "server/private-credentials.key"),
      join(space.root, "alias"),
    );
    await assert.rejects(migrateWorkspaces(directory, target), /链接/);
    await assert.rejects(stat(target));
  }));
test("rollback refuses changed workspaces and any later Server start without deleting either copy", () =>
  fixture(async ({ directory, target, space }) => {
    const r = await migrateWorkspaces(directory, target);
    await writeFile(join(target, space.id, "result.txt"), "new data");
    await assert.rejects(rollbackWorkspaceMigration(directory, r.id), /已变化/);
    assert.equal(
      await readFile(join(target, space.id, "result.txt"), "utf8"),
      "new data",
    );
    await writeFile(join(target, space.id, "result.txt"), "immutable original");
    const live = await instanceLease(directory);
    await live.release(true);
    await assert.rejects(rollbackWorkspaceMigration(directory, r.id), /已启动/);
  }));
test("imported skill identity is package-relative while existing IDs and old aliases are retained", () =>
  fixture(async ({ directory, root }) => {
    const db = database(directory);
    try {
      const id = "a".repeat(64),
        path = join(root, "package"),
        next = join(root, "new-node/package");
      db.raw
        .prepare("INSERT INTO extension_packages VALUES(?,?,?,?,?,?)")
        .run(id, "skills", "example", path, "b".repeat(64), "{}");
      const ext = new ExtensionRuntime(db),
        old = ext.asset({
          path: join(path, "nested/SKILL.md"),
          name: "test",
          pluginId: null,
        });
      db.raw
        .prepare("UPDATE extension_packages SET path=? WHERE id=?")
        .run(next, id);
      const moved = ext.asset({
        path: join(next, "nested/SKILL.md"),
        name: "test",
        pluginId: null,
      });
      assert.equal(moved, old);
      assert.equal(ext.resolveAlias(old), old);
      const other = ext.asset({
        path: join(next, "another/SKILL.md"),
        name: "test",
        pluginId: null,
      });
      assert.notEqual(other, old);
    } finally {
      db.raw.close();
    }
  }));

test("failed database publication keeps original bindings and both durable copies", () =>
  fixture(async ({ directory, target, space }) => {
    const { DatabaseSync } = await import("node:sqlite");
    let db = new DatabaseSync(join(directory, "minimal-agent.sqlite"));
    db.exec(
      "CREATE TRIGGER fail_migration BEFORE UPDATE ON thread_workspaces BEGIN SELECT RAISE(ABORT,'synthetic publication failure'); END",
    );
    db.close();
    await assert.rejects(
      migrateWorkspaces(directory, target),
      /synthetic publication failure/,
    );
    assert.equal(
      await readFile(join(space.root, "result.txt"), "utf8"),
      "immutable original",
    );
    assert.equal(
      await readFile(join(target, space.id, "result.txt"), "utf8"),
      "immutable original",
    );
    db = new DatabaseSync(join(directory, "minimal-agent.sqlite"), {
      readOnly: true,
    });
    try {
      assert.equal(
        (
          db
            .prepare(
              "SELECT root FROM thread_workspaces WHERE thread_id='modern'",
            )
            .get() as any
        ).root,
        space.root,
      );
      assert.equal(
        db
          .prepare(
            "SELECT value FROM metadata WHERE key='runner:workspace-root'",
          )
          .get(),
        undefined,
      );
    } finally {
      db.close();
    }
  }));
