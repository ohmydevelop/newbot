import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  linkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "../server/index.js";
import { database, DATABASE_VERSION } from "../server/db.js";
import { fileStore } from "../server/files.js";
import { storedBytes, STORAGE_LIMIT } from "../server/storage.js";
import { FakeCodex } from "./fixture.js";
const origin = "http://127.0.0.1:3100";
const password = "artifact-test-password-long";
async function setup(
  directory = mkdtempSync(join(tmpdir(), "newbot-artifacts-")),
  codex = new FakeCodex(),
) {
  const cwd = join(directory, "workspace");
  const ctx = await createServer({
    providerRuntime: null,
    directory,
    cwd,
    codex,
    password,
    origins: [origin],
  });
  await ctx.app.ready();
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password },
  });
  const headers = {
    origin,
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
  };
  await ctx.service.settings();
  const post = (url: string, payload: any) =>
    ctx.app.inject({ method: "POST", url, payload, headers });
  let latestThread = "",
    activeCwd = cwd;
  const get = (url: string) =>
    ctx.app.inject({
      url: url.startsWith("/api/workspace/files")
        ? url + (url.includes("?") ? "&" : "?") + "threadId=" + latestThread
        : url,
      headers,
    });
  async function turn() {
    const thread: any = await ctx.service.handle("thread/start", {
      provider: "fixture",
      model: "fixture-model",
    });
    latestThread = thread.id;
    activeCwd = ctx.workspaces.root(thread.id);
    const run: any = await ctx.service.handle("turn/start", {
      threadId: thread.id,
      text: "create artifact",
    });
    return { threadId: thread.id as string, turnId: run.turn.id as string };
  }
  return {
    ...ctx,
    codex,
    directory,
    get cwd() {
      return activeCwd;
    },
    headers,
    post,
    get,
    turn,
  };
}

