// Independent Runner process + TCP control channel + real pinned Codex. Model endpoint is synthetic.
import assert from "node:assert/strict";
import Fastify from "fastify";
import { createServer } from "node:http";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { database } from "../server/db.ts";
import { RunnerControl } from "../server/runner/control.ts";
import { runnerRoutes, runnerAuthentication } from "../server/runner/routes.ts";
const root = await mkdtemp(join(tmpdir(), "newbot-network-native-"));
const evidence = resolve(".issue/2026-11-11/evidence-runner-control");
await mkdir(evidence, { recursive: true });
const hash = (b) => createHash("sha256").update(b).digest("hex");
const binary = resolve(
  process.env.RUNNER_TEST_CODEX ||
    ".data/native/releases/fe2f185-capabilities/codex",
);
const fingerprint = hash(await readFile(binary));
const personal = join(homedir(), ".codex", "config.toml"),
  before = await readFile(personal)
    .then(hash)
    .catch(() => null);
let calls = 0,
  child,
  stderr = "",
  toolReplies = 0;
const model = createServer(async (req, res) => {
  try {
    let raw = "";
    for await (const b of req) raw += b;
    const body = JSON.parse(raw),
      i = calls++;
    const item =
      i < 2
        ? {
            type: "function_call",
            id: "fc_" + i,
            call_id: "call_" + i,
            name: i === 0 ? "exec_command" : "network_card",
            arguments: JSON.stringify(
              i === 0
                ? { cmd: "printf once >> once; pwd", max_output_tokens: 100 }
                : { message: "network" },
            ),
          }
        : {
            type: "message",
            id: "msg_" + i,
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: "NETWORK_COMPLETE",
                annotations: [],
              },
            ],
          };
    const response = {
      id: "r_" + i,
      object: "response",
      status: "completed",
      model: body.model,
      output: [item],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
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
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    res.end();
  } catch {
    res.writeHead(500);
    res.end();
  }
});
await new Promise((r) => model.listen(0, "127.0.0.1", r));
const db = database(join(root, "server")),
  control = new RunnerControl(db),
  node = control.enroll("isolated native", fingerprint),
  scope = randomUUID();
control.grant(node.id, scope, 1);
const certPath = join(root, "server-cert.pem"),
  keyPath = join(root, "server-key.pem");
