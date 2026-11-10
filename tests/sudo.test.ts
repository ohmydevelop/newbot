import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { credentialBroker } from "../server/credentials.js";
import { credentialCreate } from "../shared/credentials.js";
import { sudoIdentity } from "../server/credential-sudo.js";
import { sudoTestSecret, testSudo } from "./sudo-fixture.js";
import { createServer } from "../server/index.js";
import { ProviderCodex } from "./provider-fixture.js";
function harness(
  mode = "success",
  options: Parameters<typeof testSudo>[0] = {},
) {
  const sudo = testSudo({ mode, ...options });
  const broker = credentialBroker({
    validOwner: (owner) => owner === "owner",
    audit: () => {},
    prepare: (input) => {
      assert.equal(input.operation, "sudo.identity");
      if (input.operation !== "sudo.identity") throw new Error();
      return sudo.prepare(
        input.expectedPolicy,
        async () => {},
        (run) => run(),
      );
    },
  });
  const body = () => ({
    requestId: randomUUID(),
    operation: "sudo.identity" as const,
    expectedPolicy: sudo.capability().policy!,
  });
  return { sudo, broker, body };
}
test("sudo is explicitly enabled and exposes only the fixed identity operation", () => {
  assert.equal(sudoIdentity().capability().available, false);
  assert.equal(
    sudoIdentity({ enabled: true, inspect: () => null }).capability().available,
    false,
  );
  assert.equal(
    sudoIdentity({
      enabled: true,
      inspect: () => {
        throw new Error("private diagnostic");
      },
    }).capability().available,
    false,
  );
  const cap = testSudo().capability();
  assert.equal(cap.arbitraryCommands, false);
  assert.equal(cap.persistence, false);
  assert.equal(cap.agentRequests, false);
  for (const extra of [
    { command: "whoami" },
    { args: ["--help"] },
    { receiver: "other" },
    { policy: "other" },
  ])
    assert.equal(
      credentialCreate.safeParse({
        requestId: randomUUID(),
        operation: "sudo.identity",
        expectedPolicy: cap.policy,
        ...extra,
      }).success,
      false,
    );
});
test("sudo receives Unicode/spaces through a single private pipe, then clears buffers", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-sudo-test-"));
  const marker = join(directory, "result.json");
  const h = harness("lecture", { marker });
  try {
    const ticket = await h.broker.create("owner", h.body());
    const secret = Buffer.from(sudoTestSecret);
    const result = await h.broker.fulfill(ticket.id, "owner", secret);
    assert.equal(result.state, "succeeded");
    assert.equal(result.passwordUsed, true);
    assert.ok(secret.every((v) => v === 0));
    assert.deepEqual(JSON.parse(readFileSync(marker, "utf8")), {
      correct: true,
      count: 1,
    });
    assert.ok(!JSON.stringify(result).includes(sudoTestSecret));
    await assert.rejects(() =>
      h.broker.fulfill(ticket.id, "owner", Buffer.from(sudoTestSecret)),
    );
  } finally {
    h.broker.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("NOPASSWD is reported without sending or claiming password validation", async () => {
  const h = harness("nopass");
  try {
    const t = await h.broker.create("owner", h.body());
    const r = await h.broker.fulfill(
      t.id,
      "owner",
      Buffer.from(sudoTestSecret),
    );
    assert.equal(r.state, "succeeded");
    assert.equal(r.passwordUsed, false);
  } finally {
    h.broker.close();
  }
});
for (const mode of [
  "echo",
  "reprompt",
  "overflow",
  "wronguid",
  "hang",
  "after",
])
  test(`sudo rejects ${mode} without exporting process content or retrying`, async () => {
    let launches = 0;
    const h = harness(mode, { timeoutMs: 150, launched: () => launches++ });
    try {
      const t = await h.broker.create("owner", h.body());
      const secret = Buffer.from(sudoTestSecret);
      const r = await h.broker.fulfill(t.id, "owner", secret);
      assert.equal(r.state, "failed");
      assert.equal(launches, 1);
      assert.ok(!JSON.stringify(r).includes(sudoTestSecret));
      assert.ok(secret.every((v) => !v));
    } finally {
      h.broker.close();
    }
  });
test("sudo cancellation and revoked ownership stop the consumer without reviving the request", async () => {
  for (const action of ["cancel", "revoke"] as const) {
    const h = harness("after");
    try {
      const t = await h.broker.create("owner", h.body());
      const secret = Buffer.from(sudoTestSecret);
      const pending = h.broker.fulfill(t.id, "owner", secret);
      await new Promise((r) => setTimeout(r, 75));
      if (action === "cancel") h.broker.cancel(t.id, "owner");
      else h.broker.revoke("owner");
      const r = await pending;
      assert.equal(r.state, action === "cancel" ? "cancelled" : "invalidated");
      assert.ok(secret.every((v) => !v));
      assert.equal(h.broker.pending, 0);
    } finally {
      h.broker.close();
    }
  }
});
test("sudo rejects stale binary policy before dispatch and invalid password encodings before consumption", async () => {
  let policy = "first",
    launches = 0;
  const h = harness("success", {
    inspect: () => policy,
    launched: () => launches++,
  });
  try {
    const t = await h.broker.create("owner", h.body());
    for (const value of [
      Buffer.from("bad\npassword"),
      Buffer.from("bad\0password"),
      Buffer.from([0xff]),
      Buffer.alloc(1025, 65),
    ]) {
      await assert.rejects(() => h.broker.fulfill(t.id, "owner", value));
      assert.ok(value.every((v) => !v));
    }
    policy = "changed";
    const r = await h.broker.fulfill(
      t.id,
      "owner",
      Buffer.from(sudoTestSecret),
    );
    assert.equal(r.state, "failed");
    assert.equal(launches, 0);
  } finally {
    h.broker.close();
  }
});
test("sudo API uses session/origin binding and maintenance; no native/model/storage secret path", async () => {
  const directory = mkdtempSync(join(tmpdir(), "newbot-sudo-api-")),
    origin = "https://sudo.test.invalid";
  const codex = new ProviderCodex("https://provider.invalid/v1");
  const ctx = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "workspace"),
    password: "sudo-api-test-login",
    origins: [origin],
    codex,
    sudoIdentity: testSudo(),
  });
  try {
    await ctx.app.ready();
    const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin },
      payload: { password: "sudo-api-test-login" },
    });
    const headers = {
      origin,
      cookie: login.headers["set-cookie"]!.toString().split(";")[0],
    };
    const caps = (
      await ctx.app.inject({ url: "/api/runtime/capabilities", headers })
    ).json().capabilities.trustedInput;
    assert.equal(caps.sudo, true);
    assert.equal(caps.agentRequests, false);
    const payload = {
      requestId: randomUUID(),
      operation: "sudo.identity",
      expectedPolicy: caps.sudoIdentity.policy,
    };
    assert.equal(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/credentials/requests",
          headers: { origin },
          payload,
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await ctx.app.inject({
          method: "POST",
          url: "/api/credentials/requests",
          headers: { ...headers, origin: "https://app.invalid" },
          payload,
        })
      ).statusCode,
      403,
    );
    const t = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/credentials/requests",
        headers,
        payload,
      })
    ).json();
    assert.equal(t.state, "waiting");
    await assert.rejects(() =>
      ctx.service.handle("bridge/maintenance", { enabled: true }),
    );
    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/credentials/${t.id}/input`,
      headers: { ...headers, "content-type": "application/octet-stream" },
      payload: Buffer.from(sudoTestSecret),
    });
    assert.equal(response.json().state, "succeeded");
    for (const value of [
      response.body,
      JSON.stringify(codex.calls),
      JSON.stringify(ctx.service.events.threads),
      JSON.stringify(ctx.db.raw.prepare("SELECT * FROM audit").all()),
    ])
      assert.ok(!value.includes(sudoTestSecret));
    assert.equal(
      codex.calls.filter(
        (c) => c.method === "turn/start" || c.method === "process/writeStdin",
      ).length,
      0,
    );
  } finally {
    await ctx.app.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
