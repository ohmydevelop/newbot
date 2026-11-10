import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { ProviderCodex } from "./provider-fixture.js";
import { hash } from "../server/db.js";
import { randomUUID } from "node:crypto";
import { credentialBroker } from "../server/credentials.js";
import {
  credentialFixture,
  credentialTestSecret,
} from "./credential-fixture.js";
import { providerCredentialConsumer } from "../server/credential-provider.js";
import type { CredentialCreate } from "../shared/credentials.js";
const input = (): Extract<
  CredentialCreate,
  { operation: "provider.models.test" }
> => ({
  requestId: randomUUID(),
  operation: "provider.models.test",
  providerId: "test",
  expectedRevision: "cfg1." + "0".repeat(64),
});
function broker(options: Partial<Parameters<typeof credentialBroker>[0]> = {}) {
  return credentialBroker({
    prepare: async () => ({
      receiver: "https://example.com/v1/models",
      run: async () => ({ state: "succeeded" }),
    }),
    validOwner: (owner) => owner === "owner",
    audit: () => {},
    ...options,
  });
}
test("private request create is idempotent, scope-bound and has no public secret retrieval", async () => {
  let prepares = 0;
  const b = broker({
    prepare: async () => {
      prepares++;
      return {
        receiver: "https://example.com/v1/models",
        run: async () => ({ state: "succeeded" }),
      };
    },
  });
  try {
    const p = input();
    const values = await Promise.all([
      b.create("owner", p),
      b.create("owner", p),
    ]);
    assert.equal(prepares, 1);
    assert.equal(values[0].id, values[1].id);
    await assert.rejects(() =>
      b.create("owner", { ...p, providerId: "other" }),
    );
    assert.throws(() => b.read(p.requestId, "other"), /不属于/);
    const bytes = Buffer.from("private");
    await assert.rejects(() => b.fulfill(p.requestId, "other", bytes));
    assert.ok(bytes.every((v) => v === 0));
    assert.equal("take" in b, false);
    assert.equal("getSecret" in b, false);
  } finally {
    b.close();
  }
});
test("only the registered consumer runs once, and every passed secret buffer is cleared", async () => {
  let calls = 0;
  const b = broker({
    prepare: async () => ({
      receiver: "https://example.com/v1/models",
      run: async (secret) => {
        calls++;
        assert.equal(secret.toString(), "test-key");
        return { state: "succeeded" };
      },
    }),
  });
  try {
    const t = await b.create("owner", input());
    const first = Buffer.from("test-key"),
      second = Buffer.from("test-key");
    const outcomes = await Promise.allSettled([
      b.fulfill(t.id, "owner", first),
      b.fulfill(t.id, "owner", second),
    ]);
    assert.equal(outcomes.filter((v) => v.status === "fulfilled").length, 1);
    assert.equal(calls, 1);
    assert.ok(first.every((v) => !v));
    assert.ok(second.every((v) => !v));
    assert.equal(b.pending, 0);
    assert.ok(!JSON.stringify(b.read(t.id, "owner")).includes("test-key"));
  } finally {
    b.close();
  }
});
test("cancel during consumer wait erases the buffer immediately and ignores late completion", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const b = broker({
    prepare: async () => ({
      receiver: "https://example.com/v1/models",
      run: async (_secret, _signal, authorized) => {
        await gate;
        assert.equal(authorized(), false);
        return { state: "succeeded" };
      },
    }),
  });
  try {
    const t = await b.create("owner", input());
    const secret = Buffer.from("private");
    const result = b.fulfill(t.id, "owner", secret);
    b.cancel(t.id, "owner");
    assert.ok(secret.every((v) => !v));
    release();
    assert.equal((await result).state, "cancelled");
    await assert.rejects(() => b.fulfill(t.id, "owner", Buffer.from("again")));
  } finally {
    release();
    b.close();
  }
});
test("expiry, owner revocation and shutdown cannot revive an old input ticket", async (t) => {
  const b = broker({ ttlMs: 1000 });
  try {
    t.mock.timers.enable({ apis: ["Date", "setInterval"] });
    const v = await b.create("owner", input());
    t.mock.timers.tick(1001);
    assert.equal(b.read(v.id, "owner").state, "expired");
    await assert.rejects(() => b.fulfill(v.id, "owner", Buffer.from("key")));
    const next = await b.create("owner", input());
    b.revoke("owner");
    assert.equal(b.read(next.id, "owner").state, "invalidated");
    b.close();
    await assert.rejects(() => b.create("owner", input()), /已关闭/);
    await assert.rejects(
      () => b.fulfill(next.id, "owner", Buffer.from("private")),
      /已关闭/,
    );
  } finally {
    t.mock.timers.reset();
    b.close();
  }
});
test("malformed credential bytes do not execute and request limits stay bounded", async () => {
  const b = broker({ maxRecords: 2 });
  try {
    const t = await b.create("owner", input());
    const invalid = Buffer.from("bad\r\nAuthorization:other");
    await assert.rejects(() => b.fulfill(t.id, "owner", invalid));
    assert.ok(invalid.every((v) => !v));
    assert.equal(b.read(t.id, "owner").state, "waiting");
    await b.create("owner", input());
    await assert.rejects(() => b.create("owner", input()), /已满/);
  } finally {
    b.close();
  }
});
test("a real TLS provider consumer receives only the one-time key and never returns reflected content", async () => {
  const c = await credentialFixture();
  try {
    const t = await c.request();
    assert.equal(t.receiver, new URL(c.endpoint).origin);
    const response = await c.input(t.id);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().state, "succeeded");
    assert.deepEqual(c.calls, [
      {
        correct: true,
        method: "GET",
        path: "/v1/models",
        cookie: false,
        extraHeaders: false,
      },
    ]);
    const calls = JSON.stringify(c.codex.calls),
      audit = JSON.stringify(c.db.raw.prepare("SELECT * FROM audit").all());
    const feed = JSON.stringify(c.service.events.threads);
    for (const value of [response.body, calls, audit, feed])
      assert.ok(!value.includes(credentialTestSecret));
    assert.equal((await c.input(t.id)).statusCode, 409);
    assert.equal(c.calls.length, 1);
    for (const table of [
      "metadata",
      "audit",
      "runs",
      "a2ui_views",
      "a2ui_drafts",
    ])
      assert.ok(
        !JSON.stringify(
          c.db.raw.prepare(`SELECT * FROM ${table}`).all(),
        ).includes(credentialTestSecret),
      );
  } finally {
    await c.close();
  }
});
test("private inputs require login, exact Origin, owning session and a strict server operation", async () => {
  const c = await credentialFixture();
  try {
    const p = c.body();
    const post = (payload: object, headers = c.headers) =>
      c.app.inject({
        method: "POST",
        url: "/api/credentials/requests",
        headers,
        payload,
      });
    assert.equal(
      (await post(p, { origin: c.origin, cookie: "" })).statusCode,
      401,
    );
    assert.equal(
      (await post(p, { ...c.headers, origin: "https://app.invalid" }))
        .statusCode,
      403,
    );
    for (const extra of [
      { url: "https://evil.invalid" },
      { headers: { Authorization: "no" } },
      { command: "sudo" },
      { operation: "tool/arbitrary" },
    ])
      assert.equal((await post({ ...p, ...extra })).statusCode, 400);
    const t = await c.request();
    const login = await c.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: c.origin },
      payload: { password: "private-fixture-password" },
    });
    const other = {
      ...c.headers,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    assert.equal(
      (await c.input(t.id, credentialTestSecret, other)).statusCode,
      403,
    );
    const json = await c.app.inject({
      method: "POST",
      url: `/api/credentials/${t.id}/input`,
      headers: c.headers,
      payload: { secret: credentialTestSecret },
    });
    assert.equal(json.statusCode, 400);
    assert.equal(c.calls.length, 0);
  } finally {
    await c.close();
  }
});
test("changed Provider config rejects the ticket before credential dispatch and maintenance waits for private input", async () => {
  const c = await credentialFixture();
  try {
    const t = await c.request();
    await assert.rejects(() =>
      c.service.handle("bridge/maintenance", { enabled: true }),
    );
    c.codex.config.model_providers.secondary.base_url =
      "https://wrong.invalid/v1";
    c.codex.version++;
    const response = await c.input(t.id);
    assert.equal(response.json().reason, "configuration_changed");
    assert.equal(c.calls.length, 0);
    assert.equal(c.credentials.pending, 0);
  } finally {
    await c.close();
  }
});
test("redirects, rejected authorization and upstream errors return only fixed status without following or retrying", async () => {
  const c = await credentialFixture();
  try {
    for (const [mode, reason] of [
      ["redirect", "redirect"],
      ["reject", "rejected"],
      ["error", "unavailable"],
    ] as const) {
      c.mode(mode);
      const t = await c.request();
      const r = await c.input(t.id);
      assert.equal(r.json().reason, reason);
      assert.ok(!r.body.includes(credentialTestSecret));
    }
    assert.equal(c.calls.length, 3);
  } finally {
    await c.close();
  }
});
test("logout revokes outstanding private tickets and cancels in-flight upstream requests", async () => {
  const c = await credentialFixture();
  try {
    c.mode("hang");
    const t = await c.request();
    const operation = c.input(t.id);
    // Start Fastify inject without waiting for its response.
    const pending = Promise.resolve(operation);
    for (let i = 0; i < 100 && !c.calls.length; i++)
      await new Promise((r) => setTimeout(r, 5));
    assert.equal(c.calls.length, 1);
    await c.app.inject({
      method: "POST",
      url: "/api/logout",
      headers: c.headers,
      payload: {},
    });
    assert.equal((await pending).json().state, "invalidated");
    assert.equal(c.credentials.pending, 0);
  } finally {
    await c.close();
  }
});
test("non-TLS Provider endpoints are refused before any secret input and consumer refuses unsafe targets", async () => {
  const c = await credentialFixture();
  try {
    c.codex.config.model_providers.secondary.base_url = "http://127.0.0.1/v1";
    const settings = await c.service.settings();
    const r = await c.app.inject({
      method: "POST",
      url: "/api/credentials/requests",
      headers: c.headers,
      payload: {
        ...c.body(),
        expectedRevision: settings.configuration!.revision,
      },
    });
    assert.equal(r.json().state, "failed");
    assert.equal(c.calls.length, 0);
    for (const target of [
      "http://example.com/models",
      "https://user:password@example.com/models",
      "https://example.com/models?token=key",
    ])
      assert.throws(() => providerCredentialConsumer(target, async () => {}));
  } finally {
    await c.close();
  }
});

