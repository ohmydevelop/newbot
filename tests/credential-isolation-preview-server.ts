import { credentialFixture } from "./credential-fixture.js";
const port = Number(process.env.CREDENTIAL_ISOLATION_TEST_PORT || 3131),
  origin = `http://127.0.0.1:${port}`;
const c = await credentialFixture(origin, false, (ctx) => {
  ctx.app.post("/api/test/isolation", async () => {
    const codex = ctx.runtime as any,
      thread = [...codex.threads.values()].at(-1) as any,
      turn = thread?.turns.at(-1);
    if (!turn) return { ready: false };
    const secret = "credential-fixture-private-value-ONLY-TEST";
    codex.item(
      thread.id,
      turn.id,
      {
        id: "safe-tool",
        type: "mcpToolCall",
        server: "fixture",
        tool: "safe_result",
        status: "completed",
        arguments: {},
        error: null,
        result: {
          content: [{ type: "text", text: "safe count: 3" }],
          structuredContent: { count: 3 },
          _meta: { display: "app-only" },
        },
      },
      true,
    );
    codex.item(
      thread.id,
      turn.id,
      {
        id: "failed-tool",
        type: "mcpToolCall",
        server: "fixture",
        tool: "failed_result",
        status: "failed",
        arguments: {},
        error: { message: "认证失败：" + secret },
        result: {
          content: [{ type: "text", text: secret }],
          structuredContent: { private: secret },
          _meta: { private: secret },
        },
      },
      true,
    );
    codex.finish(thread.id, "failed");
    return { ready: true, threadId: thread.id };
  });
});
await c.app.listen({ host: "127.0.0.1", port });
console.log("Isolation UI fixture ready");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => void c.close().then(() => process.exit(0)));
