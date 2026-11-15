// Actual native Codex, SQLite/Bridge and HTTPS; synthetic Responses data only.
import assert from "node:assert/strict";
import { createServer as httpsServer } from "node:https";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.ts";
import { Codex } from "../server/codex.ts";
import { ProviderRuntime } from "../server/provider-runtime.ts";
const root = await mkdtemp(join(tmpdir(), "newbot-native-provider-cert-"));
const home = join(root, "codex"),
  cwd = join(root, "work");
await mkdir(home);
await mkdir(cwd);
process.env.ENABLE_TEST_MCP = "false";
process.env.ENABLE_OFFICIAL_MCP = "false";
let ctx,
  server,
  calls = 0;
const completed = new Map(),
  errors = new Set();
const checks = [];
try {
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      join(root, "key"),
      " -out".trim(),
      join(root, "cert"),
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost",
    ],
    { stdio: "ignore" },
  );
  if (process.env.CERT_PRIVATE_ISSUER === "1") {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        join(root, "issuer.key"),
        "-out",
        join(root, "issuer.pem"),
        "-days",
        "1",
        "-subj",
        "/CN=Private Test CA",
      ],
      { stdio: "ignore" },
    );
    await writeFile(
      join(root, "ext"),
      "subjectAltName=DNS:localhost\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n",
    );
    execFileSync(
      "openssl",
      [
        "req",
        "-new",
        "-key",
        join(root, "key"),
        "-out",
        join(root, "server.csr"),
        "-subj",
        "/CN=localhost",
      ],
      { stdio: "ignore" },
    );
    execFileSync(
      "openssl",
      [
        "x509",
        "-req",
        "-in",
        join(root, "server.csr"),
        "-CA",
        join(root, "issuer.pem"),
        "-CAkey",
        join(root, "issuer.key"),
        "-CAcreateserial",
        "-out",
        join(root, "cert"),
        "-days",
        "1",
        "-extfile",
        join(root, "ext"),
      ],
      { stdio: "ignore" },
    );
  }
  const cert = await readFile(join(root, "cert"), "utf8");
  const trust =
    process.env.CERT_PRIVATE_ISSUER === "1"
      ? await readFile(join(root, "issuer.pem"), "utf8")
      : cert;
  server = httpsServer(
    { key: await readFile(join(root, "key")), cert },
    async (req, res) => {
      if (req.url.endsWith("/models")) {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ data: [{ id: "gpt-6.1-sol" }] }));
        return;
      }
      for await (const _ of req) {
      }
      calls++;
      const item = {
        id: "msg_tls_" + calls,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [{ type: "output_text", text: "TRUSTED_TLS_REPLY" }],
      };
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        {
          type: "response.created",
          response: {
            id: "resp_tls_" + calls,
            status: "in_progress",
            output: [],
          },
        },
        { type: "response.output_item.added", output_index: 0, item },
        {
          type: "response.output_text.delta",
          output_index: 0,
          content_index: 0,
          item_id: item.id,
          delta: "TRUSTED_TLS_REPLY",
        },
        { type: "response.output_item.done", output_index: 0, item },
        {
          type: "response.completed",
          response: {
            id: "resp_tls_" + calls,
            status: "completed",
            output: [item],
            usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
          },
        },
      ])
        res.write("data: " + JSON.stringify(event) + "\n\n");
      res.end();
    },
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = `https://localhost:${server.address().port}`;
  const native = new Codex(cwd, () => ({ CODEX_HOME: home }));
  ctx = await createServer({
    directory: root,
    cwd,
    codex: native,
    providerRuntime: new ProviderRuntime(),
    password: "native-cert-fixture",
  });
  native.on("event", (e) => {
    if (e.method === "error") errors.add(e.params.turnId);
    if (e.method === "turn/completed")
      completed.set(e.params.turn.id, e.params.turn);
  });
  await native.start();
  assert.equal(native.state, "ready", native.reason);
  assert.equal(native.runtimeCapabilities.providerCustomCa, true);
  const runtime = ctx.runtime.providerRuntime;
  const base = {
    name: "TLS fixture",
    base_url: origin,
    wire_api: "responses",
    requires_openai_auth: false,
    request_max_retries: 0,
    stream_max_retries: 0,
  };
  runtime.apply(runtime.revision, [
    {
      keyPath: "model_providers",
      value: {
        untrusted: base,
        trusted: { ...base, tls_ca_certificate: trust },
        wrong_host: {
          ...base,
          base_url: origin.replace("localhost", "127.0.0.1"),
          tls_ca_certificate: trust,
        },
      },
      mergeStrategy: "replace",
    },
    { keyPath: "model_provider", value: "trusted", mergeStrategy: "replace" },
    { keyPath: "model", value: "gpt-6.1-sol", mergeStrategy: "replace" },
  ]);
  async function run(provider, reject = false) {
    const response = await native.call("thread/start", {
      modelProvider: provider,
      model: "gpt-6.1-sol",
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    const thread = response.thread;
    const turn = await native.call("turn/start", {
      threadId: thread.id,
      input: [
        {
          type: "text",
          text: "Reply TRUSTED_TLS_REPLY without tools.",
          text_elements: [],
        },
      ],
      effort: "low",
    });
    const id = turn.turn?.id || turn.id;
    const until = Date.now() + 45000;
    let interrupted = false;
    while (!completed.has(id)) {
      if (reject && errors.has(id) && !interrupted) {
        interrupted = true;
        await native.call("turn/interrupt", {
          threadId: thread.id,
          turnId: id,
        });
      }
      if (Date.now() > until) throw Error("native turn timeout " + provider);
      await new Promise((r) => setTimeout(r, 30));
    }
    return completed.get(id);
  }
  assert.equal((await run("untrusted", true)).status, "interrupted");
  assert.equal(calls, 0);
  checks.push("self-signed request fails without provider trust");
  assert.equal((await run("trusted")).status, "completed");
  assert.equal(calls, 1);
  checks.push(
    "actual native Responses stream succeeds with provider-local certificate",
  );
  assert.equal((await run("wrong_host", true)).status, "interrupted");
  assert.equal(calls, 1);
  checks.push("hostname validation remains active");
  assert.equal((await run("untrusted", true)).status, "interrupted");
  assert.equal(calls, 1);
  checks.push("trust does not leak into another provider or global TLS");
  console.log(
    JSON.stringify(
      {
        checks,
        calls,
        realNative: true,
        realTLS: true,
        privateIssuer: process.env.CERT_PRIVATE_ISSUER === "1",
        syntheticModel: true,
      },
      null,
      2,
    ),
  );
} finally {
  await ctx?.app.close();
  if (server) await new Promise((r) => server.close(r));
  await rm(root, { recursive: true, force: true });
}
