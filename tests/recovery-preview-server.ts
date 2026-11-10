import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../server/index.js";
import { McpConfigCodex } from "./mcp-config-fixture.js";
class RecoveryCodex extends McpConfigCodex {
  restarts = 0;
  failRestart = false;
  constructor() {
    super();
    this.config.model_providers.secondary = {
      name: "备用 Provider",
      base_url: "http://127.0.0.1:9/v1",
      wire_api: "responses",
      requires_openai_auth: false,
    };
  }
  override async restart() {
    this.restarts++;
    if (this.failRestart) {
      this.failRestart = false;
      throw Error("synthetic restart failure");
    }
    await super.restart();
  }
}
const directory = mkdtempSync(join(tmpdir(), "newbot-recovery-ui-")),
  port = Number(process.env.RECOVERY_TEST_PORT || 3115),
  codex = new RecoveryCodex();
const { app } = await createServer({
    providerRuntime: null,
  directory,
  cwd: join(directory, "work"),
  codex,
  password: "recovery-ui-test-password",
  origins: [`http://127.0.0.1:${port}`],
});
app.post("/api/test/recovery", async (request) => {
  const action = (request.body as any).action;
  if (action === "external") {
    codex.config.model_reasoning_effort = "medium";
    codex.version++;
  } else if (action === "external-high") {
    codex.config.model_reasoning_effort = "high";
    codex.version++;
  } else if (action === "fail-write") codex.failWrite = true;
  else if (action === "recover-write") codex.failWrite = false;
  else if (action === "lost-response") codex.loseResponse = true;
  else if (action === "readback-fail") codex.failReadAfterWrite = true;
  else if (action === "recover-read") codex.failRead = false;
  else if (action === "fail-read") codex.failRead = true;
  else if (action === "overridden") codex.overridden = true;
  else if (action === "clear-override") codex.overridden = false;
  else if (action === "fail-restart") codex.failRestart = true;
  else if (action === "fail-reload") codex.failReload = true;
  else if (action === "recover-reload") codex.failReload = false;
  else if (action === "busy") codex.active.add("synthetic-task");
  else if (action === "idle") codex.active.clear();
  else throw Error("Unknown fixture action");
  return { ok: true };
});
app.get("/api/test/recovery-state", async () => ({
  effort: codex.config.model_reasoning_effort,
  providerName: codex.config.model_providers.secondary.name,
  mcpTimeout: codex.config.mcp_servers.local.tool_timeout_sec,
  writes: codex.calls.filter((c) => c.method === "config/batchWrite").length,
  restarts: codex.restarts,
  reloads: codex.reloads,
  runtime: codex.state,
  active: codex.active.size,
  interrupts: codex.calls.filter((c) => c.method === "turn/interrupt").length,
}));
await app.listen({ host: "127.0.0.1", port });
console.log("Recovery UI fixture ready");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
