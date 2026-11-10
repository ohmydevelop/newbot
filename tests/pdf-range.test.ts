import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { byteRange } from "../server/pdf.js";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
const origin = "http://127.0.0.1:3100";
test("single byte ranges handle inclusive bounds, suffixes, huge integers and invalid input without overflow", () => {
  assert.deepEqual(byteRange("bytes=0-2", 10), { start: 0, end: 2 });
  assert.deepEqual(byteRange("bytes=7-", 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(byteRange("bytes=2-99999999999999999999999", 10), {
    start: 2,
    end: 9,
  });
  assert.deepEqual(byteRange("bytes=-99999999999999999999", 10), {
    start: 0,
    end: 9,
  });
  for (const header of [
    "bytes=-0",
    "bytes=10-",
    "bytes=4-3",
    "bytes=",
    "bytes=1.5-2",
    "bytes=0-1,3-5",
    "items=0-2",
    "bytes=" + "9".repeat(150) + "-",
  ])
    assert.equal(byteRange(header, 10), null, header);
  assert.equal(byteRange("bytes=0-", 0), null);
});
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), "newbot-pdf-range-")),
    cwd = join(directory, "workspace");
  const c = await createServer({
    providerRuntime: null,
    directory,
    cwd,
    password: "pdf-test-password-long",
    codex: new FakeCodex(),
    origins: [origin],
  });
  await c.app.ready();
  await c.service.settings();
  const login = await c.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password: "pdf-test-password-long" },
  });
  const headers = {
    origin,
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
  };
  const thread: any = await c.service.handle("thread/start", {
    provider: "fixture",
    model: "fixture-model",
  });
  const turn: any = await c.service.handle("turn/start", {
    threadId: thread.id,
    text: "PDF ranges",
  });
  // Transport tests need byte-identical data, not a valid rendered PDF.
  const data = Buffer.from("%PDF-1.7\ncontrolled byte range fixture\n%%EOF");
  writeFileSync(join(cwd, "file.pdf"), data);
  const artifact = await c.artifacts.register(
    thread.id,
    turn.turn.id,
    "file.pdf",
  );
  return {
    ...c,
    directory,
    cwd,
    headers,
    data,
    artifact,
    url: `/api/artifacts/${artifact.id}/pdf`,
  };
}
test("PDF data endpoint requires authentication and PDF kind, keeps binary download inert and exposes correct HEAD metadata", async () => {
  const c = await setup();
  try {
    assert.equal(
      (await c.app.inject({ url: c.url, headers: { range: "bytes=0-4" } }))
        .statusCode,
      401,
    );
    const full = await c.app.inject({ url: c.url, headers: c.headers });
    assert.equal(full.statusCode, 200);
    assert.deepEqual(full.rawPayload, c.data);
    assert.equal(full.headers["accept-ranges"], "bytes");
    assert.equal(full.headers.etag, `"${c.artifact.sha256}"`);
    assert.equal(full.headers["cache-control"], "private, no-store");
    assert.match(full.headers["content-disposition"]!, /^attachment/);
    assert.match(full.headers["content-type"]!, /^application\/octet-stream/);
    assert.equal(full.headers["x-content-type-options"], "nosniff");
    const head = await c.app.inject({
      method: "HEAD",
      url: c.url,
      headers: { ...c.headers, range: "bytes=0-4" },
    });
    assert.equal(head.statusCode, 200);
    assert.equal(head.body, "");
    assert.equal(Number(head.headers["content-length"]), c.data.length);
    writeFileSync(join(c.cwd, "text.txt"), "not pdf");
    const text = await c.artifacts.register(
      c.artifact.threadId,
      c.artifact.turnId,
      "text.txt",
    );
    assert.equal(
      (
        await c.app.inject({
          url: `/api/artifacts/${text.id}/pdf`,
          headers: c.headers,
        })
      ).statusCode,
      400,
    );
    assert.equal(
      (
        await c.app.inject({
          url: c.url,
          headers: { ...c.headers, host: "localhost:3100" },
        })
      ).statusCode,
      403,
    );
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});
test("206 responses are exact original slices; 416 covers unsatisfiable ranges and If-Range protects validators", async () => {
  const c = await setup();
  try {
    for (const [range, start, end] of [
      ["bytes=0-4", 0, 4],
      ["bytes=5-", 5, c.data.length - 1],
      ["bytes=-5", c.data.length - 5, c.data.length - 1],
      ["bytes=1-99999999999999", 1, c.data.length - 1],
    ] as const) {
      const r = await c.app.inject({
        url: c.url,
        headers: { ...c.headers, range, "if-range": `"${c.artifact.sha256}"` },
      });
      assert.equal(r.statusCode, 206, r.body);
      assert.deepEqual(r.rawPayload, c.data.subarray(start, end + 1));
      assert.equal(
        r.headers["content-range"],
        `bytes ${start}-${end}/${c.data.length}`,
      );
      assert.equal(Number(r.headers["content-length"]), end - start + 1);
    }
    for (const range of [
      `bytes=${c.data.length}-`,
      "bytes=-0",
      "bytes=10-1",
      "bytes=abc-def",
    ]) {
      const r = await c.app.inject({
        url: c.url,
        headers: { ...c.headers, range },
      });
      assert.equal(r.statusCode, 416, r.body);
      assert.equal(r.headers["content-range"], `bytes */${c.data.length}`);
      assert.match(r.json().error, /范围无效/);
    }
    for (const headers of [
      { range: "items=0-4" },
      { range: "bytes=0-4,10-14" },
      { range: "bytes=0-4", "if-range": '"other"' },
      { range: "bytes=0-4", "if-range": `W/"${c.artifact.sha256}"` },
    ])
      assert.equal(
        (
          await c.app.inject({
            url: c.url,
            headers: { ...c.headers, ...headers },
          })
        ).statusCode,
        200,
      );
    const parts = [];
    for (let start = 0; start < c.data.length; start += 7) {
      const end = Math.min(start + 6, c.data.length - 1);
      parts.push(
        (
          await c.app.inject({
            url: c.url,
            headers: { ...c.headers, range: `bytes=${start}-${end}` },
          })
        ).rawPayload,
      );
    }
    assert.deepEqual(Buffer.concat(parts), c.data);
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});
test("range requests still verify the full immutable snapshot and cannot hide corruption outside the requested bytes", async () => {
  const c = await setup();
  try {
    const changed = Buffer.from(c.data);
    changed[changed.length - 1] ^= 1;
    writeFileSync(join(c.directory, "artifacts", c.artifact.sha256), changed);
    const corrupt = await c.app.inject({
      url: c.url,
      headers: { ...c.headers, range: "bytes=0-4" },
    });
    assert.equal(corrupt.statusCode, 410);
    unlinkSync(join(c.directory, "artifacts", c.artifact.sha256));
    assert.equal(
      (await c.app.inject({ url: c.url, headers: c.headers })).statusCode,
      410,
    );
    assert.equal(c.artifacts.get(c.artifact.id).id, c.artifact.id);
  } finally {
    await c.app.close();
    rmSync(c.directory, { recursive: true, force: true });
  }
});
