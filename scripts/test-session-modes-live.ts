import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Codex } from "../server/codex";
import { createServer } from "../server/index";
const root = process.env.MODE_STAGE_DIR;
if (!root)
  throw Error("MODE_STAGE_DIR must identify an isolated database copy");
const output = resolve(
  process.env.MODE_EVIDENCE_DIR || ".data/mode-verification",
);
await mkdir(output, { recursive: true });
const native = new Codex(join(root, "work"), () => ({
  CODEX_HOME: join(root, "codex"),
  HOME: root,
}));
const ctx = await createServer({
  directory: join(root, "data"),
  cwd: join(root, "work"),
  codex: native,
  password: "isolated-mode-live",
  origins: ["http://localhost:3100"],
});
const result: any = {
  scope:
    "Isolated snapshot, real configured model and existing read-only MCP; no production session/config modifications",
  checks: [],
};
let start = 0,
  firstDelta = 0;
native.on("event", (e: any) => {
  if (start && !firstDelta && e.method === "item/agentMessage/delta")
    firstDelta = Date.now() - start;
});
try {
  await native.start();
  assert.equal(native.state, "ready");
  const login = await ctx.app.inject({
    method: "POST",
    url: "/api/login",
    headers: { origin: "http://localhost:3100" },
    payload: { password: "isolated-mode-live" },
  });
  const headers = {
    origin: "http://localhost:3100",
    cookie: login.headers["set-cookie"]!.toString().split(";")[0],
  };
  const post = async (url: string, payload: any) => {
    const r = await ctx.app.inject({ method: "POST", url, headers, payload });
    assert.equal(r.statusCode, 200, r.body);
    return r.json();
  };
  const historical = ctx.db.raw
    .prepare(
      "SELECT mode, COUNT(*) as count FROM session_runtime GROUP BY mode",
    )
    .all() as Array<{ mode: string; count: number }>;
  assert(
    historical.every((row) => row.mode === "work"),
    "Use a fresh pre-migration production snapshot",
  );
  result.historicalSessionCount = historical.reduce(
    (sum, row) => sum + row.count,
    0,
  );
  result.checks.push("historical-sessions-preserve-work");
  start = Date.now();
  const run = await post("/api/agent/run", {
    requestId: randomUUID(),
    text: "只回复：验收通过。不要调用工具。",
    mode: "chat",
  });
  for (let i = 0; i < 900 && native.active.has(run.threadId); i++)
    await new Promise((r) => setTimeout(r, 200));
  assert(!native.active.has(run.threadId), "model completion timeout");
  const thread = await ctx.service.read(run.threadId);
  const turn = thread.turns.find((t: any) => t.id === run.turn?.id);
  result.run = {
    state: run.state,
    threadId: run.threadId,
    turnId: run.turn?.id,
  };
  result.turns = thread.turns.map((t: any) => ({
    id: t.id,
    status: t.status,
    error: t.error,
  }));
  assert.equal(
    turn?.status,
    "completed",
    JSON.stringify(turn?.error) || "no completed turn",
  );
  assert(
    turn?.items.some(
      (x: any) => x.type === "agentMessage" && x.text?.includes("验收通过"),
    ),
    "missing expected real model reply",
  );
  result.checks.push("real-model-chat");
  result.elapsedMs = Date.now() - start;
  result.firstTextMs = firstDelta;
  result.mode = ctx.service.runtimeSettings.get(run.threadId).mode;
  const settings: any = await ctx.service.handle("settings/read", {});
  result.availableConnectors = settings.mcp?.map((s: any) => ({
    name: s.name,
    toolCount: s.toolCount,
  }));
  const target = settings.mcp?.find((s: any) => s.toolCount > 0)?.name;
  if (target) {
    const catalog = await post("/api/agent/action", {
      action: "mode/tools/read",
      server: target,
    });
    await post("/api/agent/action", {
      action: "mode/tools/update",
      server: target,
      expectedRevision: catalog.revision,
      tools: ["list_realtime_events"],
    });
    await ctx.service.handle("thread/resume", { threadId: run.threadId });
    const definition = (await ctx.service.apps.refresh(run.threadId)).find(
      (s) => s.name === target,
    )?.tools?.list_realtime_events;
    assert(
      definition?.description?.startsWith("List realtime security events"),
      "read-only tool changed",
    );
    const query = await post("/api/agent/run", {
      threadId: run.threadId,
      requestId: randomUUID(),
      text: "只调用 list_realtime_events，参数 count=1、period=7，读取至多一条事件。然后仅回答调用成功或失败，不要输出事件记录内容。",
    });
    for (let i = 0; i < 900 && native.active.has(run.threadId); i++)
      await new Promise((r) => setTimeout(r, 200));
    assert(!native.active.has(run.threadId), "MCP query timeout");
    const queried = await ctx.service.read(run.threadId);
    const queryTurn = queried.turns.find((t) => t.id === query.turn?.id);
    assert.equal(queryTurn?.status, "completed", "real tool turn incomplete");
    const executed = queryTurn?.items.filter(
      (x: any) => x.type === "mcpToolCall",
    ) as any[];
    result.executed = executed.map((x) => ({
      tool: x.tool,
      status: x.status,
      error: !!x.error,
      isError: !!x.result?.isError,
    }));
    result.itemTypes = queryTurn?.items.map((x: any) => x.type);
    assert(
      executed.length > 0 &&
        executed.every(
          (x) =>
            x.tool === "list_realtime_events" &&
            x.status === "completed" &&
            !x.error &&
            !x.result?.isError,
        ),
      "real read-only tool was not successful",
    );
    result.checks.push("real-model-reviewed-read-only-mcp");
    result.tool = "list_realtime_events";
    result.toolCalls = executed.length;
    result.provider = ctx.service.runtimeSettings.get(run.threadId).provider;
    result.model = ctx.service.runtimeSettings.get(run.threadId).model;
  }
  result.completed = true;
} catch (error) {
  result.error = String(error);
  throw error;
} finally {
  await writeFile(
    join(output, "live-model-stage.json"),
    JSON.stringify(result, null, 2),
  );
  await native.stopAndWait();
  await ctx.app.close();
}
