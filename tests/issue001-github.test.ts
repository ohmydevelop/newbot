import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  githubCatalog,
  githubLocation,
  pinnedGithubSource,
} from "../server/github-imports.js";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { ProviderRuntime } from "../server/provider-runtime.js";
import { zip } from "./import-zip-fixture.js";

const sha = "a".repeat(40),
  moved = "b".repeat(40);

test("only repository homepages discover defaults; tree links resolve slash refs, tags, commits and directories without a catalog", async () => {
  const calls: string[] = [];
  const catalog = githubCatalog((async (
    input: string,
    options: RequestInit,
  ) => {
    calls.push(input);
    assert.equal(options.redirect, "error");
    assert.equal(new Headers(options.headers).get("authorization"), null);
    const path = new URL(input).pathname;
    const body =
      path === "/repos/sample/repo"
        ? { default_branch: "trunk" }
        : ["feature%2Fapi", "v1.2.0", "trunk", sha].some(
              (ref) => path === `/repos/sample/repo/commits/${ref}`,
            )
          ? { sha }
          : null;
    return Response.json(body, { status: body ? 200 : 404 });
  }) as typeof fetch);
  assert.deepEqual(
    await catalog.resolve(
      "https://github.com/sample/repo/tree/feature/api/skills/demo",
    ),
    {
      owner: "sample",
      repo: "repo",
      ref: "feature/api",
      path: "skills/demo",
      commit: sha,
    },
  );
  assert.equal(
    calls.some((url) => url.endsWith("/repos/sample/repo")),
    false,
  );
  assert.equal(
    (await catalog.resolve("https://github.com/sample/repo/tree/v1.2.0")).ref,
    "v1.2.0",
  );
  assert.equal(
    (await catalog.resolve(`https://github.com/sample/repo/tree/${sha}/skills`))
      .path,
    "skills",
  );
  assert.equal(
    (await catalog.resolve("https://github.com/sample/repo.git/")).ref,
    "trunk",
  );
  assert.equal(
    calls.filter((url) => url.endsWith("/repos/sample/repo")).length,
    1,
  );
  assert.ok(calls.every((url) => !/\/(branches|tags)\?/.test(url)));
});

test("release links resolve the exact tag, including annotated slash tags, without a same-name branch", async () => {
  const calls: string[] = [];
  const catalog = githubCatalog((async (input: string) => {
    const path = new URL(input).pathname;
    calls.push(path);
    const body =
      path === "/repos/sample/repo/git/ref/tags/release%2Fv1"
        ? { ref: "refs/tags/release/v1", object: { type: "tag", sha: moved } }
        : path === `/repos/sample/repo/git/tags/${moved}`
          ? { object: { type: "commit", sha } }
          : path === "/repos/sample/repo/git/ref/tags/v2"
            ? { ref: "refs/tags/v2", object: { type: "commit", sha } }
            : null;
    return Response.json(body, { status: body ? 200 : 404 });
  }) as typeof fetch);
  assert.deepEqual(
    await catalog.resolve(
      "https://github.com/sample/repo/releases/tag/release/v1",
    ),
    { owner: "sample", repo: "repo", ref: "release/v1", path: "", commit: sha },
  );
  assert.equal(
    (await catalog.resolve("https://github.com/sample/repo/releases/tag/v2"))
      .commit,
    sha,
  );
  assert.ok(calls.every((path) => path.includes("/git/")));
});

test("an explicit missing ref never falls back to default; malformed and cyclic tag objects fail", async () => {
  const calls: string[] = [];
  const missing = githubCatalog((async (input: string) => {
    calls.push(input);
    return Response.json({}, { status: 404 });
  }) as typeof fetch);
  await assert.rejects(
    missing.resolve("https://github.com/a/b/tree/missing/skills"),
    /未找到链接中的分支或标签/,
  );
  await assert.rejects(
    missing.resolve("https://github.com/a/b/releases/tag/missing"),
    /未找到链接中的标签/,
  );
  assert.ok(calls.every((url) => !url.endsWith("/repos/a/b")));
  for (const type of ["tree", "tag"]) {
    const invalid = githubCatalog((async () =>
      Response.json({
        ref: "refs/tags/v1",
        object: { type, sha },
      })) as typeof fetch);
    await assert.rejects(
      invalid.resolve("https://github.com/a/b/releases/tag/v1"),
      /未指向可导入|引用无效/,
    );
  }
});

