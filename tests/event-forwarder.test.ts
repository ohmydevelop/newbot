import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { relayServer } from "../services/event-relay/server.js";
import { eventForwarder } from "../packages/event-bridge/forwarder.js";
import { workflowEvents } from "../examples/github-events/workflows.js";

test("generic MCP bridge persists before cursor advance and recovers relay outage without re-emitting after reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "forwarder-")),
    file = join(dir, "mail.json");
  await writeFile(file, "[]");
  const relay = relayServer({
    directory: join(dir, "relay"),
    adminToken: "a".repeat(40),
  });
  let offline = false;
  relay.app.addHook("preHandler", async (_req, reply) => {
    if (offline) return reply.code(503).send({ error: "offline" });
  });
  await relay.app.listen({ host: "127.0.0.1", port: 0 });
  const route = relay.store.createRoute();
  const options = {
    directory: join(dir, "bridge"),
    source: "urn:test:source",
    server: {
      command: process.execPath,
      args: [resolve(".data/event-plugins/mailbox-events/server.mjs")],
      env: { MAILBOX_FILE: file },
    },
    event: "mail.received",
    arguments: { mailbox: "inbox" },
    relay: {
      url: `http://127.0.0.1:${(relay.app.server.address() as any).port}/v1/routes/${route.id}/events`,
      token: route.producer,
    },
  };
  let bridge = await eventForwarder(options);
  try {
    assert.equal((await bridge.tick()).events, 0);
    await writeFile(
      file,
      JSON.stringify([
        {
          id: 1,
          mailbox: "inbox",
          subject: "actual plugin output",
          unread: true,
        },
      ]),
    );
    offline = true;
    await assert.rejects(bridge.tick());
    await bridge.close();
    offline = false;
    bridge = await eventForwarder(options);
    assert.equal((await bridge.tick()).events, 0);
    const page = relay.store.lease(route.id);
    assert.equal(page.events.length, 1);
    assert.equal(page.events[0].data.subject, "actual plugin output");
    assert.equal((await bridge.tick()).events, 0);
    relay.store.ack(route.id, page.receipt!);
    assert.equal(relay.store.lease(route.id).events.length, 0);
    await assert.rejects(
      eventForwarder({ ...options, arguments: { mailbox: "changed" } }),
      /configuration changed/,
    );
  } finally {
    await bridge.close();
    await relay.app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

const row = (id: number, attempt = 1) => ({
  id,
  run_attempt: attempt,
  name: "check",
  status: "completed",
  conclusion: "failure",
  head_branch: "main",
  head_sha: "abc",
  html_url: `https://github.com/o/r/actions/runs/${id}`,
  updated_at: "2026-11-17T00:00:00Z",
  created_at: "2026-11-17T00:00:00Z",
});
test("workflow plugin establishes a baseline, emits new completion and rerun IDs, drains pages without silently losing events", async () => {
  let rows = [row(1)];
  const request: typeof fetch = async () =>
    Response.json({ workflow_runs: rows });
  const input = {
    arguments: { repository: "o/r", branch: "main" },
    cursor: null as string | null,
  };
  const first = await workflowEvents(input, AbortSignal.timeout(2000), request);
  assert.equal(first.events.length, 0);
  input.cursor = first.cursor;
  rows = [...Array.from({ length: 40 }, (_, i) => row(i + 2)), row(1)];
  const page = await workflowEvents(input, AbortSignal.timeout(2000), request);
  assert.equal(page.events.length, 32);
  const next = await workflowEvents(
    { ...input, cursor: page.cursor },
    AbortSignal.timeout(2000),
    request,
  );
  assert.equal(next.events.length, 8);
  rows = [row(1, 2), ...rows];
  const rerun = await workflowEvents(
    { ...input, cursor: next.cursor },
    AbortSignal.timeout(2000),
    request,
  );
  assert.equal(rerun.events.length, 1);
  assert.equal(rerun.events[0].eventId, "1.2");
  rows = Array.from({ length: 100 }, (_, i) => row(i + 1000));
  await assert.rejects(
    workflowEvents(
      { ...input, cursor: rerun.cursor },
      AbortSignal.timeout(2000),
      request,
    ),
    /gap/,
  );
  await assert.rejects(
    workflowEvents(
      input,
      AbortSignal.timeout(2000),
      async () =>
        new Response("", {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        }),
    ),
    /retry/,
  );
});
