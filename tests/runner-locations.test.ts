import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeLocations } from "../server/runner/locations.js";
async function fixture(work: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "runner-paths-"));
  try {
    await work(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("fresh installs use independent standard global home and visible workspace directory", () =>
  fixture(async (root) => {
    const r = runtimeLocations({
      hostHome: join(root, "user"),
      project: join(root, "repo"),
      env: { CODEX_HOME: "/personal/ignored" },
    });
    assert.equal(r.layout, "standard");
    assert.equal(r.server, join(root, "user/.newbot/server"));
    assert.equal(r.codex, join(root, "user/.newbot/codex"));
    assert.equal(r.workspaceRoot, join(root, "user/Newbot/workspaces"));
  }));
test("an existing repository installation remains in place without automatic migration", () =>
  fixture(async (root) => {
    await mkdir(join(root, "repo/.data"), { recursive: true });
    await writeFile(join(root, "repo/.data/newbot.sqlite"), "fixture");
    const r = runtimeLocations({
      hostHome: join(root, "user"),
      project: join(root, "repo"),
      env: {},
    });
    assert.equal(r.layout, "legacy");
    assert.equal(r.server, join(root, "repo/.data"));
    assert.equal(r.codex, join(root, "repo/.data/codex"));
  }));
test("explicit data directory keeps existing deployment and test paths, custom roots remain independent", () =>
  fixture(async (root) => {
    const r = runtimeLocations({
      directory: join(root, "data"),
      cwd: join(root, "work"),
      hostHome: join(root, "user"),
      env: { NEWBOT_WORKSPACES_HOME: join(root, "spaces") },
    });
    assert.equal(r.layout, "legacy");
    assert.equal(r.legacyWorkspace, join(root, "work"));
    assert.equal(r.workspaceRoot, join(root, "spaces"));
  }));
test("personal Codex and linked aliases cannot become the new global home", () =>
  fixture(async (root) => {
    const host = join(root, "user");
    await mkdir(join(host, ".codex"), { recursive: true });
    await symlink(join(host, ".codex"), join(root, "alias"));
    for (const home of [
      join(host, ".codex"),
      join(host, ".codex/sub"),
      join(root, "alias"),
      host,
    ])
      assert.throws(
        () => runtimeLocations({ hostHome: host, env: { NEWBOT_HOME: home } }),
        /独立|个人/,
      );
  }));

test("explicitly choosing a blank home cannot hide an existing repository database", () =>
  fixture(async (root) => {
    await mkdir(join(root, "repo/.data"), { recursive: true });
    await writeFile(join(root, "repo/.data/newbot.sqlite"), "fixture");
    assert.throws(
      () =>
        runtimeLocations({
          hostHome: join(root, "user"),
          project: join(root, "repo"),
          env: { NEWBOT_HOME: join(root, "new-home") },
        }),
      /先完成目录迁移/,
    );
  }));
test("standard workspaces cannot contain the private runtime or be inside it", () =>
  fixture(async (root) => {
    for (const work of [
      join(root, "private"),
      join(root, "private/work"),
      root,
    ])
      assert.throws(
        () =>
          runtimeLocations({
            hostHome: join(root, "user"),
            project: join(root, "repo"),
            env: {
              NEWBOT_HOME: join(root, "private"),
              NEWBOT_WORKSPACES_HOME: work,
            },
          }),
        /分离|独立/,
      );
  }));

test("clearing the database keeps an existing repository installation in place", () =>
  fixture(async (root) => {
    await mkdir(join(root, "repo/.data/codex"), { recursive: true });
    await writeFile(join(root, "repo/.data/initial-password"), "fixture\n");
    const r = runtimeLocations({
      hostHome: join(root, "user"),
      project: join(root, "repo"),
      env: {},
    });
    assert.equal(r.layout, "legacy");
    assert.equal(r.server, join(root, "repo/.data"));
    assert.equal(r.codex, join(root, "repo/.data/codex"));
  }));

test("an empty .data directory does not pin the repository layout", () =>
  fixture(async (root) => {
    await mkdir(join(root, "repo/.data"), { recursive: true });
    const r = runtimeLocations({
      hostHome: join(root, "user"),
      project: join(root, "repo"),
      env: {},
    });
    assert.equal(r.layout, "standard");
    assert.equal(r.server, join(root, "user/.newbot/server"));
  }));
