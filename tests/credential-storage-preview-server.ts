import {
  credentialFixture,
  credentialTestSecret,
} from "./credential-fixture.js";
import { ProviderCodex } from "./provider-fixture.js";
import { createServer } from "../server/index.js";
import { join } from "node:path";
const port = Number(process.env.CREDENTIAL_STORAGE_TEST_PORT || 3128),
  origin = `http://127.0.0.1:${port}`;
let current: Awaited<ReturnType<typeof createServer>>,
  generation = 0;
function install(ctx: Awaited<ReturnType<typeof createServer>>) {
  const codex = ctx.runtime as ProviderCodex;
  ctx.app.post("/api/test/credential-storage", async (req) => {
    const action = (req.body as { action?: string })?.action;
    if (action === "restart") {
      const config = structuredClone(codex.config);
      setTimeout(
        () =>
          void (async () => {
            await ctx.app.close();
            const next = new ProviderCodex(fixture.endpoint);
            next.config = config;
            current = await createServer({
    providerRuntime: null,
              directory: fixture.directory,
              cwd: join(fixture.directory, "workspace"),
              codex: next,
              password: "private-fixture-password",
              origins: [origin],
              credentialCa: fixture.cert,
            });
            install(current);
            await current.app.ready();
            await next.restart();
            generation++;
            await current.app.listen({ host: "127.0.0.1", port });
          })(),
        50,
      );
      return { restarting: true };
    }
    if (action === "fail-restart") codex.failRestart = true;
    if (action === "lose-write") codex.loseResponse = true;
    if (action === "change") codex.version++;
    return {
      generation,
      provider: ctx.vault.info(
        "provider",
        "secondary",
        codex.config,
        codex.credentialRefs,
      ),
      mcp: ctx.vault.info("mcp", "secure", codex.config, codex.credentialRefs),
      encryptedRows: Number(
        (
          ctx.db.raw
            .prepare("SELECT COUNT(*) n FROM managed_credentials")
            .get() as any
        ).n,
      ),
      nativeSecretSeen: JSON.stringify(codex.calls).includes(
        credentialTestSecret,
      ),
      dbSecretSeen: ["metadata", "audit", "runs", "managed_credentials"].some(
        (table) =>
          JSON.stringify(
            ctx.db.raw.prepare(`SELECT * FROM ${table}`).all(),
          ).includes(credentialTestSecret),
      ),
      privatePending: ctx.credentials.pending,
    };
  });
}
const fixture = await credentialFixture(origin, false, (ctx) => {
  (ctx.runtime as ProviderCodex).config.mcp_servers = {
    secure: { url: "https://mcp.example.com/mcp", enabled: true },
    local: { command: "node", args: [] },
  };
  install(ctx);
});
current = fixture;
await current.app.listen({ host: "127.0.0.1", port });
console.log("Credential storage fixture ready");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void current.app
        .close()
        .then(() => fixture.close())
        .then(() => process.exit(0)),
  );
