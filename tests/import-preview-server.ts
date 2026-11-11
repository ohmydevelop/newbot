import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../server/index.js";
import { Codex } from "../server/codex.js";
import { ProviderRuntime } from "../server/provider-runtime.js";
const directory = await mkdtemp(join(tmpdir(), "newbot-import-ui-")),
  cwd = join(directory, "work");
await mkdir(cwd);
const runtime = new Codex(cwd, () => ({
  CODEX_HOME: join(directory, "codex"),
}));
const ctx = await createServer({
  directory,
  cwd,
  codex: runtime,
  providerRuntime: new ProviderRuntime(),
  password: "import-browser-fixture",
  origins: ["http://127.0.0.1:3160"],
  webDirectory: resolve(".data/issue-05-web"),
});
await runtime.start();
if (runtime.state !== "ready") throw Error(runtime.reason);
await ctx.app.listen({ host: "127.0.0.1", port: 3160 });
console.log("Import UI fixture ready");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void ctx.app
        .close()
        .then(() => rm(directory, { recursive: true, force: true }))
        .then(() => process.exit(0)),
  );
