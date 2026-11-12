import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as httpServer } from "node:http";
import { createServer } from "../server/index.js";
import { ProviderCodex } from "./provider-fixture.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-model-capabilities-ui-"));
const upstream = httpServer((_req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      data: [
        { id: "bge-m3" },
        { id: "bge-reranker-v2-m3" },
        { id: "opaque-vector", task: "embedding" },
        { id: "deepseek-flash", task: "text-generation" },
        { id: "minimax-m3.1-flash", task: "text-generation" },
      ],
    }),
  );
});
await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
const codex = new ProviderCodex(
  `http://127.0.0.1:${(upstream.address() as any).port}`,
);
codex.config.model_provider = "secondary";
codex.config.model = "deepseek-flash";
codex.config.model_providers.secondary.name = "聊天网关";
const { app } = await createServer({
  codex,
  providerRuntime: null,
  directory,
  cwd: join(directory, "work"),
  webDirectory: process.env.UI_TEST_CANDIDATE,
  password: "capability-fixture",
  origins: ["http://127.0.0.1:3155"],
});
await app.listen({ host: "127.0.0.1", port: 3155 });
console.log("capability fixture ready");
process.once(
  "SIGTERM",
  () =>
    void app.close().then(() => {
      upstream.close();
      rmSync(directory, { recursive: true, force: true });
      process.exit(0);
    }),
);
