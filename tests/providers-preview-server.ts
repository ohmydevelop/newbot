import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as httpServer } from "node:http";
import { createServer } from "../server/index.js";
import { ProviderCodex } from "./provider-fixture.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-provider-ui-")),
  port = Number(process.env.PROVIDERS_TEST_PORT || 3113);
const upstream = httpServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify(
      req.url?.endsWith("/models")
        ? { data: [{ id: "secondary-model" }] }
        : {
            id: "resp_fixture",
            object: "response",
            status: "completed",
            output: [],
          },
    ),
  );
});
await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
const endpoint = `http://127.0.0.1:${(upstream.address() as any).port}/v1`;
const codex = new ProviderCodex(endpoint),
  { app, db } = await createServer({
    providerRuntime: null,
    directory,
    cwd: join(directory, "work"),
    codex,
    password: "providers-ui-test-password",
    origins: [`http://127.0.0.1:${port}`],
  });
app.post("/api/test/provider", async (request) => {
  const action = (request.body as any).action;
  if (action === "external") {
    codex.config.external_change = (codex.config.external_change || 0) + 1;
    codex.version++;
  } else if (action === "fail-write") codex.failWrite = true;
  else if (action === "recover-write") codex.failWrite = false;
  else if (action === "lost-response") codex.loseResponse = true;
  else if (action === "busy") codex.active.add("synthetic-task");
  else if (action === "idle") codex.active.clear();
  else if (action === "history")
    db.raw
      .prepare(
        "INSERT OR REPLACE INTO threads(id,title,provider,updated,archived) VALUES(?,?,?,?,?)",
      )
      .run("history", "历史", "secondary", Date.now(), 1);
  else if (action === "clear-history")
    db.raw.prepare("DELETE FROM threads WHERE id=?").run("history");
  else throw new Error("unknown test control");
  return { ok: true };
});
app.get("/api/test/provider-state", async () => ({
  endpoint,
  provider: codex.config.model_provider,
  model: codex.config.model,
  effort: codex.config.model_reasoning_effort,
  names: Object.fromEntries(
    Object.entries(codex.config.model_providers).map(([k, v]) => [
      k,
      (v as any).name,
    ]),
  ),
  preserved:
    codex.config.model_providers.fixture.http_headers.Authorization.includes(
      "SYNTHETIC_CONFIG_SECRET",
    ),
  restarts: codex.restarts,
}));
await app.listen({ host: "127.0.0.1", port });
console.log("Providers UI fixture ready");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void app.close().then(() => {
        upstream.close();
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
