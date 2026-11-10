import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { McpUiToolResultNotificationSchema } from "@modelcontextprotocol/ext-apps";
import { appToolResult } from "../server/mcp-apps.js";
const entry = resolve(".data/official-mcp-app/dist/index.js");
test(
  "unmodified official Vanilla JS App: stdio discovery, time tool, inline resource and Host result schema",
  { skip: !existsSync(entry) },
  async () => {
    const client = new Client({
      name: "newbot-official-contract",
      version: "1.0.0",
    });
    try {
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [entry, "--stdio"],
          stderr: "pipe",
        }),
      );
      const tools = await client.listTools();
      const tool = tools.tools.find((t) => t.name === "get-time")!;
      assert.equal(
        (tool._meta?.ui as any)?.resourceUri,
        "ui://get-time/mcp-app.html",
      );
      const before = Date.now();
      const first = await client.callTool({ name: "get-time", arguments: {} });
      const time = (first.structuredContent as any).time;
      assert.ok(Date.parse(time) >= before);
      assert.ok(Date.parse(time) <= Date.now());
      McpUiToolResultNotificationSchema.parse({
        method: "ui/notifications/tool-result",
        params: appToolResult(first),
      });
      const resource = await client.readResource({
        uri: "ui://get-time/mcp-app.html",
      });
      const content = resource.contents[0];
      assert.equal(content.mimeType, "text/html;profile=mcp-app");
      assert.ok("text" in content);
      if ("text" in content) {
        assert.match(content.text, /Get Server Time/);
        assert.match(content.text, /Send Message/);
        assert.match(content.text, /Open Link/);
        assert.ok(!/<script[^>]+src=/i.test(content.text));
      }
    } finally {
      await client.close();
    }
  },
);
