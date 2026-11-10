import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  createMetrics,
  inputSchema,
  outputSchema,
  resourceUri,
} from "./model.js";
export function createTestServer() {
  const server = new McpServer(
    { name: "newbot-test", version: "1.0.0" },
    {
      instructions:
        "A read-only test server. show_metrics provides an interactive MCP App using synthetic CPU, memory and disk data. Always label its results as simulated, never as real server measurements. echo tests ordinary MCP tool calls. No real system changes are performed.",
    },
  );
  let refreshId = 0;
  server.registerTool(
    "echo",
    {
      title: "测试 MCP 连接",
      description:
        "Echo non-sensitive text to test the MCP connection. Does not change any state.",
      inputSchema: z.object({ text: z.string().max(2000) }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ text }) => ({
      content: [{ type: "text", text }],
      structuredContent: { echo: text, server: "newbot-test" },
    }),
  );
  registerAppTool(
    server,
    "show_metrics",
    {
      title: "打开资源监控实验台",
      description:
        "Display a visual, interactive MCP App with simulated CPU, memory and disk charts. Use for testing MCP Apps UI. All data is synthetic, not actual server monitoring. App controls can refresh data or select node/time range.",
      inputSchema,
      outputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
      _meta: { ui: { resourceUri, visibility: ["model", "app"] } },
    },
    async (input) => {
      const metrics = createMetrics(input, ++refreshId);
      return {
        content: [
          {
            type: "text",
            text: `测试模拟数据（非真实服务器）：${metrics.server_id}，${metrics.range}。CPU ${metrics.summary.cpu}%，内存 ${metrics.summary.memory}%，磁盘 ${metrics.summary.disk}%。交互图表由 MCP App 展示。`,
          },
        ],
        structuredContent: metrics,
      };
    },
  );
  registerAppResource(
    server,
    "资源监控实验台",
    resourceUri,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description:
        "Interactive synthetic monitoring dashboard. Bundled dependencies; no external network required.",
    },
    async () => ({
      contents: [
        {
          uri: resourceUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: await readFile(
            new URL("./metrics.html", import.meta.url),
            "utf8",
          ),
        },
      ],
    }),
  );
  return server;
}
const server = createTestServer();
await server.connect(new StdioServerTransport());
