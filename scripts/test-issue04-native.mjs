// Fixed native Codex + synthetic Responses. Never reads the developer's Codex home.
import assert from "node:assert/strict";
import { createServer as http } from "node:http";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "../server/index.ts";
import { Codex } from "../server/codex.ts";
import { ProviderRuntime } from "../server/provider-runtime.ts";
const root = await mkdtemp(join(tmpdir(), "newbot-issue04-native-"));
const stage = process.env.ISSUE04_STAGE || "S3";
const output = resolve(
  process.env.ISSUE04_NATIVE_OUTPUT ||
    `.issue/2026-11-10/evidence-issue-04/${stage}/native`,
);
await mkdir(output, { recursive: true });
await mkdir(join(root, "work"));
await mkdir(join(root, "codex"));
const calls = [],
  finished = new Map(),
  checks = [];
let ctx,
  native,
  holdNext = false,
  releaseHeld;
await mkdir(join(root, "codex", "skills", "issue04"), { recursive: true });
await writeFile(
  join(root, "codex", "skills", "issue04", "SKILL.md"),
  "---\nname: issue04\ndescription: Synthetic selection test.\n---\nNATIVE_ISSUE04_SKILL_PROOF\nRespond briefly.",
);
const upstream = http(async (req, res) => {
  if (req.url.endsWith("/models")) {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        data: [
          "gpt-6.1-sol",
          "manual-reasoning-model",
          "rejected-reasoning",
          "ignore-reasoning",
        ].map((id) => ({ id })),
      }),
    );
    return;
  }
  let raw = "";
  for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  calls.push({
    path: req.url,
    model: body.model,
    effort: body.reasoning?.effort,
    hasFirst: raw.includes("FIRST_TURN"),
    hasSkill: raw.includes("NATIVE_ISSUE04_SKILL_PROOF"),
  });
  if (holdNext) {
    holdNext = false;
    await new Promise((r) => (releaseHeld = r));
  }
  if (body.model === "rejected-reasoning") {
    res.writeHead(400, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: "Unsupported reasoning effort",
          type: "invalid_request_error",
          param: "reasoning.effort",
          code: "unsupported_value",
        },
      }),
    );
    return;
  }
  const id = "resp_" + calls.length,
    mid = "msg_" + calls.length;
  const item = {
    id: mid,
    type: "message",
    status: "completed",
    role: "assistant",
    content: [
      { type: "output_text", text: "Synthetic response", annotations: [] },
    ],
  };
  const response = {
    id,
    object: "response",
    created_at: 1,
    status: "completed",
    model: body.model,
    output: [item],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
  };
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const event of [
    {
      type: "response.created",
      response: { ...response, status: "in_progress", output: [] },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    },
    {
      type: "response.content_part.added",
      output_index: 0,
      item_id: mid,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    },
    {
      type: "response.output_text.delta",
      output_index: 0,
      item_id: mid,
      content_index: 0,
      delta: "Synthetic response",
    },
    { type: "response.output_item.done", output_index: 0, item },
    { type: "response.completed", response },
  ])
    res.write("data: " + JSON.stringify(event) + "\n\n");
  res.end();
});
await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${upstream.address().port}`,
  origin = "http://127.0.0.1:3100";
const wait = async (fn) => {
  const deadline = Date.now() + 30000;
  while (!fn()) {
    if (Date.now() > deadline) throw Error("Native event timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
};
let failure;
try {
  async function boot() {
    native = new Codex(join(root, "work"), () => ({
      CODEX_HOME: join(root, "codex"),
    }));
    const receive = native.receive.bind(native);
    native.receive = (message) => {
      if (message.error) console.error("Synthetic native error", message.error);
      return receive(message);
    };
    ctx = await createServer({
      directory: join(root, "data"),
      cwd: join(root, "work"),
      codex: native,
      providerRuntime: new ProviderRuntime(),
      password: "issue04-native-password",
      origins: [origin],
    });
    native.on("event", (e) => {
      if (e.method === "turn/completed")
        finished.set(e.params.turn.id, e.params.turn);
    });
    await native.start();
    assert.equal(native.state, "ready", native.reason);
  }
  await boot();
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin },
    payload: { password: "issue04-native-password" },
  });
  const headers = { origin, cookie: login.headers["set-cookie"].split(";")[0] };
  const post = (url, payload) =>
    ctx.app.inject({ method: "POST", url, headers, payload });
  const action = (action, p = {}) =>
    post("/api/agent/action", { action, ...p });
  const config = (
    await ctx.app.inject({ url: "/api/runtime/config", headers })
  ).json().configuration;
  const published = await post("/api/runtime/config", {
    expectedRevision: config.revision,
    providers: [
      {
        id: "gateway_a",
        name: "A",
        baseUrl: base + "/a",
        defaultModel: "manual-reasoning-model",
      },
      {
        id: "gateway_b",
        name: "B",
        baseUrl: base + "/b",
        defaultModel: "manual-reasoning-model",
      },
    ],
    defaults: { provider: "gateway_a", model: "manual-reasoning-model" },
  });
  assert.equal(published.statusCode, 200, published.body);
  const run = async (threadId, text, extra = {}, status = "completed") => {
    const result = await post("/api/agent/run", {
      requestId: randomUUID(),
      text,
      ...(threadId ? { threadId } : {}),
      ...extra,
    });
    assert.equal(result.statusCode, 200, result.body);
    const view = result.json();
    await wait(() => finished.has(view.turn.id));
    assert.equal(
      finished.get(view.turn.id).status,
      status,
      JSON.stringify(finished.get(view.turn.id)),
    );
    return view;
  };
  const first = await run(null, "FIRST_TURN", { effort: "low" });
  assert.equal(calls.at(-1).effort, "low");
  checks.push(
    "unknown model explicit low reaches the native Responses request",
  );
  const select = async (p) => {
    const view = (
      await ctx.app.inject({ url: "/api/threads/" + first.threadId, headers })
    ).json();
    const result = await action("session/update", {
      threadId: first.threadId,
      expectedRevision: view.runtime.revision,
      ...p,
    });
    assert.equal(result.statusCode, 200, result.body);
    return result.json();
  };
  await select({ effort: "high" });
  await run(first.threadId, "SECOND_TURN");
  assert.equal(calls.at(-1).effort, "high");
  assert.ok(calls.at(-1).hasFirst);
  checks.push("same native thread uses changed effort and retains history");
  await select({
    provider: "gateway_b",
    model: "ignore-reasoning",
    effort: "medium",
  });
  await run(first.threadId, "IGNORE_PARAMETER");
  assert.equal(calls.at(-1).path, "/b/responses");
  assert.equal(calls.at(-1).effort, "medium");
  const catalog = (await action("gateway/catalog")).json();
  assert.equal(
    catalog
      .find((g) => g.id === "gateway_b")
      .models.find((m) => m.model === "ignore-reasoning").reasoningCapability
      .status,
    "unknown",
  );
  checks.push(
    "accepted Responses are not treated as proof that the upstream adopted effort",
  );
  await select({ model: "rejected-reasoning", effort: "high" });
  const count = calls.length;
  await run(first.threadId, "REJECT_PARAMETER", {}, "failed");
  assert.equal(calls.length, count + 1);
  checks.push(
    "upstream rejection fails once without automatic model fallback or replay",
  );
  await select({ model: "manual-reasoning-model", effort: "" });
  await run(first.threadId, "RESET_DEFAULT");
  assert.equal(calls.at(-1).effort, undefined);
  checks.push(
    "reset to default clears the prior explicit effort on the same native thread",
  );
  await run(null, "DEFAULT_ON_NEW_THREAD");
  assert.equal(calls.at(-1).effort, undefined);
  checks.push(
    "unknown model starts with native default when no explicit effort is selected",
  );
  if (stage === "S4" || stage === "S5") {
    holdNext = true;
    const submitted = await post("/api/agent/run", {
      threadId: first.threadId,
      text: "HOLD_NEXT_SETTINGS",
      requestId: randomUUID(),
    });
    assert.equal(submitted.statusCode, 200, submitted.body);
    await wait(() => releaseHeld);
    const heldRequest = structuredClone(calls.at(-1));
    const next1 = await select({
      provider: "gateway_a",
      model: "manual-reasoning-model",
      effort: "low",
      approval: "review",
    });
    assert.equal(next1.pending.state, "pending");
    assert.equal(next1.applied.provider, "gateway_b");
    const next2 = await select({ effort: "high" });
    assert.equal(next2.applied.effort, "");
    assert.deepEqual(calls.at(-1), heldRequest);
    assert.equal(heldRequest.path, "/b/responses");
    assert.equal(heldRequest.effort, undefined);
    const doc = await ctx.service.skills.read(
      (await ctx.service.skills.list()).skills.find((s) => s.name === "issue04")
        .id,
    );
    const selection = { id: doc.skill.id, sha256: doc.sha256 };
    const selected = await action("session/inputs", {
      threadId: first.threadId,
      expectedRevision: 0,
      skills: [selection],
      plugins: [],
    });
    assert.equal(selected.statusCode, 200, selected.body);
    assert.equal(heldRequest.hasSkill, false);
    releaseHeld();
    await wait(() => finished.has(submitted.json().turn.id));
    await ctx.app.close();
    await boot();
    const restored = (
      await ctx.app.inject({ url: "/api/threads/" + first.threadId, headers })
    ).json();
    assert.equal(restored.runtime.effort, "high");
    assert.equal(restored.runtime.pending.state, "pending");
    assert.equal(restored.nextInput.skills[0].id, selection.id);
    await run(first.threadId, "NEXT_AFTER_RESTART", {
      runtimeRevision: restored.runtime.revision,
      inputRevision: restored.nextInput.revision,
      skills: [selection],
    });
    assert.equal(calls.at(-1).path, "/a/responses");
    assert.equal(calls.at(-1).effort, "high");
    assert.equal(calls.at(-1).hasFirst, true);
    assert.equal(calls.at(-1).hasSkill, true);
    const applied = (
      await ctx.app.inject({ url: "/api/threads/" + first.threadId, headers })
    ).json();
    assert.equal(applied.runtime.pending, undefined);
    assert.equal(applied.runtime.applied.approval, "review");
    assert.deepEqual(applied.nextInput.skills, []);
    checks.push(
      "in-flight request stays unchanged while successive settings and a skill selection are saved",
    );
    checks.push(
      "service and native process restart restore pending intent and references from SQLite",
    );
    checks.push(
      "next native turn uses final gateway/effort and actual skill content, preserving thread identity and history",
    );
    checks.push(
      "references are consumed once after dispatch and confirmed settings match the next turn",
    );
  }
} catch (e) {
  failure = String(e.stack || e);
  process.exitCode = 1;
} finally {
  releaseHeld?.();
  await ctx?.app.close();
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  await rm(root, { recursive: true, force: true });
  const result = {
    version: "0.165.0",
    syntheticUpstream: true,
    realProviderCalls: 0,
    checks,
    calls,
    failure,
  };
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
}
