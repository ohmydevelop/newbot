// Actual product HTTP/Bridge -> pinned native Codex -> loopback Responses; no paid providers.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createServer as httpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { Codex } from "../server/codex.ts";
import { createServer } from "../server/index.ts";
process.env.NODE_ENV = "test";
await mkdir(".issue/2026-11-09/evidence-02", { recursive: true });
await rm(".issue/2026-11-09/evidence-02/native-product-result.json", {
  force: true,
});
const root = await mkdtemp(tmpdir() + "/newbot-session-native-"),
  requests = [],
  checks = [];
let ctx;
let releaseHeld;
const held = new Promise((resolve) => {
  releaseHeld = resolve;
});
const issuedPolicies = new Set(),
  policyReviews = [];
function schemaValue(schema, key = "", root = schema) {
  if (schema.$ref) {
    const path = schema.$ref.slice(2).split("/");
    return schemaValue(
      path.reduce((o, k) => o[k], root),
      key,
      root,
    );
  }
  if (schema.enum) {
    const prefer = /authorization/i.test(key)
      ? "high"
      : /risk/i.test(key)
        ? "low"
        : "allow";
    return (
      schema.enum.find((v) => v === prefer) ||
      schema.enum.find((v) => ["approve", "approved", "accept"].includes(v)) ||
      schema.enum[0]
    );
  }
  if (schema.anyOf || schema.oneOf)
    return schemaValue((schema.anyOf || schema.oneOf)[0], key, root);
  if (schema.type === "object" || schema.properties)
    return Object.fromEntries(
      Object.entries(schema.properties || {}).map(([key, s]) => [
        key,
        schemaValue(s, key, root),
      ]),
    );
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return true;
  if (schema.type === "integer" || schema.type === "number") return 0;
  if (schema.type === "null") return null;
  return "Synthetic harmless printf command, explicitly authorized in this local fixture";
}
const upstream = httpServer(async (req, res) => {
  if (req.url.endsWith("/models")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] }));
    return;
  }
  let body = "";
  for await (const c of req) body += c;
  requests.push({
    path: req.url,
    first: body.includes("PRODUCT_HISTORY_ONE"),
    second: body.includes("PRODUCT_HISTORY_TWO"),
    pluginCapabilities:
      body.includes("Capabilities from the") &&
      body.includes("newbot-test-plugin:"),
  });
  if (body.includes("PRODUCT_HOLD_OTHER")) await held;
  const parsed = JSON.parse(body),
    marker = ["FULL", "ASK", "REVIEW"].find((p) =>
      body.includes("PRODUCT_POLICY_" + p),
    );
  const format = parsed.text?.format;
  let reviewText;
  if (
    format?.type === "json_schema" ||
    (issuedPolicies.has("REVIEW") &&
      body.includes("NEWBOT_POLICY_PROOF") &&
      !parsed.input?.some((i) => i.type === "function_call_output"))
  ) {
    policyReviews.push(format?.type || "plain");
    reviewText = JSON.stringify(
      format?.schema
        ? schemaValue(format.schema)
        : {
            risk_level: "low",
            user_authorization: "high",
            outcome: "allow",
            rationale: "Synthetic harmless printf",
          },
    );
  }

  const findTool = (tools, namespace) => {
    for (const t of tools || []) {
      if (t.name === "exec_command") return { ...t, namespace };
      if (t.tools) {
        const found = findTool(t.tools, t.name);
        if (found) return found;
      }
    }
  };
  const tool =
    marker && !issuedPolicies.has(marker) && !reviewText
      ? findTool(parsed.tools) || { name: "exec_command" }
      : null;
  if (tool) issuedPolicies.add(marker);
  const n = requests.length,
    id = "resp_" + n,
    mid = "msg_" + n,
    msg = tool
      ? {
          id: "fc_" + n,
          type: "function_call",
          call_id: "call_" + n,
          name: tool.name,
          ...(tool.namespace ? { namespace: tool.namespace } : {}),
          arguments: JSON.stringify({
            cmd: "printf NEWBOT_POLICY_PROOF",
            max_output_tokens: 100,
            ...(marker !== "FULL"
              ? {
                  sandbox_permissions: "require_escalated",
                  justification: "Local synthetic printf approval test",
                }
              : {}),
          }),
          status: "completed",
        }
      : {
          id: mid,
          type: "message",
          status: "completed",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: reviewText || "LOCAL_SYNTHETIC_REPLY",
              annotations: [],
            },
          ],
        },
    response = {
      id,
      object: "response",
      created_at: 1,
      status: "completed",
      model: "gpt-6.1-sol",
      output: [msg],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
  res.writeHead(200, { "content-type": "text/event-stream" });
  if (tool) {
    for (const e of [
      {
        type: "response.created",
        response: { ...response, status: "in_progress", output: [] },
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: { ...msg, arguments: "" },
      },
      { type: "response.output_item.done", output_index: 0, item: msg },
      { type: "response.completed", response },
    ])
      res.write("data: " + JSON.stringify(e) + "\n\n");
    res.end();
    return;
  }
  for (const e of [
    {
      type: "response.created",
      response: { ...response, status: "in_progress", output: [] },
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: { ...msg, status: "in_progress", content: [] },
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
      delta: "LOCAL_SYNTHETIC_REPLY",
    },
    { type: "response.output_item.done", output_index: 0, item: msg },
    { type: "response.completed", response },
  ])
    res.write("data: " + JSON.stringify(e) + "\n\n");
  res.end();
});
async function check(name, fn) {
  await fn();
  checks.push(name);
  console.log("PASS " + name);
}
try {
  await new Promise((r) => upstream.listen(0, "127.0.0.1", r));
  const port = upstream.address().port;
  await mkdir(root + "/work");
  await mkdir(root + "/skills/native-personal", { recursive: true });
  await writeFile(
    root + "/skills/native-personal/SKILL.md",
    "---\nname: native-personal\ndescription: Personal removal fixture\n---\n# Native personal skill\n",
  );
  await writeFile(
    root + "/config.toml",
    `model="gpt-6.1-sol"\nmodel_provider="probe_a"\n[model_providers.probe_a]\nname="A"\nbase_url="http://127.0.0.1:${port}/a"\nwire_api="responses"\nrequires_openai_auth=false\n[model_providers.probe_b]\nname="B"\nbase_url="http://127.0.0.1:${port}/b"\nwire_api="responses"\nrequires_openai_auth=false\n`,
  );
  await mkdir(root + "/market/.agents/plugins", { recursive: true });
  await cp(
    "examples/test-plugin-marketplace/plugins/newbot-test-plugin",
    root + "/market/plugin",
    {
      recursive: true,
    },
  );
  await writeFile(
    root + "/market/.agents/plugins/marketplace.json",
    JSON.stringify({
      name: "newbot-local-tests",
      plugins: [
        {
          name: "newbot-test-plugin",
          source: { source: "local", path: "./plugin" },
        },
      ],
    }),
  );
  const add = spawnSync(
    resolve("node_modules/.bin/codex"),
    ["plugin", "marketplace", "add", root + "/market", "--json"],
    {
      env: { PATH: process.env.PATH, HOME: root, CODEX_HOME: root },
      encoding: "utf8",
    },
  );
  assert.equal(add.status, 0, add.stderr);
  const codex = new Codex(root + "/work", () => ({
    CODEX_HOME: root,
    HOME: root,
  }));
  ctx = await createServer({
    providerRuntime: null,
    directory: root + "/data",
    cwd: root + "/work",
    codex,
    password: "synthetic-session-login",
    origins: ["http://localhost:3100"],
  });
  await codex.start();
  assert.equal(codex.state, "ready");
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost:3100" },
    payload: { password: "synthetic-session-login" },
  });
  const headers = {
    origin: "http://localhost:3100",
    cookie: login.headers["set-cookie"].toString().split(";")[0],
  };
  const post = async (url, payload) => {
    const r = await ctx.app.inject({ method: "POST", url, headers, payload });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const action = (p) => post("/api/agent/action", p);
  const get = async (url) => (await ctx.app.inject({ url, headers })).json();
  const until = async (test) => {
    for (let i = 0; i < 200; i++) {
      if (await test()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw Error("native completion timeout");
  };
  let first, plugin;
  await check(
    "configured marketplace discovery, install and private plugin detail through product API",
    async () => {
      const list = await action({ action: "plugin/list" });
      assert.equal(list.available, true);
      plugin = list.entries.find((p) => p.name === "newbot-test-plugin");
      assert.ok(plugin);
      assert.ok(!JSON.stringify(list).includes(root));
      await action({ action: "plugin/install", id: plugin.id });
      const detail = await action({ action: "plugin/read", id: plugin.id });
      assert.equal(detail.skills.length, 1);
    },
  );
  await check(
    "product run sends a native plugin mention and native capability instructions reach the model",
    async () => {
      first = await post("/api/agent/run", {
        requestId: randomUUID(),
        text: "PRODUCT_HISTORY_ONE",
        provider: "probe_a",
        model: "gpt-6.1-sol",
        plugins: [plugin.id],
      });
      await until(() => !codex.active.has(first.threadId));
      assert.ok(
        requests[0].pluginCapabilities,
        "Native runtime must attach plugin capability instructions",
      );
      const history = await get("/api/threads/" + first.threadId);
      assert.ok(
        history.turns[0].items
          .find((i) => i.type === "userMessage")
          .pluginRefs.some((p) => p.id === plugin.id),
      );
    },
  );
  await check(
    "same native thread resumes on gateway B with full history and approval setting",
    async () => {
      const other = await post("/api/agent/run", {
        requestId: randomUUID(),
        provider: "probe_a",
        model: "gpt-6.1-sol",
        text: "PRODUCT_HOLD_OTHER",
      });
      assert.ok(codex.active.has(other.threadId));

      await action({
        action: "session/update",
        threadId: first.threadId,
        expectedRevision: 0,
        provider: "probe_b",
        model: "gpt-6.1-sol",
        effort: "medium",
        approval: "full",
      });
      assert.ok(
        codex.active.has(other.threadId),
        "another running thread must remain active while the target is rebound",
      );
      releaseHeld();
      await until(() => !codex.active.has(other.threadId));
      const run = await post("/api/agent/run", {
        requestId: randomUUID(),
        threadId: first.threadId,
        runtimeRevision: 1,
        provider: "probe_b",
        text: "PRODUCT_HISTORY_TWO",
      });
      assert.equal(run.threadId, first.threadId);
      await until(() => !codex.active.has(first.threadId));
      assert.equal(requests.at(-1).path, "/b/responses");
      assert.ok(requests.at(-1).first && requests.at(-1).second);
      const history = await get("/api/threads/" + first.threadId);
      assert.equal(history.turns.length, 2);
      assert.ok(
        history.turns[0].startedAt > 0 && history.turns[0].durationMs >= 0,
      );
      assert.equal(history.runtime.approval, "full");
      assert.equal(history.runtime.provider, "probe_b");
    },
  );
  await check(
    "native same-thread approval updates and persisted gateway default",
    async () => {
      await action({
        action: "session/update",
        threadId: first.threadId,
        expectedRevision: 1,
        approval: "review",
      });
      const config = await get("/api/config");
      const gateway = (await action({ action: "gateway/catalog" })).find(
        (g) => g.id === "probe_b",
      );
      const saved = await action({
        action: "gateway/defaults",
        expectedDefaultRevision: gateway.defaultRevision,
        id: "probe_b",
        model: "gpt-6.1-sol",
        makeDefault: true,
        expectedRevision: config.configuration.revision,
      });
      assert.equal(saved.state, "applied");
      const native = await codex.call("config/read", {
        cwd: root + "/work",
        includeLayers: true,
      });
      assert.equal(native.config.model_provider, "probe_b");
      assert.match(
        await readFile(root + "/newbot_gateway_probe_b.config.toml", "utf8"),
        /model = "gpt-6.1-sol"/,
      );
    },
  );
  await check(
    "native plugin disable removes runtime skill and product rejects stale selection",
    async () => {
      const settings = await get("/api/config");
      await action({
        action: "plugin/enabled",
        id: plugin.id,
        enabled: false,
        expectedRevision: settings.configuration.revision,
      });
      const skills = await codex.call("skills/list", {
        cwds: [root + "/work"],
        forceReload: true,
      });
      assert.ok(
        !skills.data
          .flatMap((d) => d.skills)
          .some((s) => s.name.startsWith("newbot-test-plugin:") && s.enabled),
      );
      const before = requests.length;
      const rejected = await ctx.app.inject({
        method: "POST",
        url: "/api/agent/run",
        headers,
        payload: {
          requestId: randomUUID(),
          threadId: first.threadId,
          plugins: [plugin.id],
          text: "disabled plugin",
        },
      });
      assert.equal(rejected.statusCode, 400, rejected.body);
      assert.equal(requests.length, before);
      await action({ action: "plugin/uninstall", id: plugin.id });
    },
  );
  if (process.env.NATIVE_APPROVALS !== "0") {
    const approvals = [];
    codex.on("approval", (request) => {
      approvals.push({
        threadId: request.params.threadId,
        method: request.method,
      });
      void ctx.service.handle("approval/respond", {
        id: request.id,
        allow: false,
      });
    });
    for (const [name, approval] of [
      ["FULL", "full"],
      ["ASK", "ask"],
      ["REVIEW", "review"],
    ])
      await check("native command policy " + name, async () => {
        const run = await post("/api/agent/run", {
          requestId: randomUUID(),
          text: "PRODUCT_POLICY_" + name,
          approval,
          model: "gpt-6.1-sol",
          provider: "probe_b",
        });
        await until(() => !codex.active.has(run.threadId));
        const history = await get("/api/threads/" + run.threadId),
          command = history.turns[0].items.find(
            (i) => i.type === "commandExecution",
          );
        if (name === "ASK") {
          assert.ok(approvals.some((a) => a.threadId === run.threadId));
          assert.ok(!command || command.status === "declined");
        } else {
          assert.ok(command, "native command execution must be present");
          assert.ok(
            !approvals.some((a) => a.threadId === run.threadId),
            "policy should not request manual approval",
          );
          assert.match(command.aggregatedOutput || "", /NEWBOT_POLICY_PROOF/);
        }
        if (name === "REVIEW")
          assert.ok(
            policyReviews.length > 0,
            "native auto-review must request its own assessment",
          );
      });
  }
  await check(
    "native gateway creation saves an encrypted key and Codex reloads only its generated environment reference",
    async () => {
      const settings = await get("/api/config"),
        requestId = randomUUID(),
        secret = "SYNTHETIC_NATIVE_GATEWAY_KEY_02";
      const ticket = await post("/api/credentials/requests", {
        operation: "provider.save",
        requestId,
        expectedRevision: settings.configuration.revision,
        name: "Native private gateway",
        baseUrl: "https://gateway-fixture.invalid/v1",
        retention: "encrypted",
      });
      assert.equal(ticket.state, "waiting");
      const sent = await ctx.app.inject({
        method: "POST",
        url: `/api/credentials/${requestId}/input`,
        headers: { ...headers, "content-type": "application/octet-stream" },
        payload: Buffer.from(secret),
      });
      assert.equal(sent.statusCode, 200, sent.body);
      assert.equal(sent.json().state, "succeeded", sent.body);
      assert.equal(sent.json().applied, true);
      const file = await readFile(root + "/config.toml", "utf8");
      assert.ok(!file.includes(secret));
      assert.match(file, /NEWBOT_CREDENTIAL_KEY_/);
      const after = await get("/api/config");
      assert.ok(!JSON.stringify(after).includes(secret));
      assert.equal(
        after.configuration.providers.find((p) => p.id === ticket.targetId)
          .managedCredential.applied,
        true,
      );
    },
  );
  await check(
    "native personal skill uninstall removes real discovery and preserves an archived copy",
    async () => {
      const list = await ctx.service.skills.list();
      const skill = list.skills.find((s) => s.name === "native-personal");
      assert.ok(skill, "personal fixture must be discovered natively");
      assert.equal(skill.removable, true);
      const doc = await ctx.service.skills.read(skill.id);
      await action({
        action: "skills/uninstall",
        id: skill.id,
        sha256: doc.sha256,
      });
      assert.ok(
        !(await ctx.service.skills.list()).skills.some(
          (s) => s.id === skill.id,
        ),
      );
      const { readdir } = await import("node:fs/promises");
      assert.equal((await readdir(root + "/newbot-removed-skills")).length, 1);
    },
  );
  await ctx.app.close();
  ctx = null;
  await check(
    "SQLite upgrade retains runtime settings across server restart",
    async () => {
      const restarted = new Codex(root + "/work", () => ({
        CODEX_HOME: root,
        HOME: root,
      }));
      ctx = await createServer({
    providerRuntime: null,
        directory: root + "/data",
        cwd: root + "/work",
        codex: restarted,
        password: "synthetic-session-login",
        origins: ["http://localhost:3100"],
      });
      await restarted.start();
      assert.equal(
        ctx.service.runtimeSettings.get(first.threadId).provider,
        "probe_b",
      );
      assert.equal(
        ctx.service.runtimeSettings.get(first.threadId).approval,
        "review",
      );
      const history = await ctx.service.handle("thread/resume", {
        threadId: first.threadId,
      });
      assert.equal(history.turns.length, 2);
    },
  );
  await mkdir(".issue/2026-11-09/evidence", { recursive: true });
  await writeFile(
    ".issue/2026-11-09/evidence-02/native-product-result.json",
    JSON.stringify(
      {
        version: "0.165.0",
        checks,
        requests,
        autoReviewAssessments: policyReviews.length,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  releaseHeld();
  await ctx?.app.close();
  upstream.closeAllConnections();
  await new Promise((r) => upstream.close(r));
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
