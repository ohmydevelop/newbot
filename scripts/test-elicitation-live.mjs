// Isolated native Codex + synthetic local MCP. No model request or shared config writes.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Codex } from "../server/codex.ts";
import { createServer } from "../server/index.ts";
import { isMcpToolConsent } from "../shared/approvals.ts";
const directory = mkdtempSync(join(tmpdir(), "newbot-input-native-")),
  home = join(directory, "home"),
  cwd = join(directory, "work");
mkdirSync(home);
mkdirSync(cwd);
writeFileSync(
  join(home, "config.toml"),
  `[mcp_servers.input_test]\ncommand=${JSON.stringify(process.execPath)}\nargs=[${JSON.stringify(resolve("dist/mcp-elicitation/server.js"))}]\nstartup_timeout_sec=10\ntool_timeout_sec=30\n`,
  { mode: 0o600 },
);
process.env.CODEX_BIN ||= resolve("node_modules/.bin/codex");
delete process.env.ENABLE_TEST_MCP;
delete process.env.ENABLE_OFFICIAL_MCP;
const runtime = new Codex(cwd, () => ({ CODEX_HOME: home }));
let ctx,
  toolCalls = 0;
const native = runtime.call.bind(runtime);
runtime.call = async (method, params, timeout) => {
  assert.notEqual(
    method,
    "turn/start",
    "Native input validation must not invoke a model",
  );
  if (method === "mcpServer/tool/call") toolCalls++;
  return native(method, params, timeout);
};
const values = {
  task_name: "Native simulated monitor",
  server: "node-a",
  threshold: 75,
  interval: 0.5,
  notify: false,
  metrics: ["CPU", "内存"],
};
try {
  await runtime.start();
  assert.equal(runtime.state, "ready");
  ctx = await createServer({
    providerRuntime: null,
    directory: join(directory, "data"),
    cwd,
    codex: runtime,
    password: "native-input-test-password",
    origins: ["http://127.0.0.1:3100"],
  });
  const { thread } = await runtime.call("thread/start", {
    cwd,
    approvalPolicy: "on-request",
    sandbox: "workspace-write",
  });
  ctx.db.addThread(thread.id, thread.modelProvider);
  const login = await ctx.app.inject({
      method: "POST",
      url: "/api/login",
      headers: { origin: "http://127.0.0.1:3100" },
      payload: { password: "native-input-test-password" },
    }),
    headers = {
      origin: "http://127.0.0.1:3100",
      cookie: String(login.headers["set-cookie"]).split(";")[0],
    };
  const outcomes = [];
  for (const decision of ["accept", "cancel", "decline", "expiry"]) {
    const running = runtime.call("mcpServer/tool/call", {
      threadId: thread.id,
      server: "input_test",
      tool: "collect_preferences",
      arguments: {},
    });
    void running.catch(() => {});
    let pending;
    for (let i = 0; i < 100; i++) {
      const list = await ctx.service.handle("approval/list", {});
      for (const a of list)
        if (isMcpToolConsent(a))
          await ctx.service.handle("approval/respond", {
            id: a.id,
            allow: true,
          });
      pending = list.find((a) => a.params.elicitation?.form);
      if (pending) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(pending, "Native Codex did not provide a supported form request");
    assert.equal(pending.params.serverName, "input_test");
    assert.equal(pending.params.threadId, thread.id);
    if (decision === "expiry") {
      ctx.service.elicitation.pending.get(pending.id).expiresAt =
        Date.now() - 1;
      ctx.service.elicitation.expire();
    } else {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/agent/action",
        headers,
        payload: {
          action: "elicitation/respond",
          id: pending.id,
          token: pending.params.elicitation.token,
          decision,
          ...(decision === "accept" ? { content: values } : {}),
        },
      });
      assert.equal(response.statusCode, 200);
    }
    const result = await running;
    assert.notEqual(result.isError, true);
    assert.equal(result.structuredContent.simulation, true);
    assert.equal(
      result.structuredContent.action,
      decision === "expiry" ? "cancel" : decision,
    );
    assert.deepEqual(
      result.structuredContent.content,
      decision === "accept" ? values : null,
    );
    assert.equal(runtime.approvals.size, 0);
    outcomes.push(decision);
  }
  mkdirSync(".data", { recursive: true });
  writeFileSync(
    ".data/elicitation-native-result.json",
    JSON.stringify(
      {
        nativeCodex: true,
        isolatedHome: true,
        standardMcpForm: true,
        outcomes,
        typedContent: true,
        toolCalls,
        modelCalls: 0,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    "PASS native Codex and real local MCP: typed form accept/cancel/decline/expiry complete the originating tool; no model execution",
  );
} finally {
  if (ctx) await ctx.app.close();
  else await runtime.stopAndWait();
  rmSync(directory, { recursive: true, force: true });
}