test("artifact API binds real turns, rejects forged provenance, protects auth and serves HTML as inert text", async () => {
  const c = await setup();
  try {
    const { threadId, turnId } = await c.turn();
    writeFileSync(
      join(c.cwd, "page.html"),
      "<script>parent.fetch('/api/config')</script>",
    );
    const url = `/api/threads/${threadId}/artifacts`;
    assert.equal((await c.app.inject({ url })).statusCode, 401);
    assert.equal(
      (
        await c.app.inject({
          method: "POST",
          url,
          headers: { ...c.headers, origin: "https://evil.test" },
          payload: { turnId, path: "page.html" },
        })
      ).statusCode,
      403,
    );
    const before = c.codex.calls.length;
    assert.equal(
      (
        await c.post("/api/threads/foreign/artifacts", {
          turnId,
          path: "page.html",
        })
      ).statusCode,
      400,
    );
    assert.equal(c.codex.calls.length, before);
    assert.equal(
      (await c.post(url, { turnId: "made-up", path: "page.html" })).statusCode,
      400,
    );
    assert.equal(
      (
        await c.post(url, {
          turnId,
          path: "page.html",
          itemId: "forged-native-item",
        })
      ).statusCode,
      400,
    );
    const registered = await c.post(url, { turnId, path: "page.html" });
    assert.equal(registered.statusCode, 200, registered.body);
    const artifact = registered.json();
    assert.equal(artifact.source, "user");
    assert.equal(artifact.itemId, null);
    assert.equal(artifact.version, 1);
    assert.equal(JSON.stringify(artifact).includes(c.directory), false);
    assert.equal(
      (await c.post(url, { turnId, path: "page.html" })).json().id,
      artifact.id,
    );
    const content = await c.get(artifact.contentUrl);
    assert.match(content.headers["content-type"]!, /^text\/plain/);
    assert.match(content.headers["content-security-policy"]!, /sandbox/);
    assert.equal(content.headers["cache-control"], "private, no-store");
    const download = await c.get(artifact.downloadUrl);
    assert.match(download.headers["content-disposition"]!, /^attachment/);
    assert.equal(
      (await c.app.inject({ url: artifact.contentUrl })).statusCode,
      401,
    );
    assert.equal(
      (await c.service.read(threadId)).turns[0].artifacts?.[0].id,
      artifact.id,
    );
    const events = (
      await c.get(`/api/agent/events?transport=poll&threadId=${threadId}`)
    ).body;
    assert.ok(events.includes(artifact.id));
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});

test("workspace reads reject traversal, symlinks, hardlinks, credentials, oversized and unsupported files", async () => {
  const c = await setup();
  try {
    const { threadId, turnId } = await c.turn();
    mkdirSync(join(c.cwd, "safe"));
    writeFileSync(join(c.cwd, "safe", "ok.txt"), "hello");
    writeFileSync(join(c.directory, "outside.txt"), "private host data");
    symlinkSync(join(c.directory, "outside.txt"), join(c.cwd, "link.txt"));
    symlinkSync(join(c.cwd, "safe"), join(c.cwd, "shortcut"));
    linkSync(join(c.directory, "outside.txt"), join(c.cwd, "hard.txt"));
    writeFileSync(join(c.cwd, ".env"), "API_KEY=hidden");
    writeFileSync(join(c.cwd, "credentials.json"), "hidden");
    writeFileSync(
      join(c.cwd, "private.txt"),
      "-----BEGIN RSA PRIVATE KEY-----\nsecret",
    );
    writeFileSync(join(c.cwd, "bad.txt"), Buffer.from([0xff]));
    writeFileSync(join(c.cwd, "huge.txt"), Buffer.alloc(8 * 1024 * 1024 + 1));
    writeFileSync(join(c.cwd, "vector.svg"), "<svg/>");
    for (const path of [
      "../outside.txt",
      join(c.cwd, "safe/ok.txt"),
      "safe/../safe/ok.txt",
      "safe//ok.txt",
      "link.txt",
      "shortcut/ok.txt",
      "hard.txt",
      ".env",
      "credentials.json",
      "private.txt",
      "bad.txt",
      "huge.txt",
      "vector.svg",
      "safe",
      "safe\\ok.txt",
    ]) {
      const r = await c.post(`/api/threads/${threadId}/artifacts`, {
        turnId,
        path,
      });
      assert.equal(r.statusCode, 400, path);
      assert.equal(r.body.includes("private host data"), false);
      assert.equal(r.body.includes(c.directory), false);
    }
    assert.equal(
      (
        await c.post(`/api/threads/${threadId}/artifacts`, {
          turnId,
          path: "safe/ok.txt",
        })
      ).statusCode,
      200,
    );
    const listing = await c.get("/api/workspace/files");
    assert.equal(listing.statusCode, 200);
    const names = listing.json().entries.map((e: any) => e.name);
    assert.ok(
      !names.includes(".env") &&
        !names.includes("link.txt") &&
        !names.includes("credentials.json"),
    );
    assert.equal(
      (await c.get("/api/workspace/files?path=shortcut")).statusCode,
      400,
    );
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});

test("live fileChange capture is idempotent and immutable; failures stay out of the agent lifecycle", async () => {
  const c = await setup();
  try {
    const { threadId, turnId } = await c.turn();
    writeFileSync(join(c.cwd, "result.md"), "version one");
    const item = {
      id: "patch-one",
      type: "fileChange",
      status: "completed",
      changes: [
        {
          path: join(c.cwd, "result.md"),
          kind: { type: "add" },
          diff: "not a source of file content",
        },
      ],
    };
    c.codex.item(threadId, turnId, item, true);
    await c.artifacts.flush();
    const first = c.artifacts.list(threadId)[0];
    assert.equal(first.itemId, "patch-one");
    assert.equal(first.source, "fileChange");
    writeFileSync(join(c.cwd, "result.md"), "version two");
    c.codex.item(threadId, turnId, item, true);
    await c.artifacts.flush();
    assert.equal(c.artifacts.list(threadId).length, 1);
    assert.equal(
      (await c.artifacts.read(first.id)).data.toString(),
      "version one",
    );
    c.codex.item(threadId, turnId, { ...item, id: "patch-two" }, true);
    await c.artifacts.flush();
    assert.deepEqual(
      c.artifacts.list(threadId).map((a) => a.version),
      [1, 2],
    );
    c.codex.item(
      threadId,
      turnId,
      {
        ...item,
        id: "missing",
        changes: [{ path: "missing.txt", kind: { type: "add" } }],
      },
      true,
    );
    c.codex.item(
      threadId,
      turnId,
      {
        ...item,
        id: "deleted",
        changes: [{ path: "result.md", kind: { type: "delete" } }],
      },
      true,
    );
    c.codex.item(
      threadId,
      turnId,
      { ...item, id: "failed", status: "failed" },
      true,
    );
    await c.artifacts.flush();
    c.codex.finish(threadId);
    assert.equal(c.codex.active.size, 0);
    const history = await c.service.read(threadId);
    assert.equal(history.turns[0].artifacts?.length, 2);
    assert.equal(
      history.turns[0].artifactNotices?.[0].reason,
      "capture_failed",
    );
    const counts = c.db.raw
      .prepare("SELECT COUNT(*) count FROM artifact_sources")
      .get() as any;
    assert.equal(counts.count, 3);
    const old = { ...item, id: "missed-while-offline" };
    c.codex.threads.get(threadId)!.turns[0].items.push(old);
    await c.service.read(threadId);
    assert.equal(
      c.artifacts.list(threadId).length,
      2,
      "reading history must not recapture present-day files",
    );
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});

test("registered artifacts survive archive and restart; interrupted capture is not silently replayed", async () => {
  const c = await setup();
  let second: Awaited<ReturnType<typeof setup>> | undefined;
  try {
    const { threadId, turnId } = await c.turn();
    writeFileSync(join(c.cwd, "report.json"), '{"count":1}');
    const artifact = (
      await c.post(`/api/threads/${threadId}/artifacts`, {
        turnId,
        path: "report.json",
      })
    ).json();
    c.codex.finish(threadId);
    c.db.archive(threadId);
    c.db.raw
      .prepare(
        "INSERT INTO artifact_sources VALUES(?,?,?,?,'pending',NULL,NULL,?)",
      )
      .run(threadId, turnId, "lost", "report.json", Date.now());
    await c.app.close();
    writeFileSync(join(c.cwd, "report.json"), '{"count":99}');
    const native = new FakeCodex();
    native.threads = c.codex.threads;
    second = await setup(c.directory, native);
    assert.equal((await second.get(artifact.contentUrl)).body, '{"count":1}');
    assert.equal(
      (await second.service.read(threadId)).turns[0].artifacts?.[0].id,
      artifact.id,
    );
    assert.equal(
      second.artifacts.notices(threadId)[0].reason,
      "capture_interrupted",
    );
    assert.equal(second.db.list().length, 0);
    assert.equal(second.artifacts.list(threadId).length, 1);
    // Tampering never turns a known artifact ID into arbitrary local file access.
    writeFileSync(join(c.directory, "artifacts", artifact.sha256), "corrupt");
    assert.equal((await second.get(artifact.contentUrl)).statusCode, 410);
  } finally {
    if (second) await second.app.close();
    else await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});

test("upload and artifact quotas are shared and snapshots deduplicate across conversations", async () => {
  const c = await setup();
  try {
    const one = await c.turn();
    c.codex.finish(one.threadId);
    const two = await c.turn();
    writeFileSync(join(c.workspaces.root(one.threadId), "small.txt"), "shared");
    writeFileSync(join(c.workspaces.root(two.threadId), "small.txt"), "shared");
    const a = (
      await c.post(`/api/threads/${one.threadId}/artifacts`, {
        turnId: one.turnId,
        path: "small.txt",
      })
    ).json();
    const b = (
      await c.post(`/api/threads/${two.threadId}/artifacts`, {
        turnId: two.turnId,
        path: "small.txt",
      })
    ).json();
    assert.equal(a.sha256, b.sha256);
    assert.equal(storedBytes(c.db), 6);
    // Simulate a full store without allocating 512 MiB in a test.
    c.db.raw
      .prepare(
        "INSERT INTO attachments VALUES('quota','quota','text/plain',?,0,1)",
      )
      .run(STORAGE_LIMIT - 6);
    assert.throws(
      () => fileStore(c.directory, c.db).save("upload.txt", Buffer.from("a")),
      /512 MiB/,
    );
    writeFileSync(join(c.cwd, "new.txt"), "different");
    assert.equal(
      (
        await c.post(`/api/threads/${two.threadId}/artifacts`, {
          turnId: two.turnId,
          path: "new.txt",
        })
      ).statusCode,
      400,
    );
    assert.equal(c.artifacts.list(two.threadId).length, 1);
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});

test("v1 database migration preserves sessions, threads, attachments and rejects future schemas", () => {
  const dir = mkdtempSync(join(tmpdir(), "newbot-artifact-migrate-"));
  const path = join(dir, "newbot.sqlite");
  try {
    // The v1 schema is represented by a real old DB, not by the upgraded factory.
    const old = new DatabaseSync(path);
    old.exec(
      "CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE sessions(token TEXT PRIMARY KEY,expires INTEGER NOT NULL); CREATE TABLE threads(id TEXT PRIMARY KEY,title TEXT NOT NULL,provider TEXT NOT NULL,updated INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0); CREATE TABLE attachments(id TEXT PRIMARY KEY,name TEXT NOT NULL,mime TEXT NOT NULL,size INTEGER NOT NULL,created INTEGER NOT NULL,legacy INTEGER NOT NULL DEFAULT 0); PRAGMA user_version=1;",
    );
    old.prepare("INSERT INTO metadata VALUES(?,?)").run("custom", "keep");
    old
      .prepare("INSERT INTO threads VALUES('old','history','fixture',1,0)")
      .run();
    old
      .prepare(
        "INSERT INTO attachments VALUES('old-file','old.txt','text/plain',3,1,0)",
      )
      .run();
    old
      .prepare("INSERT INTO sessions VALUES('session-hash',9999999999999)")
      .run();
    old.close();
    const db = database(dir);
    assert.equal(db.get("custom"), "keep");
    assert.equal(db.owns("old"), true);
    assert.equal(
      (db.raw.prepare("PRAGMA user_version").get() as any).user_version,
      DATABASE_VERSION,
    );
    assert.equal(
      (db.raw.prepare("SELECT COUNT(*) n FROM sessions").get() as any).n,
      1,
    );
    assert.equal(storedBytes(db), 3);
    db.raw.exec("PRAGMA user_version=99");
    db.raw.close();
    assert.throws(() => database(dir), /数据库版本较新/);
    const check = new DatabaseSync(path);
    assert.equal(
      (check.prepare("PRAGMA user_version").get() as any).user_version,
      99,
    );
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("renamed file capture uses the final path; capture overload is bounded and reported", async () => {
  const c = await setup();
  try {
    const { threadId, turnId } = await c.turn();
    writeFileSync(join(c.cwd, "renamed.txt"), "renamed output");
    c.codex.item(
      threadId,
      turnId,
      {
        id: "rename",
        type: "fileChange",
        status: "completed",
        changes: [
          {
            path: "old.txt",
            kind: { type: "update", move_path: "renamed.txt" },
          },
        ],
      },
      true,
    );
    await c.artifacts.flush();
    assert.equal(c.artifacts.list(threadId)[0].path, "renamed.txt");
    // A burst is enqueued synchronously, before any disk reads can finish.
    for (let n = 0; n < 70; n++) {
      c.codex.item(
        threadId,
        turnId,
        {
          id: `burst-${n}`,
          type: "fileChange",
          status: "completed",
          changes: [
            { path: "renamed.txt", kind: { type: "update", move_path: null } },
          ],
        },
        true,
      );
    }
    await c.artifacts.flush();
    assert.equal(
      c.artifacts.notices(threadId).filter((n) => n.reason === "capture_busy")
        .length,
      6,
    );
    assert.equal(c.artifacts.list(threadId).length, 65);
    c.codex.item(
      threadId,
      turnId,
      {
        id: "too-many",
        type: "fileChange",
        status: "completed",
        changes: Array.from({ length: 33 }, (_, n) => ({
          path: `missing-${n}.txt`,
          kind: { type: "add" },
        })),
      },
      true,
    );
    await c.artifacts.flush();
    assert.ok(
      c.artifacts.notices(threadId).some((n) => n.reason === "change_limit"),
    );
    c.codex.finish(threadId);
    assert.equal(c.codex.active.size, 0);
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});
