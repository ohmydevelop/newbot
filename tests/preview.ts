// Separate test instance; never used by the product entrypoint or Docker image.
import { createServer } from "../server/index.js";
import { FakeCodex } from "./fixture.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
const directory = mkdtempSync(join(tmpdir(), "minimal-agent-browser-"));
const codex = new FakeCodex();
const bundled = await build({
  entryPoints: ["tests/app-view.ts"],
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  minify: true,
});
const html = `<!doctype html><html><body><script type="module">${bundled.outputFiles[0].text.replaceAll("</script", "<\\/script")}</script></body></html>`;
const original = codex.call.bind(codex);
codex.call = (async (method: any, params: any) => {
  if (method === "mcpServer/resource/read")
    return {
      contents: [
        { uri: params.uri, mimeType: "text/html;profile=mcp-app", text: html },
      ],
    };
  const result: any = await original(method, params);
  if (method === "turn/start") {
    const threadId = params.threadId;
    const turnId = result.turn.id;
    const itemId = "fixture-answer";
    setTimeout(() => {
      codex.item(
        threadId,
        turnId,
        {
          id: "fixture-app",
          type: "mcpToolCall",
          server: "test-server",
          tool: "metrics",
          arguments: {},
          mcpAppUi: { resourceUri: "ui://metrics" },
          status: "completed",
          result: { content: [], structuredContent: { cpu: 25 } },
        },
        true,
      );
      codex.item(threadId, turnId, {
        id: itemId,
        type: "agentMessage",
        text: "",
      });
      const text =
        '这是浏览器验证用的测试回复。\n\n```typescript\nconst message: string = "Hello, Minimal Agent";\nconsole.log(message);\n```\n\n公式：$E=mc^2$\n\n| 能力 | 状态 |\n| --- | --- |\n| SSE | 已验证 |\n| MCP Apps | SDK 测试 |\n\n```mermaid\nflowchart LR\n  Browser --> Bridge\n  Bridge --> Codex\n```\n\n```echarts\n{"xAxis":{"type":"category","data":["A","B","C"]},"yAxis":{"type":"value"},"series":[{"type":"bar","data":[12,24,18]}]}\n```';
      codex.delta(threadId, turnId, itemId, text);
      codex.item(
        threadId,
        turnId,
        { id: itemId, type: "agentMessage", text },
        true,
      );
      codex.finish(threadId);
    }, 300);
  }
  return result;
}) as typeof codex.call;
const { app } = await createServer({
    providerRuntime: null,
  directory,
  cwd: join(directory, "workspace"),
  password: "browser-test-password-only",
  codex,
  origins: ["http://127.0.0.1:3101"],
});
await app.listen({ host: "127.0.0.1", port: 3101 });
console.log("Isolated browser fixture: http://127.0.0.1:3101");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(
    signal,
    () =>
      void app.close().then(() => {
        rmSync(directory, { recursive: true, force: true });
        process.exit(0);
      }),
  );
