// Explicitly invoked live verification. Copies only selected Provider configuration
// and its encrypted credential records into a short-lived, private server directory.
import assert from "node:assert/strict";
import { isolatedProvider } from "./isolated-provider.js";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { HttpAgent } from "@ag-ui/client";
import { createServer } from "../../server/index.js";
import { mountCopilotRuntime } from "./fastify-runtime.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const sourcePath = resolve(
  process.env.NEWBOT_V1_SOURCE_DATA || join(root, ".data"),
);
const env = existsSync(join(root, ".env"))
  ? parseEnv(readFileSync(join(root, ".env"), "utf8"))
  : {};
process.env.CODEX_BIN ||= resolve(
  root,
  env.CODEX_BIN || "node_modules/.bin/codex",
);
process.env.NODE_ENV = "test";
process.env.COPILOTKIT_TELEMETRY_DISABLED = "1";
process.env.DO_NOT_TRACK = "1";
let isolated: ReturnType<typeof isolatedProvider> | undefined;
let ctx: Awaited<ReturnType<typeof createServer>> | undefined;
const evidence: Record<string, unknown> = {
  kind: "real-provider",
  startedAt: new Date().toISOString(),
  passed: false,
};
const output = join(
  root,
  ".issue/2026-11-14/evidence-v1/G1/runtime-real-model.json",
);
try {
  isolated = isolatedProvider(root, sourcePath);
  const { work, directory, cwd, model } = isolated;
  evidence.model = model;
  const origin = "http://localhost:3100";
  const password = randomBytes(24).toString("base64url");
  ctx = await createServer({
    directory,
    cwd,
    password,
    origins: [origin],
    webDirectory: join(work, "no-web"),
  });
  mountCopilotRuntime(ctx);
  let dispatched = 0;
  const call = ctx.runtime.call.bind(ctx.runtime);
  ctx.runtime.call = async (method, params) => {
    if (method === "turn/start") dispatched++;
    return call(method, params);
  };
  ctx.runtime.on("approval", (request) => {
    void ctx!.service
      .handle("approval/respond", { id: request.id, allow: false })
      .catch(() => {});
  });
  await ctx.app.listen({ host: "127.0.0.1", port: 0 });
  await ctx.runtime.start();
  assert.equal(ctx.runtime.state, "ready");
  const address = ctx.app.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const login = await fetch(base + "/api/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  assert.equal(login.status, 200);
  const headers = {
    origin,
    cookie: login.headers.get("set-cookie")!.split(";")[0],
  };
  const thread = (await ctx.service.handle("thread/start", {})) as {
    id: string;
  };
  const runId = randomUUID();
  const userMessage = {
    id: randomUUID(),
    role: "user" as const,
    content:
      "这是 Newbot 新架构的连接验收。仅回复 NEWBOT_V1_REAL_OK。不要调用任何工具、命令、文件或外部操作。",
  };
  const client = new HttpAgent({
    url: base + "/api/copilot/agent/newbot/run",
    headers,
    threadId: thread.id,
  });
  client.addMessage(userMessage);
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), 150_000);
  evidence.stage = "real-run";
  try {
    await client.runAgent({ runId, abortController: abort });
  } finally {
    clearTimeout(deadline);
  }
  const reply = client.messages
    .filter((message) => message.role === "assistant")
    .map((message) => message.content)
    .join("\n");
  assert.ok(
    reply.includes("NEWBOT_V1_REAL_OK"),
    "Real provider must return the requested marker",
  );
  const receipt = ctx.agentCommands.receipt(thread.id, runId)!;
  assert.ok(receipt.turn_id);
  const observed = await ctx.agentCommands.read(thread.id);
  assert.equal(
    observed.turns.find((turn) => turn.id === receipt.turn_id)?.status,
    "completed",
  );
  evidence.stage = "reconnect";
  // SDK reconnection uses the explicit connect endpoint and never submits messages.
  const reconnect = new HttpAgent({
    url: base + "/api/copilot/agent/newbot/connect",
    headers,
    threadId: thread.id,
  });
  await reconnect.runAgent({ runId });
  assert.ok(
    reconnect.messages.some(
      (message) =>
        message.role === "assistant" &&
        String(message.content).includes("NEWBOT_V1_REAL_OK"),
    ),
  );
  // Re-send the identical operation ID and payload: receipt replay, no second model turn.
  evidence.stage = "replay";
  const replay = new HttpAgent({
    url: base + "/api/copilot/agent/newbot/run",
    headers,
    threadId: thread.id,
  });
  replay.addMessage(userMessage);
  await replay.runAgent({ runId });
  assert.equal(dispatched, 1);
  Object.assign(evidence, {
    passed: true,
    nativeTurnStarts: dispatched,
    markerMatched: true,
    stage: "completed",
    completed: true,
    sdkReconnectRestoredMessage: true,
    duplicateRunDidNotDispatch: true,
    productionDataModified: false,
    browserTested: false,
    actionsTested: false,
  });
} catch (error) {
  evidence.failure =
    error instanceof assert.AssertionError
      ? error.message
      : "Live integration failed; inspect local runtime without publishing credentials";
  process.exitCode = 1;
} finally {
  await ctx?.app.close();
  if (isolated) rmSync(isolated.work, { recursive: true, force: true });
  evidence.finishedAt = new Date().toISOString();
  evidence.isolatedDataRemoved = !isolated || !existsSync(isolated.work);
  writeFileSync(output, JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify(evidence, null, 2));
}
