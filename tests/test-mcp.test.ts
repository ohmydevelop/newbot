import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { resolve } from "node:path";
import { outputSchema, resourceUri } from "../examples/test-mcp/model.js";
test("real MCP stdio server exposes tools, validated synthetic results and a bundled App resource", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/mcp-test/server.js")],
    stderr: "pipe",
  });
  const client = new Client({ name: "newbot-contract-test", version: "1.0.0" });
  try {
    await client.connect(transport);
    const inventory = await client.listTools();
    assert.deepEqual(inventory.tools.map((t) => t.name).sort(), [
      "echo",
      "show_metrics",
    ]);
    const tool = inventory.tools.find((t) => t.name === "show_metrics")!;
    assert.equal(
      (tool._meta?.ui as { resourceUri: string })?.resourceUri,
      resourceUri,
    );
    assert.equal(tool.annotations?.readOnlyHint, true);
    const echo = await client.callTool({
      name: "echo",
      arguments: { text: "MCP connected" },
    });
    assert.deepEqual(echo.structuredContent, {
      echo: "MCP connected",
      server: "newbot-test",
    });
    const first = await client.callTool({
      name: "show_metrics",
      arguments: { server_id: "node-a", range: "1h" },
    });
    const data = outputSchema.parse(first.structuredContent);
    assert.equal(data.simulation, true);
    assert.equal(data.samples.length, 24);
    const next = outputSchema.parse(
      (
        await client.callTool({
          name: "show_metrics",
          arguments: { server_id: "node-b", range: "15m" },
        })
      ).structuredContent,
    );
    assert.equal(next.server_id, "node-b");
    assert.ok(next.refresh_id > data.refresh_id);
    assert.notDeepEqual(next.samples, data.samples);
    const invalid = await client.callTool({
      name: "show_metrics",
      arguments: { server_id: "../../secrets", range: "1h" },
    });
    assert.equal(invalid.isError, true);
    const resource = await client.readResource({ uri: resourceUri });
    const content = resource.contents[0];
    assert.equal(content.mimeType, "text/html;profile=mcp-app");
    assert.ok("text" in content);
    if ("text" in content) {
      assert.ok(content.text.includes("资源监控实验台"));
      assert.ok(content.text.includes("全部为测试数据"));
      assert.ok(!/<script\s+[^>]*src=/i.test(content.text));
      assert.ok(Buffer.byteLength(content.text) < 2 * 1024 * 1024);
    }
  } finally {
    await client.close();
  }
});

test("Codex null optional fields are adapted to the official MCP Apps result schema", async () => {
  const { McpUiToolResultNotificationSchema } = await import(
    "@modelcontextprotocol/ext-apps"
  );
  const { appToolResult } = await import("../server/mcp-apps.js");
  const native = {
    content: [{ type: "text", text: "Simulated metrics" }],
    structuredContent: { cpu: 53, nullable: null },
    _meta: null,
  };
  const normalized = appToolResult(native);
  McpUiToolResultNotificationSchema.parse({
    method: "ui/notifications/tool-result",
    params: normalized,
  });
  assert.equal(normalized.structuredContent.nullable, null);
  assert.deepEqual(
    appToolResult({ ...native, _meta: { display: "ui-only" } })._meta,
    { display: "ui-only" },
  );
  McpUiToolResultNotificationSchema.parse({
    method: "ui/notifications/tool-result",
    params: appToolResult({
      content: [],
      structuredContent: null,
      _meta: null,
    }),
  });
});
