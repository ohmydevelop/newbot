// Real App Server, Bridge, SQLite and shell tool; two synthetic Responses gateways.
import assert from "node:assert/strict";
import { createServer as httpServer } from "node:http";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "../server/index.ts";
import { Codex } from "../server/codex.ts";
import { ProviderRuntime } from "../server/provider-runtime.ts";
const directory = await mkdtemp(join(tmpdir(), "issue001-live-")),
  cwd = join(directory, "work"),
  home = join(directory, "codex"),
  counter = join(directory, "tool-count");
await mkdir(cwd);
await mkdir(home);
process.env.ENABLE_TEST_MCP = "false";
process.env.ENABLE_OFFICIAL_MCP = "false";
process.env.EXPERIMENTAL_PLUGINS = "true";
const calls = [],
  events = [],
  checks = [],
  finished = new Map();
let ctx,
  releaseFirst,
  releasePaused,
  pauseNext = false,
  stage = "start";
const wait = async (predicate) => {
  const deadline = Date.now() + 45000;
  while (!predicate()) {
    if (Date.now() > deadline) throw Error("timeout: " + stage);
    await new Promise((r) => setTimeout(r, 20));
  }
};
const makeGateway = (id) =>
  httpServer(async (req, res) => {
    if (req.url.endsWith("/models")) {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          data: [
            { id: "gpt-6.1-sol" },
            { id: "gpt-6.1-terra" },
            { id: "unsupported-fixture" },
          ],
        }),
      );
      return;
    }
    let raw = "";
    for await (const b of req) raw += b;
    const body = JSON.parse(raw);
    // Deliberately incompatible probe: it must fail without invoking a real tool.
    if (body.tools?.some((t) => t.name === "newbot_capability_probe")) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        "data: " +
          JSON.stringify({
            type: "response.completed",
            response: {
              status: "completed",
              output: [],
              usage: { input_tokens: 32000 },
            },
          }) +
          "\n\n",
      );
      return;
    }
    const index = calls.length;
    calls.push({ id, body, authorization: req.headers.authorization });
    if (index === 0) await new Promise((r) => (releaseFirst = r));
    else if (pauseNext) {
      pauseNext = false;
      await new Promise((r) => (releasePaused = r));
    }
    if (res.destroyed) return;
    const item =
      index === 0
        ? {
            type: "function_call",
            id: "fc_once",
            call_id: "call_once",
            name: "exec_command",
            arguments: JSON.stringify({
              cmd: `printf one >> '${counter}'`,
              max_output_tokens: 100,
            }),
          }
        : {
            id: "msg_" + index,
            type: "message",
            status: "completed",
            role: "assistant",
            content: [
              { type: "output_text", text: "ROUTE_OK_" + id, annotations: [] },
            ],
          };
    const response = {
      id: "resp_" + id + "_" + index,
      object: "response",
      status: "completed",
      model: body.model,
      output: [item],
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
    };
    res.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of [
      {
        type: "response.created",
        response: { ...response, status: "in_progress", output: [] },
      },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.completed", response },
    ])
      res.write("data: " + JSON.stringify(event) + "\n\n");
    res.end();
  });