await promisify(execFile)("openssl", [
  "req",
  "-x509",
  "-newkey",
  "rsa:2048",
  "-nodes",
  "-days",
  "1",
  "-subj",
  "/CN=newbot-runner-test",
  "-addext",
  "subjectAltName=IP:127.0.0.1",
  "-keyout",
  keyPath,
  "-out",
  certPath,
]);
const app = Fastify({
  https: { key: await readFile(keyPath), cert: await readFile(certPath) },
});
app.addHook("onRequest", async (req, res) =>
  runnerAuthentication(req, res, control),
);
runnerRoutes(app, control);
const address = await app.listen({ host: "127.0.0.1", port: 0 });
const cfg = {
  server: address,
  nodeId: node.id,
  token: node.token,
  binary,
  fingerprint,
  state: join(root, "client", "state"),
  codexHome: join(root, "client", "codex"),
  workspaces: join(root, "workspaces"),
  allowLocalHttp: false,
};
await writeFile(join(root, "runner.json"), JSON.stringify(cfg), {
  mode: 0o600,
});
const checks = [];
async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (child?.exitCode !== null && child?.exitCode !== undefined)
      throw Error("Runner exited: " + stderr);
    if (Date.now() > end) throw Error("native network timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}
function command(method, params) {
  const c = {
    id: randomUUID(),
    nodeId: node.id,
    scope,
    revision: 1,
    method,
    params,
  };
  control.queue(c);
  return c;
}
async function receipt(c) {
  await until(() => !["sent", "queued"].includes(control.receipt(c.id).state));
  const r = control.receipt(c.id);
  assert.equal(r.state, "completed", JSON.stringify(r));
  return r.result.result;
}
function launch() {
  child = spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      process.env.RUNNER_TEST_ENTRY || "server/runner/main.ts",
      join(root, "runner.json"),
    ],
    {
      cwd: resolve("."),
      env: {
        PATH: process.env.PATH,
        LANG: "C.UTF-8",
        HOME: homedir(),
        NODE_EXTRA_CA_CERTS: certPath,
      },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  child.stderr.on("data", (b) => (stderr += b));
}
try {
  launch();
  await until(() => control.nodes()[0].lease_until > Date.now());
  checks.push({
    name: "separate Runner process enrolled over authenticated TLS",
    pass: true,
  });
  const created = await receipt(
    command("thread/start", {
      modelProvider: "fixture",
      model: "gpt-6.1-sol",
      approvalPolicy: "never",
      sandbox: "workspace-write",
      config: {
        model_provider: "fixture",
        model_providers: {
          fixture: {
            name: "Fixture",
            base_url: `http://127.0.0.1:${model.address().port}`,
            wire_api: "responses",
            requires_openai_auth: false,
          },
        },
      },
      dynamicTools: [
        {
          type: "function",
          name: "network_card",
          description: "Test network host tool",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
          },
          deferLoading: false,
        },
      ],
    }),
  );
  assert.ok(created.thread.id);
  const threadId = created.thread.id;
  const start = command("turn/start", {
    threadId,
    input: [
      { type: "text", text: "Run fixture and show card", text_elements: [] },
    ],
  });
  const turn = await receipt(start);
  control.queue(start); // same operation identity must only return its saved receipt
  let cursor = 0,
    completed = false;
  await until(() => {
    for (const e of control.events(node.id, cursor)) {
      cursor = e.seq;
      if (e.kind === "request" && e.body.method === "item/tool/call") {
        toolReplies++;
        command("runner/toolResult", {
          requestId: e.body.id,
          result: {
            contentItems: [{ type: "inputText", text: "Host replied once" }],
            success: true,
          },
        });
      }
      if (
        e.body?.method === "turn/completed" &&
        e.body.params?.turn?.id === turn.turn.id
      ) {
        assert.equal(e.body.params.turn.status, "completed");
        completed = true;
      }
    }
    return completed;
  });
  assert.equal(
    await readFile(join(cfg.workspaces, scope, "once"), "utf8"),
    "once",
  );
  assert.equal(toolReplies, 1);
  assert.equal(calls, 3);
  checks.push({
    name: "native shell side effect and dynamic host tool execute once",
    pass: true,
  });
  const read = await receipt(
    command("thread/read", { threadId, includeTurns: true }),
  );
  assert.equal(read.thread.id, threadId);
  assert.ok(JSON.stringify(read).includes("NETWORK_COMPLETE"));
  checks.push({
    name: "original native thread and completed history readable over network",
    pass: true,
  });
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  assert.equal(child.exitCode, 0, stderr);
  assert.equal(control.nodes()[0].stopped, 1);
  checks.push({
    name: "graceful stop drains events and confirms runtime stopped",
    pass: true,
  });
  launch();
  await until(() => control.nodes()[0].epoch === 2);
  const restored = await receipt(
    command("thread/read", { threadId, includeTurns: true }),
  );
  assert.equal(restored.thread.id, threadId);
  assert.ok(JSON.stringify(restored).includes("NETWORK_COMPLETE"));
  control.queue(start);
  assert.equal(control.receipt(start.id).state, "completed");
  assert.equal(
    await readFile(join(cfg.workspaces, scope, "once"), "utf8"),
    "once",
  );
  assert.equal(calls, 3);
  checks.push({
    name: "Runner restart retains original native history and command receipts without replay",
    pass: true,
  });
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  assert.equal(child.exitCode, 0, stderr);
  const after = await readFile(personal)
    .then(hash)
    .catch(() => null);
  assert.equal(before, after);
  checks.push({ name: "personal Codex configuration unchanged", pass: true });
  await writeFile(
    join(evidence, "native-network.json"),
    JSON.stringify(
      {
        scope:
          "two processes, loopback TLS, real native binary, synthetic model; not two physical hosts",
        fingerprint,
        checks,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ checks, modelRequests: calls }, null, 2));
} finally {
  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
    await new Promise((r) => {
      child.once("exit", r);
      setTimeout(() => {
        child.kill("SIGKILL");
        r();
      }, 10000).unref();
    });
  }
  await app.close();
  model.closeAllConnections();
  await new Promise((r) => model.close(r));
  control.close();
  db.raw.close();
  await rm(root, { recursive: true, force: true });
}
