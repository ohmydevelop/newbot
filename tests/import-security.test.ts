import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readFile,
  rename,
  lstat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zip } from "./import-zip-fixture.js";
import { randomUUID, randomBytes } from "node:crypto";
import { IMPORT_LIMITS } from "../shared/imports.js";
import { sessionExtensions } from "../server/session-extensions.js";
import {
  importPath,
  extractImportZip,
  importTree,
} from "../server/import-files.js";
import { githubLocation, pinnedGithubSource } from "../server/github-imports.js";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { ProviderRuntime } from "../server/provider-runtime.js";

test("ZIP extraction preserves ordinary resources and mode; rejects traversal, links, bombs, duplicate names and bad CRC", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbot-zip-policy-"));
  try {
    const cases = [
      [
        "good",
        [
          { name: "skill/SKILL.md", data: Buffer.from("test") },
          {
            name: "skill/scripts/run.sh",
            data: Buffer.from("exit 0"),
            mode: 0o100700,
          },
        ],
        true,
      ],
      ["escape", [{ name: "../escape", data: Buffer.from("x") }], false],
      [
        "link",
        [{ name: "linked", data: Buffer.from("/etc/passwd"), mode: 0o120777 }],
        false,
      ],
      ["bomb", [{ name: "huge", data: Buffer.alloc(2 * 1024 * 1024) }], false],
      [
        "duplicate",
        [
          { name: "same", data: Buffer.from("1") },
          { name: "same", data: Buffer.from("2") },
        ],
        false,
      ],
      ["crc", [{ name: "bad", data: Buffer.from("broken"), crc: 123 }], false],
    ] as const;
    for (const [name, entries, valid] of cases) {
      const path = join(root, name + ".zip"),
        out = join(root, name);
      await writeFile(path, zip([...entries]));
      await mkdir(out);
      if (valid) {
        const tree = await extractImportZip(path, out);
        assert.equal(tree.files.length, 2);
        assert.ok(
          (await lstat(join(out, "skill/scripts/run.sh"))).mode & 0o100,
        );
      } else await assert.rejects(extractImportZip(path, out), Error, name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("native-sized resources survive ZIP and session capture while oversized files stay rejected", async () => {
  const root = await mkdtemp(join(tmpdir(), "newbot-native-size-"));
  try {
    const out = join(root, "unpacked"),
      path = join(root, "plugin.zip");
    await mkdir(out);
    const binary = randomBytes(9 * 1024 * 1024);
    await writeFile(
      path,
      zip([
        { name: "bin/native", data: binary, mode: 0o100755 },
        {
          name: "skills/demo/SKILL.md",
          data: Buffer.from(
            "---\nname: demo\ndescription: Fixture\n---\nNo executable steps.\n",
          ),
        },
      ]),
    );
    const extracted = await extractImportZip(path, out);
    assert.deepEqual(
      extracted.files.find((f) => f.path === "bin/native")!.data,
      binary,
    );
    assert.ok((await lstat(join(out, "bin/native"))).mode & 0o100);
    const library = {
      list: async () => ({
        skills: [
          {
            id: "fixture",
            path: join(out, "skills/demo/SKILL.md"),
            scope: "user",
            enabled: true,
          },
        ],
      }),
      readCurrent: async () => ({}),
    };
    const core = {
      read: async () => ({ response: {} }),
      extensions: {
        revision: "fixed",
        snapshot: () => ({ revision: "fixed" }),
        config: () => ({ skills: { config: [] } }),
        packageRoot: () => out,
      },
    };
    const session = sessionExtensions(
      {} as any,
      {} as any,
      core as any,
      library as any,
      { list: async () => ({ entries: [] }) } as any,
    );
    assert.equal((await session.capture())!.resources.length, 1);
    const large = Buffer.alloc(IMPORT_LIMITS.fileBytes + 1);
    await writeFile(join(out, "too-large"), large);
    await assert.rejects(importTree(out), /单文件超过 16 MiB/);
    await assert.rejects(session.capture(), /复制限制/);
    await writeFile(path, zip([{ name: "too-large", data: large }]));
    const bad = join(root, "bad");
    await mkdir(bad);
    await assert.rejects(extractImportZip(path, bad), /单文件超过 16 MiB/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("import paths and GitHub references stay inside a selected package and fixed public service", () => {
  for (const path of [
    "../x",
    "/x",
    "a/../x",
    "a\\x",
    ".git/config",
    "a//b",
    "x:y",
    "a/\u0000",
  ])
    assert.throws(() => importPath(path));
  assert.deepEqual(
    githubLocation("https://github.com/example/repo/tree/main/skills/demo"),
    { owner: "example", repo: "repo", tail: "main/skills/demo", tag: false },
  );
  assert.equal(
    pinnedGithubSource({ url: "https://github.com/example/repo", ref: "feature/branch", path: "skills", commit: "a".repeat(40) })
      .ref,
    "feature/branch",
  );
  for (const url of [
    "http://github.com/a/b",
    "https://x@github.com/a/b",
    "https://github.com.evil/a/b",
    "https://github.com/a/b?token=secret",
  ])
    assert.throws(() => githubLocation(url));
});
test("staging budget includes abandoned sources, releases cancelled content and keeps retained sources reachable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "newbot-import-budget-"));
  const codex = new FakeCodex();
  codex.home = join(directory, "codex");
  const ctx = await createServer({
    directory,
    cwd: join(directory, "work"),
    codex,
    providerRuntime: new ProviderRuntime(),
    password: "import-budget-test",
  });
  try {
    const first = await ctx.imports.create({
      kind: "files",
      name: "older retained source",
    });
    await ctx.imports.upload(first.id, "note.txt", Buffer.from("retained"));
    for (let i = 0; i < 22; i++) {
      const s = await ctx.imports.create({
        kind: "files",
        name: "cancelled " + i,
      });
      await ctx.imports.discard(s.id);
    }
    assert.equal(ctx.imports.list()[0].id, first.id);
    const retained = [first];
    for (let i = 0; i < 3; i++)
      retained.push(
        await ctx.imports.create({ kind: "files", name: "pending " + i }),
      );
    await assert.rejects(
      ctx.imports.create({ kind: "files", name: "over budget" }),
      /4 个暂存来源/,
    );
    await ctx.imports.discard(first.id);
    assert.equal(ctx.imports.get(first.id).retained, false);
    await assert.rejects(lstat(join(directory, "imports/staging", first.id)));
    await ctx.imports.create({ kind: "files", name: "budget released" });
  } finally {
    await ctx.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("SQLite journal restores package, preferences and interrupted import without claiming success", async () => {
  const directory = await mkdtemp(join(tmpdir(), "newbot-import-recovery-")),
    cwd = join(directory, "work"),
    home = join(directory, "codex");
  await mkdir(cwd);
  await mkdir(home);
  const open = async () => {
    const c = new FakeCodex();
    c.home = home;
    const ctx = await createServer({
      directory,
      cwd,
      codex: c,
      providerRuntime: new ProviderRuntime(),
      password: "import-recovery-test",
    });
    await ctx.service.settings();
    return ctx;
  };
  let ctx = await open();
  try {
    const id = randomUUID(),
      entryId = "a".repeat(64),
      target = join(home, "skills/import-demo"),
      backup = join(directory, "imports/backups", randomUUID());
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "SKILL.md"), "original");
    await mkdir(backup, { recursive: true });
    await rename(target, join(backup, "asset"));
    await mkdir(target);
    await writeFile(join(target, "SKILL.md"), "interrupted replacement");
    const previous = ctx.runtime.extensionRuntime!.snapshot().values;
    ctx.runtime.extensionRuntime!.setSkill(join(target, "SKILL.md"), false);
    const prior = {
      id: entryId,
      kind: "skills",
      name: "demo",
      path: target,
      digest: "old",
      content: JSON.stringify({ skills: [], manifest: {}, installed: true }),
    };
    ctx.db.raw
      .prepare("INSERT INTO extension_packages VALUES(?,?,?,?,?,?)")
      .run(prior.id, prior.kind, prior.name, prior.path, "new", prior.content);
    ctx.db.raw.prepare("INSERT INTO extension_install_journal VALUES(?,?)").run(
      randomUUID(),
      JSON.stringify({
        entryId,
        kind: "skills",
        target,
        backup,
        cache: join(home, "plugins/cache/newbot-imports/demo"),
        hadTarget: true,
        hadCache: false,
        prior,
        settings: previous,
      }),
    );
    ctx.db.raw.prepare("INSERT INTO extension_imports VALUES(?,?,?,?)").run(
      id,
      "installing",
      JSON.stringify({
        id,
        state: "installing",
        source: { kind: "files", name: "demo" },
        entries: [{ id: entryId, state: "available" }],
        created: Date.now(),
        bytes: 0,
        files: 0,
      }),
      Date.now(),
    );
    await ctx.app.close();
    ctx = await open();
    assert.equal(await readFile(join(target, "SKILL.md"), "utf8"), "original");
    assert.equal(
      ctx.runtime.extensionRuntime!.skillEnabled(
        join(target, "SKILL.md"),
        true,
      ),
      true,
    );
    assert.equal(ctx.imports.get(id).entries[0].state, "failed");
    assert.equal(
      ctx.db.raw
        .prepare("SELECT count(*) n FROM extension_install_journal")
        .get()!.n,
      0,
    );
    const unauthorized = await ctx.app.inject({ url: "/api/imports/" + id });
    assert.equal(unauthorized.statusCode, 401);
  } finally {
    await ctx.app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
