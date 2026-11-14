import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../server/index.js";
import { McpConfigCodex } from "./mcp-config-fixture.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-mcp-config-ui-")),
  port = Number(process.env.MCP_CONFIG_TEST_PORT || 3114),
  codex = new McpConfigCodex();
const { app } = await createServer({
    providerRuntime: null,
  directory,
  cwd: join(directory, "work"),
  codex,
  password: "mcp-config-ui-password",
  origins: [`http://127.0.0.1:${port}`],
});
app.post("/api/test/mcp-config", async (request) => {
  const action = (request.body as any).action;
  if (action === "external") {
    codex.config.external_change = (codex.config.external_change || 0) + 1;
    codex.version++;
  } else if (action === "fail-write") codex.failWrite = true;
  else if (action === "recover-write") codex.failWrite = false;
  else if (action === "lost-response") codex.loseResponse = true;
  else if (action === "busy") codex.active.add("synthetic-task");
  else if (action === "idle") codex.active.clear();
  else if (action === "failed") codex.states.set("local", "failed");
  else if (action === "auth") codex.states.set("local", "auth");
  else if (action === "ok") codex.states.delete("local");
  else if (action === "oauth-complete")
    codex.emit("event", {
      method: "mcpServer/oauthLogin/completed",
      params: {},
    });
  else if (action === "fail-reload") codex.failReload = true;
  else if (action === "recover-reload") codex.failReload = false;
  else throw Error("Unknown test action");
  return { ok: true };
});
app.get("/api/test/mcp-state", async () => ({
  ids: Object.keys(codex.config.mcp_servers),
  localEnabled: codex.config.mcp_servers.local.enabled,
  localTimeout: codex.config.mcp_servers.local.tool_timeout_sec,
  preserved: codex.config.mcp_servers.local.env.TOKEN.includes(
    "SYNTHETIC_CONFIG_SECRET",
  ),
  localArgsCount: codex.config.mcp_servers.local.args.length,
  reloads: codex.reloads,
  writes: codex.calls.filter((c) => c.method === "config/batchWrite").length,
  toolCalls: codex.calls.filter((c) => c.method === "mcpServer/tool/call")
    .length,
  runtime: codex.state,
}));
await app.listen({ host: "127.0.0.1", port });
console.log("MCP config UI fixture ready");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
