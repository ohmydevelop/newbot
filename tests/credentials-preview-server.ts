import { credentialFixture } from "./credential-fixture.js";
const port = Number(process.env.CREDENTIALS_TEST_PORT || 3126);
const ctx = await credentialFixture(`http://127.0.0.1:${port}`, true);
await ctx.app.listen({ host: "127.0.0.1", port });
console.log("Credentials UI fixture ready");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => void ctx.close().then(() => process.exit(0)));
