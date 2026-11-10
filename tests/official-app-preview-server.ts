// Real pinned Codex + unmodified official stdio server/HTML. Only chat history is replayed
// by FakeCodex, so browser regressions need no model invocation or shared credentials.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { Codex } from "../server/codex.js";
import { FakeCodex } from "./fixture.js";
import { createServer } from "../server/index.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-official-ui-")),
  home = join(directory, "home"),
  cwd = join(directory, "work");
mkdirSync(home);
mkdirSync(cwd);
writeFileSync(
  join(home, "config.toml"),
  `[mcp_servers.official_basic]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(resolve(".data/official-mcp-app/dist/index.js"))},"--stdio"]\nstartup_timeout_sec=10\n[mcp_servers.input_test]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(resolve("dist/mcp-elicitation/server.js"))}]\nstartup_timeout_sec=10\ntool_timeout_sec=30\n`,
  { mode: 0o600 },
);
process.env.CODEX_BIN ||= resolve("node_modules/.bin/codex");
delete process.env.ENABLE_TEST_MCP;
delete process.env.ENABLE_OFFICIAL_MCP;
const native = new Codex(cwd, () => ({ CODEX_HOME: home })),
  codex = new FakeCodex(),
  port = Number(process.env.OFFICIAL_APP_TEST_PORT || 3122),
  mappings = new Map<string, string>();
let ctx: Awaited<ReturnType<typeof createServer>> | undefined,
  threadId = "",
  resourceCalls = 0,
  toolCalls = 0,
  seededCalls = 0,
  inputCalls = 0,
  inputResult: unknown,
  mode = "ok",
  hold = false,
  release: (() => void) | undefined,
  holdCatalog = false,
  releaseCatalog: (() => void) | undefined,
  holdTools = false;