const gateways = [makeGateway("a"), makeGateway("b")];
for (const server of gateways)
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
const defs = Object.fromEntries(
  gateways.map((server, i) => [
    i ? "b" : "a",
    {
      name: i ? "Second" : "First",
      base_url: `http://127.0.0.1:${server.address().port}`,
      wire_api: "responses",
      requires_openai_auth: false,
    },
  ]),
);
async function open() {
  const native = new Codex(cwd, () => ({ CODEX_HOME: home }));
  const receive = native.receive.bind(native);
  native.receive = (m) => {
    if (m.error) console.error("fixture native error", JSON.stringify(m.error));
    receive(m);
  };
  const app = await createServer({
    directory,
    cwd,
    codex: native,
    providerRuntime: new ProviderRuntime(),
    password: "native-live-fixture",
  });
  native.on("event", (e) => {
    events.push(e);
    if (e.method === "turn/completed")
      finished.set(e.params.turn.id, e.params.turn);
  });
  await native.start();
  assert.equal(native.state, "ready", native.reason);
  assert.equal(native.runtimeCapabilities.liveModelRoutes, true);
  return app;
}
try {
  ctx = await open();
  let pr = ctx.runtime.providerRuntime;
  pr.apply(pr.revision, [
    { keyPath: "model_providers", value: defs, mergeStrategy: "replace" },
    { keyPath: "model_provider", value: "a", mergeStrategy: "replace" },
    { keyPath: "model", value: "gpt-6.1-sol", mergeStrategy: "replace" },
  ]);
  for (const id of ["a", "b"]) {
    const cfg = await ctx.service.configuration.read();
    const input = await ctx.privateFields.prepare({
      operation: "credential.fields.save",
      requestId: crypto.randomUUID(),
      scope: "provider",
      targetId: id,
      expectedRevision: cfg.publicView.revisions["provider:" + id],
      expectedFieldsRevision: "absent",
      fields: [{ kind: "bearer", name: "Authorization" }],
    });
    await input.run(
      Buffer.from(
        Buffer.from(
          JSON.stringify({
            "bearer:Authorization": id === "a" ? "SYNTHETIC_A" : "SYNTHETIC_B",
          }),
        ).toString("base64"),
      ),
      new AbortController().signal,
      () => true,
      () => {},
    );
  }
  const thread = await ctx.service.handle("thread/start", {
    provider: "a",
    model: "gpt-6.1-sol",
    approval: "full",
  });
  stage = "initial model request";
  const turn = await ctx.service.handle("turn/start", {
    threadId: thread.id,
    text: "Run the one test command then answer.",
    approval: "full",
    effort: "low",
  });
  await wait(() => !!releaseFirst);
  const update = (patch) =>
    ctx.service.handle("session/update", {
      threadId: thread.id,
      expectedRevision: ctx.service.runtimeSettings.get(thread.id).revision,
      ...patch,
    });
  stage = "live cross-provider update";
  let saved = await update({
    provider: "b",
    model: "gpt-6.1-terra",
    effort: "high",
  });
  assert.equal(saved.pending?.state, "accepted");
  assert.equal(saved.applied.provider, "a");
  saved = await update({ provider: "a", model: "gpt-6.1-sol", effort: "low" });
  saved = await update({
    provider: "b",
    model: "gpt-6.1-terra",
    effort: "medium",
  });
  const revision = saved.revision;
  assert.equal(
    calls.length,
    1,
    "accepted settings must not resubmit the in-flight request",
  );
  stage = "unsupported destination";
  await assert.rejects(
    update({ model: "unsupported-fixture" }),
    /能力信息|工具调用验证/,
  );
  assert.equal(
    ctx.service.runtimeSettings.get(thread.id).revision,
    revision,
    "rejection preserves the last accepted selection",
  );
  checks.push(
    "three live revisions are accepted without changing the in-flight request; invalid metadata preserves the last valid route",
  );
  releaseFirst();
  stage = "same-turn completion";
  await wait(() => finished.has(turn.turn.id));
  assert.equal(
    finished.get(turn.turn.id).status,
    "completed",
    JSON.stringify(finished.get(turn.turn.id)),
  );
  assert.deepEqual(
    calls.map((c) => c.id),
    ["a", "b"],
  );
  assert.equal(calls[1].body.model, "gpt-6.1-terra");
  assert.equal(calls[1].body.reasoning.effort, "medium");
  assert.equal(calls[0].authorization, "Bearer SYNTHETIC_A");
  assert.equal(calls[1].authorization, "Bearer SYNTHETIC_B");
  assert.equal(calls[1].body.previous_response_id, undefined);
  assert.ok(
    calls[1].body.input.some(
      (i) => i.type === "function_call_output" && i.call_id === "call_once",
    ),
  );
  assert.equal(await readFile(counter, "utf8"), "one");
  const adopted = ctx.service.runtimeSettings.get(thread.id);
  assert.equal(adopted.pending, undefined);
  assert.equal(adopted.applied.provider, "b");
  assert.equal(adopted.applied.revision, revision);
  assert.ok(
    events.some(
      (e) =>
        e.method === "turn/settings/applied" &&
        e.params.turnId === turn.turn.id &&
        e.params.revision === revision,
    ),
  );
  checks.push(
    "same native thread and turn continue at gateway B with captured credentials and effort; original tool executes exactly once",
  );
  checks.push(
    "actual-use notification is distinct from acceptance and matches the request revision",
  );
  stage = "next turn";
  let next = await ctx.service.handle("turn/start", {
    threadId: thread.id,
    text: "Continue with the saved route.",
  });
  await wait(() => finished.has(next.turn.id));
  assert.equal(calls.at(-1).id, "b");
  assert.equal(calls.at(-1).body.reasoning.effort, "medium");
  assert.equal(await readFile(counter, "utf8"), "one");
  checks.push(
    "future turn resumes with the selected gateway without replaying the historical tool",
  );
  await ctx.app.close();
  ctx = undefined;
  ctx = await open();
  stage = "restart restore";
  next = await ctx.service.handle("turn/start", {
    threadId: thread.id,
    text: "Continue after restart.",
  });
  await wait(() => finished.has(next.turn.id));
  assert.equal(calls.at(-1).id, "b");
  assert.equal(ctx.service.runtimeSettings.get(thread.id).provider, "b");
  assert.equal(await readFile(counter, "utf8"), "one");
  checks.push(
    "server restart restores the selected route from SQLite and retains the original native thread",
  );
  stage = "cancel with accepted route";
  pauseNext = true;
  const cancelled = await ctx.service.handle("turn/start", {
    threadId: thread.id,
    text: "This request will be interrupted.",
  });
  await wait(() => !!releasePaused);
  const beforeCancel = calls.length;
  saved = await update({ provider: "a", model: "gpt-6.1-sol", effort: "high" });
  assert.equal(saved.pending?.state, "accepted");
  await ctx.service.handle("turn/interrupt", {
    threadId: thread.id,
    turnId: cancelled.turn.id,
  });
  await wait(() => finished.has(cancelled.turn.id));
  assert.equal(finished.get(cancelled.turn.id).status, "interrupted");
  assert.equal(
    calls.length,
    beforeCancel,
    "cancel must not start another model request",
  );
  assert.equal(
    events.some(
      (e) =>
        e.method === "turn/settings/applied" &&
        e.params.turnId === cancelled.turn.id,
    ),
    false,
  );
  const late = await ctx.runtime.call("turn/settings/update", {
    threadId: thread.id,
    turnId: cancelled.turn.id,
    model: "gpt-6.1-terra",
  });
  assert.equal(late.status, "targetUnavailable");
  releasePaused();
  stage = "next turn after cancellation";
  next = await ctx.service.handle("turn/start", {
    threadId: thread.id,
    text: "Continue with the last accepted selection after cancellation.",
  });
  await wait(() => finished.has(next.turn.id));
  assert.equal(finished.get(next.turn.id).status, "completed");
  assert.equal(calls.at(-1).id, "a");
  assert.equal(calls.at(-1).body.reasoning.effort, "high");
  assert.equal(await readFile(counter, "utf8"), "one");
  checks.push(
    "cancelled tasks do not adopt pending routes or accept stale updates; the next turn uses the saved choice without replay",
  );
  const inspect = async (root) => {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = join(root, entry.name);
      if (entry.isDirectory()) await inspect(path);
      else if (entry.isFile()) {
        const bytes = await readFile(path);
        assert.ok(
          !bytes.includes(Buffer.from("SYNTHETIC_A")) &&
            !bytes.includes(Buffer.from("SYNTHETIC_B")),
          "plaintext fixture credential persisted at " +
            path.replace(directory, "<isolated>"),
        );
      }
    }
  };
  stage = "credential persistence inspection";
  // Check the volatile log directory before shutdown clears it. The persistent
  // tree is checked only after the runtime stops: marketplace background clones
  // can replace their temporary directories even when no model turn is running.
  if (ctx.runtime.runtimeLogHome) await inspect(ctx.runtime.runtimeLogHome);
  await ctx.runtime.stopAndWait();
  await inspect(directory);
  checks.push(
    "synthetic private credentials are absent from isolated persistent files and native logs",
  );
  const evidence = resolve(process.env.NEWBOT_EVIDENCE_DIR || ".issue/2026-11-11/evidence-issue-001");
  await mkdir(evidence, { recursive: true });
  await writeFile(
    join(evidence, "live-native.json"),
    JSON.stringify(
      {
        binary: process.env.CODEX_BIN,
        upstream: "two synthetic loopback Responses gateways",
        checks,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: checks.length }));
} catch (error) {
  console.error(stage, String(error));
  throw error;
} finally {
  releaseFirst?.();
  releasePaused?.();
  await ctx?.app.close();
  for (const server of gateways) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  await rm(directory, { recursive: true, force: true });
}
