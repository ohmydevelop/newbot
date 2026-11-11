import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  utimesSync,
  existsSync,
  linkSync,
  symlinkSync,
  unlinkSync,
  renameSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { fileStore } from "../server/files.js";
import { STORAGE_LIMIT, RETENTION_MS, storedBytes } from "../server/storage.js";
const origin = "http://127.0.0.1:3100";
const password = "lifecycle-test-only-password";
const digest = (data: string) =>
  createHash("sha256").update(data).digest("hex");
async function setup(
  directory = mkdtempSync(join(tmpdir(), "newbot-lifecycle-")),
  codex = new FakeCodex(),
) {
  const cwd = join(directory, "workspace");
  const c = await createServer({
    providerRuntime: null,
    directory,
    cwd,
    codex,
    password,
    origins: [origin],
  });
  await c.app.ready();
  await c.service.settings();
  const login = await c.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password },
  });
  const headers = {
    origin,
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
  };
  const get = (url: string) => c.app.inject({ url, headers });
  const post = (url: string, payload?: any) =>
    c.app.inject({ method: "POST", url, headers, payload });
  const thread: any = await c.service.handle("thread/start", {
    provider: "fixture",
    model: "fixture-model",
  });
  const turn: any = await c.service.handle("turn/start", {
    threadId: thread.id,
    text: "lifecycle",
  });
  return {
    ...c,
    directory,
    cwd: c.workspaces.root(thread.id),
    codex,
    headers,
    get,
    post,
    threadId: thread.id as string,
    turnId: turn.turn.id as string,
  };
}
test("version pages are thread/path scoped, bounded and do not change the saved message version", async () => {
  const c = await setup();
  try {
    const records = [];
    for (let n = 1; n <= 53; n++) {
      writeFileSync(join(c.cwd, "file.txt"), `v${n}`);
      records.push(
        await c.artifacts.register(c.threadId, c.turnId, "file.txt"),
      );
    }
    const first = records[0];
    const response = await c.get(`/api/artifacts/${first.id}/versions`);
    assert.equal(response.statusCode, 200);
    const page = response.json();
    assert.equal(page.versions.length, 50);
    assert.equal(page.versions[0].version, 53);
    assert.equal(page.nextBefore, 4);
    const next = (
      await c.get(
        `/api/artifacts/${first.id}/versions?before=${page.nextBefore}`,
      )
    ).json();
    assert.deepEqual(
      next.versions.map((a: any) => a.version),
      [3, 2, 1],
    );
    assert.equal(next.nextBefore, null);
    assert.equal((await c.get(first.contentUrl)).body, "v1");
    const other: any = await c.service.handle("thread/start", {
      provider: "fixture",
      model: "fixture-model",
    });
    const t: any = await c.service.handle("turn/start", {
      threadId: other.id,
      text: "another",
    });
    writeFileSync(join(c.workspaces.root(other.id), "file.txt"), "other");
    await c.artifacts.register(other.id, t.turn.id, "file.txt");
    assert.equal(
      (await c.get(`/api/artifacts/${first.id}/versions`)).json().latestVersion,
      53,
    );
    assert.equal(
      (await c.get("/api/artifacts/foreign/versions")).statusCode,
      400,
    );
    assert.equal(
      (await c.app.inject({ url: `/api/artifacts/${first.id}/versions` }))
        .statusCode,
      401,
    );
    assert.equal(
      (await c.get(`/api/artifacts/${first.id}/versions?before=-1`)).statusCode,
      400,
    );
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});
test("cleanup reclaims only old unreferenced snapshots and expired new uploads; archives, links and legacy files survive", async () => {
  const c = await setup();
  try {
    writeFileSync(join(c.cwd, "keep.txt"), "archived content");
    const keep = await c.artifacts.register(c.threadId, c.turnId, "keep.txt");
    c.codex.finish(c.threadId);
    await c.service.handle("thread/archive", { threadId: c.threadId });
    const old = new Date(Date.now() - RETENTION_MS - 60_000);
    const snapshots = join(c.directory, "artifacts");
    utimesSync(join(snapshots, keep.sha256), old, old);
    const orphan = digest("old orphan"),
      fresh = digest("fresh orphan");
    writeFileSync(join(snapshots, orphan), "old orphan");
    utimesSync(join(snapshots, orphan), old, old);
    writeFileSync(join(snapshots, fresh), "fresh orphan");
    const outside = join(c.directory, "outside.txt");
    writeFileSync(outside, "outside");
    const hard = digest("hard"),
      soft = digest("soft");
    linkSync(outside, join(snapshots, hard));
    symlinkSync(outside, join(snapshots, soft));
    utimesSync(join(snapshots, hard), old, old);
    const files = fileStore(c.directory, c.db);
    const unused = files.save("expired.txt", Buffer.from("unused"));
    const attached = files.save("attached.txt", Buffer.from("attached"));
    c.db.raw
      .prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?)")
      .run(
        "attachment-run",
        "x",
        "accepted",
        c.threadId,
        c.turnId,
        randomUUID(),
        1,
        1,
      );
    files.bind("attachment-run", [attached.id]);
    c.db.raw.prepare("UPDATE attachments SET created=1").run();
    writeFileSync(join(c.directory, "uploads", "legacy-unknown"), "legacy");
    const before = (await c.get("/api/storage")).json();
    assert.ok(before.reclaimableBytes >= 16);
    assert.ok(before.legacyUploadBytes > 0);
    assert.equal((await c.app.inject({ url: "/api/storage" })).statusCode, 401);
    assert.equal(
      (
        await c.app.inject({
          method: "POST",
          url: "/api/storage/cleanup",
          headers: { ...c.headers, origin: "https://evil.test" },
        })
      ).statusCode,
      403,
    );
    const result = (await c.post("/api/storage/cleanup")).json();
    assert.equal(result.failedFiles, 0);
    assert.equal(result.removedFiles, 2);
    assert.equal(result.releasedBytes, 16);
    assert.equal(existsSync(join(snapshots, orphan)), false);
    assert.equal(existsSync(join(c.directory, "uploads", unused.id)), false);
    for (const name of [keep.sha256, fresh, hard, soft])
      assert.equal(existsSync(join(snapshots, name)), true, name);
    assert.equal(existsSync(join(c.directory, "uploads", attached.id)), true);
    assert.equal(
      existsSync(join(c.directory, "uploads", "legacy-unknown")),
      true,
    );
    assert.equal((await c.get(keep.contentUrl)).body, "archived content");
    assert.equal(c.db.list().length, 0);
    assert.equal(c.artifacts.list(c.threadId).length, 1);
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});
test("orphan reservation shares quota with uploads and adoption does not charge the same blob twice", async () => {
  const c = await setup();
  try {
    const sha = digest("adopt");
    writeFileSync(join(c.directory, "artifacts", sha), "adopt");
    writeFileSync(join(c.cwd, "adopt.txt"), "adopt");
    const usage = (await c.get("/api/storage")).json();
    assert.equal(usage.untrackedBytes, 5);
    c.db.raw
      .prepare(
        "INSERT INTO attachments VALUES('quota','quota.txt','text/plain',?,0,1)",
      )
      .run(STORAGE_LIMIT - 5);
    assert.equal(storedBytes(c.db), STORAGE_LIMIT);
    assert.throws(
      () => fileStore(c.directory, c.db).save("new.txt", Buffer.from("x")),
      /512 MiB/,
    );
    const adopted = await c.artifacts.register(
      c.threadId,
      c.turnId,
      "adopt.txt",
    );
    assert.equal(adopted.sha256, sha);
    assert.equal(storedBytes(c.db), STORAGE_LIMIT);
    assert.equal((await c.get("/api/storage")).json().untrackedBytes, 0);
    writeFileSync(join(c.cwd, "new.txt"), "different");
    await assert.rejects(
      c.artifacts.register(c.threadId, c.turnId, "new.txt"),
      /512 MiB/,
    );
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});
test("capture and cleanup are serialized so newly registered snapshots cannot be removed", async () => {
  const c = await setup();
  try {
    const tasks = [];
    for (let n = 0; n < 12; n++) {
      const path = `queued-${n}.txt`;
      writeFileSync(join(c.cwd, path), `file ${n}`);
      tasks.push(c.artifacts.register(c.threadId, c.turnId, path));
    }
    const cleanup = c.artifacts.maintenance(true, () =>
      fileStore(c.directory, c.db).cleanup(),
    );
    const records = await Promise.all(tasks);
    await cleanup;
    for (let n = 0; n < records.length; n++)
      assert.equal(
        (await c.artifacts.read(records[n].id)).data.toString(),
        `file ${n}`,
      );
    assert.equal((await c.get("/api/storage")).json().versions, 12);
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});
test("reconnect and restart preserve artifact identity and version history, while old HTML grants expire", async () => {
  const c = await setup();
  let reopened: Awaited<ReturnType<typeof setup>> | undefined;
  try {
    writeFileSync(join(c.cwd, "page.html"), "<h1>version one</h1>");
    const one = await c.artifacts.register(c.threadId, c.turnId, "page.html");
    writeFileSync(join(c.cwd, "page.html"), "<h1>version two</h1>");
    const two = await c.artifacts.register(c.threadId, c.turnId, "page.html");
    c.codex.finish(c.threadId);
    await c.get(`/api/threads/${c.threadId}`);
    const replay = (
      await c.get(`/api/agent/events?transport=poll&threadId=${c.threadId}`)
    ).body;
    assert.ok(replay.includes(one.id) && replay.includes(two.id));
    const grant = (await c.post(`/api/artifacts/${one.id}/preview`)).json();
    const native = new FakeCodex();
    native.threads = c.codex.threads;
    await c.app.close();
    reopened = await setup(c.directory, native);
    assert.equal(
      (await reopened.get(one.contentUrl)).body,
      "<h1>version one</h1>",
    );
    assert.equal(
      (await reopened.get(`/api/artifacts/${one.id}/versions`)).json()
        .versions[0].id,
      two.id,
    );
    const history = (await reopened.get(`/api/threads/${c.threadId}`)).json();
    assert.equal(history.turns[0].artifacts.length, 2);
    assert.equal(
      (
        await reopened.app.inject({
          url: `/artifact-content/${grant.previewId}`,
          headers: { host: "localhost:3100" },
        })
      ).statusCode,
      410,
    );
    assert.equal(
      (await reopened.post(`/api/artifacts/${one.id}/preview`)).statusCode,
      200,
    );
  } finally {
    if (reopened) await reopened.app.close();
    else await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});
test("missing or corrupt snapshots report recoverable failure without rewriting old history", async () => {
  const c = await setup();
  try {
    writeFileSync(join(c.cwd, "old.txt"), "saved");
    const a = await c.artifacts.register(c.threadId, c.turnId, "old.txt");
    unlinkSync(join(c.directory, "artifacts", a.sha256));
    writeFileSync(join(c.cwd, "old.txt"), "replacement is not the snapshot");
    const missing = await c.get(a.contentUrl);
    assert.equal(missing.statusCode, 410);
    assert.match(missing.json().error, /快照缺失/);
    assert.equal(c.artifacts.list(c.threadId)[0].id, a.id);
    writeFileSync(join(c.directory, "artifacts", a.sha256), "saved");
    assert.equal((await c.get(a.contentUrl)).body, "saved");
    writeFileSync(join(c.directory, "artifacts", a.sha256), "wrong");
    assert.equal((await c.get(a.contentUrl)).statusCode, 410);
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});

test("a partial unreferenced blob from an interrupted write is recreated without changing any referenced version", async () => {
  const c = await setup();
  try {
    const sha = digest("complete");
    writeFileSync(join(c.directory, "artifacts", sha), "part");
    writeFileSync(join(c.cwd, "recovered.txt"), "complete");
    await c.get("/api/storage");
    const artifact = await c.artifacts.register(
      c.threadId,
      c.turnId,
      "recovered.txt",
    );
    assert.equal((await c.get(artifact.contentUrl)).body, "complete");
    assert.equal((await c.get("/api/storage")).json().untrackedBytes, 0);
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});

test("cleanup refuses a replaced storage-directory symlink and leaves the external files intact", async () => {
  const c = await setup();
  const folder = join(c.directory, "artifacts"),
    original = join(c.directory, "original-artifacts"),
    outside = join(c.directory, "external");
  try {
    mkdirSync(outside);
    const name = digest("do not delete");
    writeFileSync(join(outside, name), "do not delete");
    const old = new Date(Date.now() - 2 * RETENTION_MS);
    utimesSync(join(outside, name), old, old);
    renameSync(folder, original);
    symlinkSync(outside, folder);
    await assert.rejects(c.artifacts.maintenance(true), /链接目录/);
    assert.equal(existsSync(join(outside, name)), true);
    unlinkSync(folder);
    renameSync(original, folder);
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});
