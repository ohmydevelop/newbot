import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { inputSchema } from "./schema.js";
// Deliberately pin the form revision exposed by the tested Codex App Server.
const server = new McpServer(
  { name: "newbot-input-test", version: "1" },
  { supportedProtocolVersions: ["2025-11-25"] },
);
server.registerTool(
  "collect_preferences",
  {
    title: "测试普通输入表单",
    description:
      "Ask for non-sensitive simulated monitoring preferences. Does not create tasks or send notifications. Never enter credentials.",
    inputSchema: z.object({}),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  async (_, context) => {
    const result = await context.mcpReq.elicitInput({
      mode: "form",
      message: "请填写模拟监控配置；本次只验证普通信息输入。",
      requestedSchema: inputSchema,
    });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            simulation: true,
            action: result.action,
            content: result.action === "accept" ? result.content : null,
          }),
        },
      ],
      structuredContent: {
        simulation: true,
        action: result.action,
        content: result.action === "accept" ? result.content : null,
      },
    };
  },
);
await server.connect(new StdioServerTransport());
