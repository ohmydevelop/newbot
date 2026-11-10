import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { ConfigCodex } from "./config-fixture.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-config-ui-")),
  port = Number(process.env.CONFIG_TEST_PORT || 3112);
const codex = new ConfigCodex();
const { app } = await createServer({
    providerRuntime: null,
  directory,
  cwd: join(directory, "work"),
  codex,
  password: "config-ui-test-password",
  origins: [`http://127.0.0.1:${port}`],
});
// Test-only controls, never bundled with the product server.
app.post("/api/test/config", async (request) => {
  const action = (request.body as { action: string }).action;
  if (action === "external") {
    codex.config.model_reasoning_effort = "medium";
    codex.version++;
  } else if (action === "fail-write") codex.failWrite = true;
  else if (action === "recover-write") codex.failWrite = false;
  else if (action === "overridden") codex.overridden = true;
  else if (action === "clear-override") codex.overridden = false;
  else if (action === "fail-read") codex.failRead = true;
  else if (action === "recover-read") codex.failRead = false;
  else if (action === "lost-response") codex.loseResponse = true;
  else if (action === "busy") codex.active.add("synthetic-running-task");
  else if (action === "idle") codex.active.clear();
  else if (action === "complete") {
    for (const id of [...codex.active])
      if (codex.threads.has(id)) codex.finish(id);
  } else throw new Error("未知的测试操作");
  return { ok: true };
});
app.get("/api/test/config-state", async () => ({
  model: codex.config.model,
  effort: codex.config.model_reasoning_effort,
  writes: codex.calls.filter((c) => c.method === "config/batchWrite").length,
}));
await app.listen({ host: "127.0.0.1", port });
console.log(`Configuration UI fixture ready: http://127.0.0.1:${port}`);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