test("Bridge restart drops private requests while preserving login and refuses the old input", async () => {
  const c = await credentialFixture();
  let next: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    const t = await c.request();
    await c.app.close();
    next = await createServer({
    providerRuntime: null,
      directory: c.directory,
      cwd: join(c.directory, "workspace"),
      codex: new ProviderCodex(c.endpoint),
      password: "private-fixture-password",
      origins: [c.origin],
      credentialCa: c.cert,
    });
    await next.app.ready();
    assert.equal(
      (
        await next.app.inject({ url: "/api/session", headers: c.headers })
      ).json().authenticated,
      true,
    );
    assert.equal(
      (
        await next.app.inject({
          url: `/api/credentials/${t.id}`,
          headers: c.headers,
        })
      ).statusCode,
      404,
    );
    assert.equal(
      (
        await next.app.inject({
          method: "POST",
          url: `/api/credentials/${t.id}/input`,
          headers: { ...c.headers, "content-type": "application/octet-stream" },
          payload: credentialTestSecret,
        })
      ).statusCode,
      404,
    );
    assert.equal(c.calls.length, 0);
    assert.equal(next.credentials.pending, 0);
  } finally {
    await next?.app.close();
    await c.close();
  }
});
test("expired login invalidates the operation without dispatch and shared HTTP origins cannot input secrets", async () => {
  const c = await credentialFixture("http://private.example");
  try {
    const response = await c.app.inject({
      method: "POST",
      url: "/api/credentials/requests",
      headers: c.headers,
      payload: c.body(),
    });
    assert.equal(response.statusCode, 403);
    assert.equal(c.calls.length, 0);
  } finally {
    await c.close();
  }
  const local = await credentialFixture();
  try {
    const t = await local.request(),
      token = local.headers.cookie.split("=")[1];
    local.db.raw
      .prepare("UPDATE sessions SET expires=0 WHERE token=?")
      .run(hash(token));
    assert.equal(local.credentials.pending, 0);
    assert.equal((await local.input(t.id)).statusCode, 401);
    assert.equal(local.calls.length, 0);
  } finally {
    await local.close();
  }
});
test("untrusted model and App control methods cannot invoke private credential consumers", async () => {
  const c = await credentialFixture();
  try {
    await assert.rejects(() =>
      c.service.handle("credentials/input", { secret: credentialTestSecret }),
    );
    const response = await c.app.inject({
      method: "POST",
      url: "/api/mcp-apps/credentials",
      headers: c.headers,
      payload: {
        operation: "provider.models.test",
        secret: credentialTestSecret,
      },
    });
    assert.notEqual(response.statusCode, 200);
    assert.equal(c.calls.length, 0);
    assert.ok(!response.body.includes(credentialTestSecret));
  } finally {
    await c.close();
  }
});

