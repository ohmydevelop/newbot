// Migration check: unmodified 0.165.0 creates history; patched main resumes it.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createServer } from "node:http";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prepareRuntimeIsolation } from "../server/runtime-isolation.ts";
import { codexEnvironment } from "../server/codex.ts";

const directory = await mkdtemp(join(tmpdir(), "issue001-upgrade-"));
const cwd = join(directory, "work"),
  counter = join(cwd, "once");
await mkdir(cwd);
const isolation = await prepareRuntimeIsolation(join(directory, "codex"));
const oldBinary = resolve(
  process.env.OLD_CODEX_BIN || "node_modules/.bin/codex",
);
const newBinary = resolve(
  process.env.CODEX_BIN || ".data/native/bin/codex-main-live",
);
assert.match(
  spawnSync(oldBinary, ["--version"], { encoding: "utf8" }).stdout,
  /0\.165\.0/,
);
const requests = [];
let client;
const gateway = createServer(async (req, res) => {
  let raw = "";
  for await (const part of req) raw += part;
  const body = JSON.parse(raw),
    index = requests.length;
  requests.push(body);
  const item =
    index === 0
      ? {
          type: "function_call",
          id: "fc_saved",
          call_id: "saved_call",
          name: "exec_command",
          arguments: JSON.stringify({
            cmd: "printf once >> once",
            max_output_tokens: 100,
          }),
        }
      : {
          type: "message",
          id: "message_" + index,
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: index === 1 ? "PRESERVED_OLD_REPLY" : "RESUMED_NEW_REPLY",
              annotations: [],
            },
          ],
        };
  const response = {
    id: "response_" + index,
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
await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
const config = {
  model_provider: "fixture",
  model_providers: {
    fixture: {
      name: "Fixture",
      base_url: `http://127.0.0.1:${gateway.address().port}`,
      wire_api: "responses",
      requires_openai_auth: false,
    },
  },
};
async function open(binary) {
  const child = spawn(binary, ["app-server"], {
    cwd,
    env: { ...codexEnvironment(process.env), ...isolation.env },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pending = new Map(),
    finished = new Map();
  let sequence = 0;
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (
      message.id !== undefined &&
      (message.result !== undefined || message.error)
    ) {
      const slot = pending.get(message.id);
      if (!slot) return;
      pending.delete(message.id);
      clearTimeout(slot.timer);
      if (message.error) slot.reject(Error(message.error.message));
      else slot.resolve(message.result);
    } else if (message.method === "turn/completed")
      finished.set(message.params.turn.id, message.params.turn);
    else if (message.id !== undefined)
      child.stdin.write(
        JSON.stringify({
          id: message.id,
          error: {
            code: -32601,
            message: "No interactive requests in this fixture",
          },
        }) + "\n",
      );
  });
  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++sequence,
        timer = setTimeout(() => {
          pending.delete(id);
          reject(Error("native fixture timeout: " + method));
        }, 45000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  const result = await call("initialize", {
    clientInfo: { name: "newbot_upgrade_probe", version: "1" },
    capabilities: { experimentalApi: true },
  });
  assert.equal(result.codexHome, isolation.codexHome);
  child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  return {
    call,
    finished,
    close: async () => {
      for (const slot of pending.values()) {
        clearTimeout(slot.timer);
        slot.reject(Error("fixture closed"));
      }
      pending.clear();
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      child.kill("SIGTERM");
      await exited;
      lines.close();
    },
  };
}
const complete = async (turn) => {
  const deadline = Date.now() + 45000;
  while (!client.finished.has(turn.id)) {
    if (Date.now() > deadline) throw Error("turn completion timeout");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(client.finished.get(turn.id).status, "completed");
};
try {
  client = await open(oldBinary);
  const created = await client.call("thread/start", {
    cwd,
    modelProvider: "fixture",
    model: "gpt-6.1-sol",
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    config,
  });
  const first = await client.call("turn/start", {
    threadId: created.thread.id,
    input: [
      {
        type: "text",
        text: "Run the fixture command then reply.",
        text_elements: [],
      },
    ],
  });
  await complete(first.turn);
  assert.equal(await readFile(counter, "utf8"), "once");
  await client.close();
  client = await open(newBinary);
  const resumed = await client.call("thread/resume", {
    threadId: created.thread.id,
    cwd,
    modelProvider: "fixture",
    model: "gpt-6.1-sol",
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    config,
  });
  assert.equal(resumed.thread.id, created.thread.id);
  assert.ok(JSON.stringify(resumed.thread).includes("PRESERVED_OLD_REPLY"));
  const next = await client.call("turn/start", {
    threadId: created.thread.id,
    input: [
      { type: "text", text: "Continue from saved history.", text_elements: [] },
    ],
  });
  await complete(next.turn);
  assert.equal(requests.length, 3);
  assert.equal(await readFile(counter, "utf8"), "once");
  assert.ok(JSON.stringify(requests[2].input).includes("PRESERVED_OLD_REPLY"));
  assert.ok(
    requests[2].input.some(
      (item) =>
        item.type === "function_call_output" && item.call_id === "saved_call",
    ),
  );
  const evidence = {
    oldVersion: "0.165.0",
    newBinary,
    checks: [
      "patched main restores the exact native thread created by 0.165.0",
      "prior answer and executed tool output survive in the new model request",
      "history restoration does not re-execute the original tool",
    ],
    upstream: "synthetic loopback Responses gateway",
  };
  await writeFile(
    resolve(".issue/2026-11-11/evidence-issue-001/upgrade-native.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify({ passed: evidence.checks.length }));
} finally {
  await client?.close();
  gateway.closeAllConnections();
  await new Promise((resolve) => gateway.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
