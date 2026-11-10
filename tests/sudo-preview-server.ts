import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../server/index.js";
import { ProviderCodex } from "./provider-fixture.js";
import { sudoTestSecret, testSudo } from "./sudo-fixture.js";
const port = Number(process.env.SUDO_TEST_PORT || 3128),
  origin = `http://127.0.0.1:${port}`;
const directory = mkdtempSync(join(tmpdir(), "newbot-sudo-ui-"));
const codex = new ProviderCodex("https://fixture.invalid/v1");
let launched = 0,
  policy = "first";
const controls = {
  mode: "success",
  timeoutMs: 500,
  inspect: () => policy,
  launched: () => launched++,
};
const ctx = await createServer({
    providerRuntime: null,
  directory,
  cwd: join(directory, "workspace"),
  password: "sudo-ui-fixture-login",
  origins: [origin],
  codex,
  sudoIdentity: testSudo(controls),
});
ctx.app.post("/api/test/sudo", async (req) => {
  const action = (req.body as { action?: string })?.action;
  if (
    ["success", "nopass", "echo", "after", "hang", "reprompt"].includes(
      action || "",
    )
  )
    controls.mode = action!;
  if (action === "change") policy = "second";
  if (action === "expire") {
    const now = Date.now;
    try {
      Date.now = () => now() + 120_001;
      void ctx.credentials.pending;
    } finally {
      Date.now = now;
    }
  }
  return {
    launched,
    pending: ctx.credentials.pending,
    nativeSecretSeen: JSON.stringify(codex.calls).includes(sudoTestSecret),
    dbSecretSeen: ["metadata", "audit", "runs", "managed_credentials"].some(
      (t) =>
        JSON.stringify(ctx.db.raw.prepare(`SELECT * FROM ${t}`).all()).includes(
          sudoTestSecret,
        ),
    ),
    modelTurns: codex.calls.filter((c) => c.method === "turn/start").length,
  };
});
await ctx.app.listen({ host: "127.0.0.1", port });
console.log("Sudo UI fixture ready");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(
    signal,
    () =>
      void ctx.app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
