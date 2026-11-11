import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { htmlPreviews, PREVIEW_TTL } from "../server/html-preview.js";
import { FakeCodex } from "./fixture.js";
const origin = "http://127.0.0.1:3100";
const password = "html-preview-test-only-password";
async function setup(origins = [origin]) {
  const directory = mkdtempSync(join(tmpdir(), "newbot-html-preview-"));
  let cwd = join(directory, "workspace");
  const codex = new FakeCodex();
  const c = await createServer({
    providerRuntime: null,
    directory,
    cwd,
    codex,
    password,
    origins,
  });
  await c.app.ready();
  await c.service.settings();
  const login = await c.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password },
  });
  const cookie = login.headers["set-cookie"]!.toString().split(";")[0];
  const headers = { origin, cookie };
  const thread: any = await c.service.handle("thread/start", {
    provider: "fixture",
    model: "fixture-model",
  });
  cwd = c.workspaces.root(thread.id);
  const turn: any = await c.service.handle("turn/start", {
    threadId: thread.id,
    text: "HTML test",
  });
  writeFileSync(
    join(cwd, "page.html"),
    "<!doctype html><html><body><button>Test</button><script>window.test=1</script></body></html>",
  );
  const artifact = await c.artifacts.register(
    thread.id,
    turn.turn.id,
    "page.html",
  );
  const post = (url: string) => c.app.inject({ method: "POST", url, headers });
  return {
    ...c,
    cwd,
    directory,
    codex,
    artifact,
    headers,
    post,
    async close() {
      await c.app.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
test("HTML preview issuance requires login, trusted Origin, HTML and a distinct app authority", async () => {
  const c = await setup();
  try {
    const url = `/api/artifacts/${c.artifact.id}/preview`;
    assert.equal(
      (await c.app.inject({ method: "POST", url, headers: { origin } }))
        .statusCode,
      401,
    );
    assert.equal(
      (
        await c.app.inject({
          method: "POST",
          url,
          headers: { ...c.headers, origin: "https://evil.example" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await c.post("/api/artifacts/foreign/preview")).statusCode,
      400,
    );
    writeFileSync(join(c.cwd, "text.txt"), "text");
    const text = await c.artifacts.register(
      c.artifact.threadId,
      c.artifact.turnId,
      "text.txt",
    );
    assert.equal(
      (await c.post(`/api/artifacts/${text.id}/preview`)).statusCode,
      400,
    );
    const issued = await c.post(url);
    assert.equal(issued.statusCode, 200, issued.body);
    const grant = issued.json();
    assert.equal(new URL(grant.url).origin, "http://localhost:3100");
    assert.ok(!issued.body.includes(c.directory));
    assert.ok(!issued.body.includes(c.headers.cookie));
    assert.ok(grant.expiresAt <= Date.now() + PREVIEW_TTL);
  } finally {
    await c.close();
  }
  const unavailable = await setup([origin, "http://localhost:3100"]);
  try {
    assert.equal(
      (
        await unavailable.post(
          `/api/artifacts/${unavailable.artifact.id}/preview`,
        )
      ).statusCode,
      400,
    );
    const capability = await unavailable.app.inject({
      url: "/api/runtime/capabilities",
      headers: unavailable.headers,
    });
    assert.equal(capability.json().capabilities.artifacts.htmlExecution, false);
  } finally {
    await unavailable.close();
  }
});
test("preview shell is controlled, inner snapshot has HTTP sandbox and main-origin content stays inert", async () => {
  const c = await setup();
  try {
    const grant = (
      await c.post(`/api/artifacts/${c.artifact.id}/preview`)
    ).json();
    const appHeaders = { host: "localhost:3100" };
    const shell = await c.app.inject({
      url: `/artifact-preview/${grant.previewId}`,
      headers: appHeaders,
    });
    assert.equal(shell.statusCode, 200);
    assert.ok(!shell.body.includes("window.test=1"));
    assert.match(
      shell.headers["content-security-policy"]!,
      /sandbox allow-scripts;/,
    );
    assert.match(
      shell.headers["content-security-policy"]!,
      new RegExp(
        `frame-src http://localhost:3100/artifact-content/${grant.previewId};`,
      ),
    );
    assert.match(
      String(shell.headers["connection-allowlist"]),
      /artifact-content/,
    );
    const content = await c.app.inject({
      url: `/artifact-content/${grant.previewId}`,
      headers: appHeaders,
    });
    assert.equal(content.statusCode, 200);
    assert.ok(content.body.includes("window.test=1"));
    assert.equal(content.headers["connection-allowlist"], "()");
    assert.match(
      content.headers["content-security-policy"]!,
      /sandbox allow-scripts/,
    );
    assert.match(
      content.headers["content-security-policy"]!,
      /connect-src 'none'/,
    );
    assert.equal(content.headers["access-control-allow-origin"], undefined);
    assert.equal(content.headers["set-cookie"], undefined);
    assert.equal(content.headers["referrer-policy"], "no-referrer");
    assert.equal(content.headers["cache-control"], "no-store");
    for (const path of [
      `/artifact-preview/${grant.previewId}`,
      `/artifact-content/${grant.previewId}`,
    ]) {
      const main = await c.app.inject({
        url: path,
        headers: { host: "127.0.0.1:3100" },
      });
      assert.equal(main.statusCode, 403);
    }
    assert.equal(
      (
        await c.app.inject({
          url: "/artifact-preview/missing/extra",
          headers: appHeaders,
        })
      ).statusCode,
      404,
    );
    const inert = await c.app.inject({
      url: c.artifact.contentUrl,
      headers: c.headers,
    });
    assert.match(inert.headers["content-type"]!, /^text\/plain/);
    for (const path of [
      "/api/config",
      "/api/session",
      "/",
      "/assets/not-a-file.js",
    ]) {
      const forbidden = await c.app.inject({
        url: path,
        headers: { ...c.headers, ...appHeaders },
      });
      assert.equal(forbidden.statusCode, 403, path);
    }
  } finally {
    await c.close();
  }
});
test("closing a preview revokes only its owner's grant; logout and missing runtime state invalidate capabilities", async () => {
  const c = await setup();
  try {
    const route = `/api/artifacts/${c.artifact.id}/preview`;
    const grant = (await c.post(route)).json();
    const another = await c.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password },
    });
    const otherCookie = another.headers["set-cookie"]!.toString().split(";")[0];
    const denied = await c.app.inject({
      method: "DELETE",
      url: `${route}/${grant.previewId}`,
      headers: { origin, cookie: otherCookie },
    });
    assert.equal(denied.statusCode, 400);
    assert.equal(
      (
        await c.app.inject({
          method: "DELETE",
          url: `${route}/${grant.previewId}`,
          headers: c.headers,
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (
        await c.app.inject({
          url: `/artifact-preview/${grant.previewId}`,
          headers: { host: "localhost:3100" },
        })
      ).statusCode,
      410,
    );
    const next = (await c.post(route)).json();
    c.previews.clear();
    assert.equal(
      (
        await c.app.inject({
          url: `/artifact-content/${next.previewId}`,
          headers: { host: "localhost:3100" },
        })
      ).statusCode,
      410,
    );
    const last = (await c.post(route)).json();
    await c.post("/api/logout");
    assert.equal(
      (
        await c.app.inject({
          url: `/artifact-content/${last.previewId}`,
          headers: { host: "localhost:3100" },
        })
      ).statusCode,
      410,
    );
  } finally {
    await c.close();
  }
});
test("grant expiry and per-session capacity are bounded; corrupted snapshots never reach the executable endpoint", async () => {
  const c = await setup();
  try {
    let clock = Date.now();
    const registry = htmlPreviews(c.db, c.artifacts, () => clock);
    const session = c.headers.cookie.slice("ma_session=".length);
    const issue = () =>
      registry.issue(c.artifact.id, session, "http://localhost:3100", origin);
    const grants = [];
    for (let i = 0; i < 8; i++) grants.push(await issue());
    await assert.rejects(issue, /窗口过多/);
    clock += PREVIEW_TTL;
    assert.equal(
      registry.find(grants[0].previewId, "localhost:3100"),
      undefined,
    );
    assert.ok((await issue()).previewId);
    const grant = (
      await c.post(`/api/artifacts/${c.artifact.id}/preview`)
    ).json();
    writeFileSync(join(c.directory, "artifacts", c.artifact.sha256), "corrupt");
    const content = await c.app.inject({
      url: `/artifact-content/${grant.previewId}`,
      headers: { host: "localhost:3100" },
    });
    assert.equal(content.statusCode, 410);
    assert.ok(!content.body.includes("corrupt"));
  } finally {
    await c.close();
  }
});