test("private input metadata never exposes a configured provider path that may contain an old secret", async () => {
  const c = await credentialFixture();
  try {
    c.codex.config.model_providers.secondary.base_url =
      c.endpoint + "/legacy-private-path";
    const settings = await c.service.settings();
    const response = await c.app.inject({
      method: "POST",
      url: "/api/credentials/requests",
      headers: c.headers,
      payload: {
        ...c.body(),
        expectedRevision: settings.configuration!.revision,
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().receiver, new URL(c.endpoint).origin);
    assert.ok(!response.body.includes("legacy-private-path"));
    assert.ok(!JSON.stringify(settings).includes("legacy-private-path"));
  } finally {
    await c.close();
  }
});

test("committed private writes are not revoked by the planned native restart and never reacquire input", async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const b = broker({
    prepare: async () => ({
      receiver: "https://example.com",
      run: async (secret, signal, _authorized, commit) => {
        commit();
        assert.ok(secret.every((v) => !v));
        await gate;
        assert.equal(signal.aborted, false);
        return { state: "succeeded", applied: true };
      },
    }),
  });
  try {
    const t = await b.create("owner", input()),
      secret = Buffer.from("synthetic-key");
    const pending = b.fulfill(t.id, "owner", secret);
    assert.equal(b.cancel(t.id, "owner").committed, true);
    b.revoke();
    assert.equal(b.read(t.id, "owner").state, "checking");
    release();
    assert.equal((await pending).applied, true);
    assert.equal(b.pending, 0);
  } finally {
    release();
    b.close();
  }
});