test("URL and upstream validation reject credentials, unrelated hosts, malformed JSON and oversized responses", async () => {
  for (const url of [
    "http://github.com/a/b",
    "https://github.com.evil/a/b",
    "https://user:secret@github.com/a/b",
    "https://github.com/a/b?token=x",
    "https://github.com/a/b/tree/%ZZ",
    "https://github.com/a/b/releases/tag",
    "https://github.com/a/b/releases",
  ])
    assert.throws(() => githubLocation(url));
  let calls = 0;
  const invalid = githubCatalog((async () => {
    calls++;
    return new Response("<html>secret</html>", {
      headers: { "content-type": "text/html" },
    });
  }) as typeof fetch);
  await assert.rejects(invalid.resolve("https://localhost/a/b"), /公开 github/);
  assert.equal(calls, 0);
  await assert.rejects(invalid.resolve("https://github.com/a/b"), /无效/);
  const huge = githubCatalog(
    (async () =>
      new Response('"' + "x".repeat(1024 * 1024) + '"', {
        headers: { "content-type": "application/json" },
      })) as typeof fetch,
  );
  await assert.rejects(huge.resolve("https://github.com/a/b"), /预算/);
});

test("existing pinned sources keep captured ref/path; unpinned legacy drafts and traversal fail", () => {
  const source = {
    url: "https://github.com/sample/repo/tree/feature/api",
    ref: "feature/api",
    path: "",
    commit: sha,
  };
  assert.deepEqual(pinnedGithubSource(source), {
    owner: "sample",
    repo: "repo",
    ref: "feature/api",
    path: "",
    commit: sha,
  });
  assert.throws(
    () => pinnedGithubSource({ ...source, commit: undefined }),
    /重新粘贴链接/,
  );
  assert.throws(() => pinnedGithubSource({ ...source, path: "../private" }));
});

test("a new scan reads the current branch tip while an existing scan keeps its snapshot", async () => {
  let current = sha;
  const catalog = githubCatalog((async () =>
    Response.json({ sha: current })) as typeof fetch);
  const url = "https://github.com/sample/repo/tree/main";
  const first = await catalog.resolve(url);
  current = moved;
  assert.equal((await catalog.resolve(url)).commit, moved);
  assert.equal(pinnedGithubSource({ url, ...first }).commit, sha);
});

test(
  "new imports reject overrides; restart and native scanning download the pinned commit and exact directory",
  { skip: !process.env.CODEX_BIN },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "newbot-url-import-"));
    let apiCalls = 0,
      downloads = 0;
    const archive = zip([
      {
        name: "repo-fixed/skills/demo/SKILL.md",
        data: Buffer.from(
          "---\nname: demo\ndescription: Synthetic import verification\n---\nUse the bundled instructions.\n",
        ),
      },
    ]);
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string, options: RequestInit) => {
        assert.equal(options.redirect, "error");
        const url = new URL(input);
        if (url.hostname === "codeload.github.com") {
          downloads++;
          assert.equal(url.pathname, `/sample/repo/zip/${sha}`);
          return new Response(archive);
        }
        assert.equal(url.hostname, "api.github.com");
        apiCalls++;
        const found = url.pathname.endsWith("/commits/feature%2Fapi");
        return Response.json(found ? { sha } : {}, {
          status: found ? 200 : 404,
        });
      },
    );
    const open = () =>
      createServer({
        directory,
        cwd: join(directory, "work"),
        codex: new FakeCodex(),
        providerRuntime: new ProviderRuntime(),
        password: "url-import-fixture",
      });
    let ctx = await open();
    const url = "https://github.com/sample/repo/tree/feature/api/skills/demo";
    try {
      for (const extra of [{ ref: "main" }, { path: "other" }])
        await assert.rejects(
          ctx.imports.create({ kind: "github", url, ...extra }),
        );
      assert.equal(apiCalls, 0, "invalid overrides fail before network access");
      const created = await ctx.imports.create({ kind: "github", url });
      assert.equal(created.source.ref, "feature/api");
      assert.equal(created.source.path, "skills/demo");
      assert.equal(created.source.commit, sha);
      const capturedCalls = apiCalls;
      await ctx.app.close();
      ctx = await open();
      const scanned = await ctx.imports.scan(created.id);
      assert.equal(scanned.state, "ready");
      assert.equal(
        scanned.entries.flatMap((e) => e.skills).some((s) => s.name === "demo"),
        true,
      );
      assert.equal(
        apiCalls,
        capturedCalls,
        "scanning after restart must not re-resolve a moving branch",
      );
      assert.equal(downloads, 1);
      assert.equal(ctx.imports.get(created.id).source.commit, sha);
    } finally {
      await ctx.app.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
