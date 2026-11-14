import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import { createServer } from "../../server/index.js";
import { isolatedProvider } from "./isolated-provider.js";
import { mountCopilotRuntime } from "./fastify-runtime.js";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const env = parseEnv(readFileSync(join(root, ".env"), "utf8"));
process.env.CODEX_BIN ||= resolve(
  root,
  env.CODEX_BIN || "node_modules/.bin/codex",
);
process.env.NODE_ENV = "test";
const isolated = isolatedProvider(root, join(root, ".data"));
const origin = "http://127.0.0.1:3161";
const password = randomBytes(24).toString("base64url");
const loginFile = join(root, ".data/v1-browser-login");
let ctx: Awaited<ReturnType<typeof createServer>> | undefined;
let ownsLoginFile = false;
let closing: Promise<void> | undefined;
function close() {
  return (closing ||= (async () => {
    try {
      await ctx?.app.close();
    } finally {
      rmSync(isolated.work, { recursive: true, force: true });
      if (ownsLoginFile && existsSync(loginFile)) rmSync(loginFile);
    }
  })());
}
try {
  // A second lab must not overwrite a running lab's login file.
  writeFileSync(loginFile, password, { mode: 0o600, flag: "wx" });
  ownsLoginFile = true;
  ctx = await createServer({
    ...isolated,
    password,
    origins: [origin],
    webDirectory: resolve(fileURLToPath(new URL("./dist", import.meta.url))),
  });
  mountCopilotRuntime(ctx);
  ctx.runtime.on("approval", (request) => {
    void ctx!.service
      .handle("approval/respond", { id: request.id, allow: false })
      .catch(() => {});
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.once(signal, () => void close().then(() => process.exit(0)));
  await ctx.app.listen({ host: "127.0.0.1", port: 3161 });
  await ctx.runtime.start();
  console.log(
    JSON.stringify({
      url: origin,
      runtime: ctx.runtime.state,
      model: isolated.model,
    }),
  );
} catch {
  await close();
  console.error(
    "隔离验证实例启动失败，临时配置已清理；请检查端口或已有验证实例。",
  );
  process.exitCode = 1;
}
