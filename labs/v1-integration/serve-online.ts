import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { createServer } from "../../server/index.js";
import { mountCopilotRuntime } from "./fastify-runtime.js";
import { preparePreview, restrictPreview } from "./online-preview.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const origin = new URL(process.env.PREVIEW_ORIGIN || "");
if (origin.protocol !== "https:" || origin.href !== origin.origin + "/")
  throw new Error("An exact HTTPS preview origin is required");
const env = parseEnv(readFileSync(join(root, ".env"), "utf8"));
process.env.CODEX_BIN = resolve(
  root,
  env.CODEX_BIN || "node_modules/.bin/codex",
);
process.env.NODE_ENV = "production";
process.env.TRUST_PROXY = "true";
// Do not inherit production storage, workspace or login overrides.
for (const name of [
  "NEWBOT_CODEX_HOME",
  "NEWBOT_WORKSPACES_HOME",
  "ADMIN_PASSWORD",
])
  delete process.env[name];
const isolated = preparePreview(root, join(root, ".data"));
const ctx = await createServer({
  ...isolated,
  origins: [origin.origin],
  webDirectory: resolve(fileURLToPath(new URL("./dist", import.meta.url))),
});
restrictPreview(ctx.app);
mountCopilotRuntime(ctx);
ctx.runtime.on("approval", (request) => {
  void ctx.service
    .handle("approval/respond", { id: request.id, allow: false })
    .catch(() => {});
});
let closing = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    void ctx.app.close().then(() => process.exit(0));
  });
try {
  await ctx.app.listen({ host: "127.0.0.1", port: 3162 });
  await ctx.runtime.start();
  console.log(
    JSON.stringify({ url: origin.origin, runtime: ctx.runtime.state }),
  );
} catch {
  await ctx.app.close();
  console.error("在线预览启动失败，持久数据已保留。");
  process.exitCode = 1;
}
