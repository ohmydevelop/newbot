import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { build } from "esbuild";
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
const directory = mkdtempSync(join(tmpdir(), "newbot-app-lifecycle-ui-")),
  port = Number(process.env.APP_LIFECYCLE_TEST_PORT || 3116),
  codex = new FakeCodex(),
  bundle = await build({
    entryPoints: [
      process.env.APP_HOST_TEST === "1"
        ? "tests/app-host-view.ts"
        : "tests/app-lifecycle-view.ts",
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "browser",
    minify: true,
  });
const html = `<!doctype html><html><body><script type="module">${bundle.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
let mode = "ok",
  appTools = true,
  hold = false,
  release: undefined | (() => void),
  resourceCalls = 0,
  toolCalls = 0,
  threadId = "",
  turnId = "";
const original = codex.call.bind(codex);
codex.call = (async (method: any, params: any) => {
  if (method === "mcpServer/resource/read") {
    resourceCalls++;
    if (hold) await new Promise<void>((r) => (release = r));
    if (mode === "fail") throw Error("SYNTHETIC_RESOURCE_SECRET");
    return {
      contents: [
        {
          uri: params.uri,
          mimeType:
            mode === "invalid" ? "image/svg+xml" : "text/html;profile=mcp-app",
          text:
            mode === "no-init"
              ? "<!doctype html><html>not a standard app</html>"
              : html,
        },
      ],
    };
  }
  if (method === "mcpServer/tool/call") {
    toolCalls++;
    return {
      content: [],
      structuredContent: { cpu: 42, source: params.arguments.source },
    };
  }
  const result = (await original(method, params)) as any;
  if (method === "mcpServerStatus/list" && !appTools)
    result.data[0].tools.metrics._meta.ui.visibility = ["model"];
  if (method === "turn/start") {
    threadId = params.threadId;
    turnId = result.turn.id;
    setTimeout(() => {
      for (const [id, cpu] of [
        ["first", 25],
        ["second", 75],
      ] as const)
        codex.item(
          threadId,
          turnId,
          {
            id,
            type: "mcpToolCall",
            server: "test-server",
            tool: "metrics",
            arguments: { source: id },
            status: "completed",
            ...(id === "second"
              ? { mcpAppUi: { resourceUri: "ui://metrics" } }
              : {}),
            result: { content: [], structuredContent: { cpu, source: id } },
          },
          true,
        );
      codex.finish(threadId);
    }, 100);
  }
  return result;
}) as typeof codex.call;
const { app, service } = await createServer({
    providerRuntime: null,
  directory,
  cwd: join(directory, "work"),
  codex,
  password: "app-lifecycle-ui-password",
  origins: [`http://127.0.0.1:${port}`],
});
app.post("/api/test/app-lifecycle", async (request) => {
  const action = (request.body as any).action;
  if (["ok", "fail", "invalid", "no-init"].includes(action)) {
    mode = action;
    if (action === "ok") appTools = true;
  } else if (action === "no-app-tools") appTools = false;
  else if (action === "hold") hold = true;
  else if (action === "release") {
    hold = false;
    release?.();
    release = undefined;
  } else if (action === "expire") {
    for (const r of service.apps.records.values())
      if (r.itemId === "first") r.expires = Date.now() - 1;
  } else if (action === "revoke") service.apps.clear();
  else throw Error("Unknown lifecycle action");
  return { ok: true };
});
app.get("/api/test/app-state", async () => ({
  records: service.apps.records.size,
  leases: [...service.apps.records.values()].map((r) => ({
    token: r.token,
    itemId: r.itemId,
    expires: r.expires,
  })),
  resourceCalls,
  toolCalls,
  threadId,
  turnId,
  modelCalls: codex.calls.filter((c) => c.method === "turn/start").length,
}));
await app.listen({ host: "127.0.0.1", port });
console.log("App lifecycle UI fixture ready");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    hold = false;
    release?.();
    void app.close().then(() => {
      rmSync(directory, { recursive: true, force: true });
      process.exit(0);
    });
  });