const toolWaiters: (() => void)[] = [];
const original = codex.call.bind(codex);
async function nativeThread(id: string) {
  if (!mappings.has(id)) {
    const response = await native.call("thread/start", {
      cwd,
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    mappings.set(id, response.thread.id);
  }
  return mappings.get(id)!;
}
const underlying = native.call.bind(native);
native.call = (async (method: any, params: any, timeout?: number) => {
  if (method === "turn/start")
    throw Error("Official browser regression must never call a model");
  return underlying(method, params, timeout);
}) as typeof native.call;
native.on("approval", (a) => {
  const fakeId = [...mappings].find(([, id]) => id === a.params.threadId)?.[0];
  if (!fakeId) return;
  const mapped = { ...a, params: { ...a.params, threadId: fakeId } };
  codex.approvals.set(a.id, mapped as any);
  codex.emit("approval", mapped);
});
native.on("resolved", (id) => {
  codex.approvals.delete(id);
  codex.emit("resolved", id);
});
native.on("event", (message) => {
  if (message.method === "serverRequest/resolved") {
    codex.approvals.delete(message.params.requestId);
    codex.emit("resolved", message.params.requestId);
  }
});
const respond = codex.respond.bind(codex);
codex.respond = (id, result) =>
  native.approvals.has(id) ? native.respond(id, result) : respond(id, result);
codex.call = (async (method: any, params: any) => {
  if (
    [
      "mcpServerStatus/list",
      "mcpServer/resource/read",
      "mcpServer/tool/call",
    ].includes(method)
  ) {
    if (method === "mcpServer/resource/read") {
      resourceCalls++;
      if (hold) await new Promise<void>((r) => (release = r));
      if (mode === "resource-fail")
        throw Error("SYNTHETIC_OFFICIAL_RESOURCE_FAILURE");
    }
    if (method === "mcpServerStatus/list" && params.threadId && holdCatalog)
      await new Promise<void>((r) => (releaseCatalog = r));
    if (method === "mcpServer/tool/call" && holdTools)
      await new Promise<void>((r) => toolWaiters.push(r));
    if (method === "mcpServer/tool/call") toolCalls++;
    const { originCallId: _, ...data } = params;
    return native.call(method, {
      ...data,
      ...(params.threadId
        ? { threadId: await nativeThread(params.threadId) }
        : {}),
    });
  }
  const result: any = await original(method, params);
  if (method === "turn/start") {
    threadId = params.threadId;
    void (async () => {
      const id = await nativeThread(threadId);
      for (const name of ["official-first", "official-second"]) {
        const value = await native.call("mcpServer/tool/call", {
          threadId: id,
          server: "official_basic",
          tool: "get-time",
          arguments: {},
        });
        seededCalls++;
        codex.item(
          threadId,
          result.turn.id,
          {
            id: name,
            type: "mcpToolCall",
            server: "official_basic",
            tool: "get-time",
            arguments: {},
            status: "completed",
            mcpAppUi: { resourceUri: "ui://get-time/mcp-app.html" },
            result: value,
          },
          true,
        );
        await new Promise((r) => setTimeout(r, 5));
      }
      codex.finish(threadId);
    })().catch(() => {
      codex.offline("Official fixture setup failed");
    });
  }
  return result;
}) as typeof codex.call;
try {
  await native.start();
  if (native.state !== "ready") throw Error("Native Codex did not initialize");
  ctx = await createServer({
    providerRuntime: null,
    directory: join(directory, "data"),
    cwd,
    codex,
    password: "official-app-ui-password",
    origins: [`http://127.0.0.1:${port}`],
  });
  const { app, service } = ctx;
  app.post("/api/test/official", async (request) => {
    const action = (request.body as any).action;
    if (action === "ok" || action === "resource-fail") mode = action;
    else if (action === "hold") hold = true;
    else if (action === "release") {
      hold = false;
      release?.();
      release = undefined;
    } else if (action === "hold-catalog") holdCatalog = true;
    else if (action === "release-catalog") {
      holdCatalog = false;
      releaseCatalog?.();
      releaseCatalog = undefined;
    } else if (action === "hold-tools") holdTools = true;
    else if (action === "release-tools") {
      holdTools = false;
      for (const resolve of toolWaiters.splice(0)) resolve();
    } else if (action === "idle-check") {
      await service.handle("bridge/maintenance", { enabled: true });
      await service.handle("bridge/maintenance", { enabled: false });
    } else if (action === "expire") {
      for (const r of service.apps.records.values())
        if (r.itemId === "official-first") r.expires = Date.now() - 1;
    } else if (action === "input") {
      inputResult = undefined;
      inputCalls++;
      void nativeThread(threadId)
        .then((id) =>
          native.call("mcpServer/tool/call", {
            threadId: id,
            server: "input_test",
            tool: "collect_preferences",
            arguments: {},
          }),
        )
        .then((value) => (inputResult = value.structuredContent))
        .catch(() => (inputResult = { error: true }));
    } else if (action === "restart") {
      codex.offline("测试运行时重连");
      await native.restart();
      mappings.clear();
      await codex.start();
    } else throw Error("Unknown official fixture action");
    return { ok: true };
  });
  app.get("/api/test/official-state", async () => ({
    threadId,
    resourceCalls,
    toolCalls,
    waitingTools: toolWaiters.length,
    seededCalls,
    inputCalls,
    inputResult,
    records: [...service.apps.records.values()].map((r) => ({
      token: r.token,
      itemId: r.itemId,
    })),
    modelCalls: 0,
    replayedTurns: codex.calls.filter((c) => c.method === "turn/start").length,
    inputs: service.elicitation.list(),
  }));
  await app.listen({ host: "127.0.0.1", port });
  console.log("Official MCP regression fixture ready");
} catch (error) {
  await native.stopAndWait();
  rmSync(directory, { recursive: true, force: true });
  throw error;
}
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    hold = false;
    release?.();
    holdCatalog = false;
    releaseCatalog?.();
    holdTools = false;
    for (const resolve of toolWaiters.splice(0)) resolve();
    void (async () => {
      if (ctx) await ctx.app.close();
      await native.stopAndWait();
      rmSync(directory, { recursive: true, force: true });
      process.exit(0);
    })();
  });
