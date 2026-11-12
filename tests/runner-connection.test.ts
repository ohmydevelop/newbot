import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { database } from "../server/db.js";
import { RunnerControl } from "../server/runner/control.js";
import { RunnerLedger } from "../server/runner/ledger.js";
import {
  runnerRoutes,
  runnerAuthentication,
  isRunnerRoute,
} from "../server/runner/routes.js";
import {
  runRunnerConnection,
  runnerServerUrl,
} from "../server/runner/connection.js";
const fingerprint = "a".repeat(64);
async function until(fn: () => boolean) {
  const end = Date.now() + 5000;
  while (!fn()) {
    if (Date.now() > end) throw Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}
test("outbound network loop persists results, drains on stop and keeps browser/node authentication separate", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runner-http-")),
    db = database(join(dir, "server")),
    control = new RunnerControl(db),
    node = control.enroll("network", fingerprint),
    scope = randomUUID();
  control.grant(node.id, scope, 1);
  const ledger = new RunnerLedger(join(dir, "runner"), node.id),
    app = Fastify();
  app.addHook("onRequest", async (req, res) => {
    if (isRunnerRoute(req.url)) return runnerAuthentication(req, res, control);
    return res.code(401).send({ error: "browser auth required" });
  });
  runnerRoutes(app, control);
  const address = await app.listen({ host: "127.0.0.1", port: 0 }),
    signal = new AbortController();
  let calls = 0,
    stops = 0;
  const c = {
    id: randomUUID(),
    nodeId: node.id,
    scope,
    revision: 1,
    method: "turn/start" as const,
    params: { threadId: randomUUID() },
  };
  control.queue(c);
  const running = runRunnerConnection({
    server: address,
    token: node.token,
    fingerprint,
    ledger,
    signal: signal.signal,
    allowLocalHttp: true,
    pollMs: 50,
    perform: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 150));
      return { turn: { id: "once" } };
    },
    stop: async () => {
      stops++;
    },
  });
  try {
    await until(() => control.receipt(c.id).state === "completed");
    assert.equal(calls, 1);
    const headers = {
      "x-newbot-node": node.id,
      authorization: "Bearer " + node.token,
    };
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/runner/connect",
          headers: { ...headers, origin: "https://evil.invalid" },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/runner/connect",
          headers: { ...headers, cookie: "session=x" },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/runner/connect",
          headers: { "x-newbot-node": node.id },
          payload: {},
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (await app.inject({ url: "/api/runners", headers })).statusCode,
      401,
    );
    signal.abort();
    await running;
    assert.equal(stops, 1);
    assert.equal((control.nodes()[0] as any).stopped, 1);
    assert.equal(ledger.events().length, 0);
  } finally {
    signal.abort();
    await running.catch(() => {});
    await app.close();
    ledger.close();
    control.close();
    db.raw.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test("node connection refuses plaintext remote origins, credentials, alternate paths and redirects by construction", () => {
  for (const url of [
    "http://example.com",
    "https://a:b@example.com",
    "https://example.com/other",
    "https://example.com/?secret=a",
  ])
    assert.throws(() => runnerServerUrl(url, true));
  assert.throws(() => runnerServerUrl("http://localhost"));
  assert.equal(runnerServerUrl("https://example.com"), "https://example.com");
});

test("failed heartbeats stop the managed executor when the lease expires, without replaying work", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runner-lease-")),
    ledger = new RunnerLedger(dir, randomUUID()),
    app = Fastify();
  const scope = randomUUID(),
    controller = new AbortController();
  let stoppedAt = 0,
    startedAt = 0;
  app.post("/api/runner/connect", () => ({
    protocol: 1,
    epoch: 1,
    leaseMs: 1000,
    ack: 0,
    grants: [{ scope, revision: 1 }],
  }));
  app.post("/api/runner/exchange", (_req, res) =>
    res.code(503).send({ error: "offline" }),
  );
  app.post("/api/runner/release", () => ({ ok: true }));
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    await assert.rejects(
      runRunnerConnection({
        server: address,
        token: "a".repeat(43),
        fingerprint,
        ledger,
        signal: controller.signal,
        allowLocalHttp: true,
        pollMs: 50,
        start: async () => {
          startedAt = performance.now();
        },
        perform: async () => assert.fail("no command may run"),
        stop: async () => {
          stoppedAt = performance.now();
        },
      }),
    );
    assert.ok(stoppedAt - startedAt >= 800);
    assert.ok(stoppedAt - startedAt < 2000);
  } finally {
    await app.close();
    ledger.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("application integration exposes only opt-in node routes and retains admin Session plus Origin checks", async () => {
  const { createServer } = await import("../server/index.js");
  const { FakeCodex } = await import("./fixture.js");
  const dir = await mkdtemp(join(tmpdir(), "runner-app-auth-"));
  const appServer = await createServer({
    directory: dir,
    codex: new FakeCodex(),
    password: "synthetic-node-admin-password",
    origins: ["http://localhost:3100"],
    runnerControl: true,
  });
  const app = appServer.app;
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/runners",
          headers: { origin: "http://localhost:3100" },
          payload: { name: "fixture", expectedFingerprint: fingerprint },
        })
      ).statusCode,
      401,
    );
    const login = await app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://localhost:3100" },
      payload: { password: "synthetic-node-admin-password" },
    });
    assert.equal(login.statusCode, 200);
    const cookie = login.headers["set-cookie"]!.toString().split(";")[0];
    const enrolled = await app.inject({
      method: "POST",
      url: "/api/runners",
      headers: { origin: "http://localhost:3100", cookie },
      payload: { name: "fixture", expectedFingerprint: fingerprint },
    });
    assert.equal(enrolled.statusCode, 200);
    const node = enrolled.json();
    const headers = {
      "x-newbot-node": node.id,
      authorization: "Bearer " + node.token,
    };
    const connected = await app.inject({
      method: "POST",
      url: "/api/runner/connect",
      headers,
      payload: { protocol: 1, bootId: randomUUID(), fingerprint },
    });
    assert.equal(connected.statusCode, 200);
    assert.equal(
      (await app.inject({ url: "/api/config", headers })).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/api/runner/connect",
          headers: { ...headers, cookie },
          payload: {},
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await app.inject({
          method: "DELETE",
          url: "/api/runners/" + node.id,
          headers: { cookie, origin: "https://evil.invalid" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ url: "/api/runners", headers: { cookie } })).json()
        .nodes[0].token_hash,
      undefined,
    );
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("real TCP response loss reconnects and retransmits without duplicating native work or persisted events", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runner-drop-")),
    db = database(join(dir, "server")),
    control = new RunnerControl(db),
    node = control.enroll("drop-test", fingerprint),
    scope = randomUUID(),
    bootController = new AbortController();
  control.grant(node.id, scope, 1);
  const ledger = new RunnerLedger(join(dir, "runner"), node.id),
    app = Fastify();
  let connectDrop = false,
    commandDrop = false,
    ackDrop = false,
    calls = 0;
  app.post("/api/runner/connect", (req, res) => {
    const result = control.connect(node.id, node.token, req.body as any);
    if (!connectDrop) {
      connectDrop = true;
      res.hijack();
      res.raw.destroy();
      return;
    }
    return result;
  });
  app.post("/api/runner/exchange", (req, res) => {
    const body = req.body as any,
      result = control.exchange(node.id, node.token, body);
    if (
      (result.commands.length && !commandDrop) ||
      (body.events.length && !ackDrop)
    ) {
      if (body.events.length) ackDrop = true;
      else commandDrop = true;
      res.hijack();
      res.raw.destroy();
      return;
    }
    return result;
  });
  app.post("/api/runner/release", (req) => {
    const b = req.body as any;
    control.release(node.id, node.token, b.bootId, b.epoch);
    return { ok: true };
  });
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const command = {
    id: randomUUID(),
    nodeId: node.id,
    scope,
    revision: 1,
    method: "turn/start" as const,
    params: { threadId: randomUUID() },
  };
  control.queue(command);
  const run = runRunnerConnection({
    server: address,
    token: node.token,
    fingerprint,
    ledger,
    signal: bootController.signal,
    allowLocalHttp: true,
    pollMs: 50,
    stop: async () => {},
    perform: async () => {
      calls++;
      return { turn: { id: "stable" } };
    },
  });
  try {
    await until(() => ackDrop && ledger.events().length === 0);
    assert.ok(commandDrop);
    assert.ok(connectDrop);
    assert.equal((control.nodes()[0] as any).epoch, 1);
    assert.equal(calls, 1);
    assert.equal(control.receipt(command.id).state, "completed");
    assert.equal(
      control.events(node.id).filter((e) => e.kind === "receipt").length,
      1,
    );
  } finally {
    bootController.abort();
    await run;
    await app.close();
    ledger.close();
    control.close();
    db.raw.close();
    await rm(dir, { recursive: true, force: true });
  }
});
