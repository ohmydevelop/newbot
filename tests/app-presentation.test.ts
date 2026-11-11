import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
const original = new Map(
  ["window", "localStorage", "sessionStorage"].map((k) => [
    k,
    Object.getOwnPropertyDescriptor(globalThis, k),
  ]),
);
const storage = () => ({ getItem: () => null, setItem() {}, removeItem() {} });
Object.assign(globalThis, {
  window: { innerWidth: 1280 },
  localStorage: storage(),
  sessionStorage: storage(),
});
const { default: McpApp } = await import("../web/components/McpApp.js");
const { ApprovalCard } = await import("../web/components/Approvals.js");
const { default: ElicitationForm } = await import(
  "../web/components/ElicitationForm.js"
);
after(() => {
  for (const [key, value] of original) {
    if (value) Object.defineProperty(globalThis, key, value);
    else Reflect.deleteProperty(globalThis, key);
  }
});
const server = "plugin_" + "a".repeat(32);
test("App reading surface contains its task title and controls, without protocol diagnostics or generated identifiers", () => {
  const html = renderToStaticMarkup(
    createElement(McpApp, {
      threadId: "t",
      itemId: "i",
      server,
      tool: "open_workspace",
      display: { serverTitle: "数据平台", toolTitle: "工作台" },
    }),
  );
  assert.match(html, /工作台/);
  assert.match(html, /aria-label="关闭应用"/);
  assert.doesNotMatch(
    html,
    /MCP App|权限与能力|原始工具结果|隔离运行|plugin_|open_workspace|app-capabilities|app-source/,
  );
  assert.match(html, /role="status"/);
});
test("consent exposes the recipient and action before optional parameters while retaining the exact payload and deny control", () => {
  const html = renderToStaticMarkup(
    createElement(ApprovalCard, {
      approval: {
        id: 1,
        method: "mcpServer/elicitation/request",
        display: { serverTitle: "数据平台", toolTitle: "读取报表" },
        params: {
          threadId: "t",
          serverName: server,
          mode: "form",
          message: server + " internal protocol message",
          _meta: {
            codex_approval_kind: "mcp_tool_call",
            tool_title: "读取报表",
            tool_params: { group_id: 17 },
          },
          requestedSchema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
        },
      },
    }),
  );
  const reading = html.replace(/<details[\s\S]*?<\/details>/g, "");
  assert.match(reading, /读取报表/);
  assert.match(reading, /接收方：数据平台/);
  assert.match(reading, /仅允许这一次/);
  assert.match(reading, /拒绝/);
  assert.doesNotMatch(reading, /plugin_|MCP|internal protocol/);
  assert.match(html, /group_id/);
  assert.match(html, /17/);
  assert.match(html, /plugin_/);
  assert.doesNotMatch(html, /<details[^>]*\sopen/);
});
test("ordinary forms identify their recipient and preserve their meaningful privacy notice", () => {
  const html = renderToStaticMarkup(
    createElement(ElicitationForm, {
      approval: {
        id: 1,
        method: "mcpServer/elicitation/request",
        display: { serverTitle: "数据平台" },
        params: {
          threadId: "t",
          serverName: server,
          elicitation: {
            token: "x",
            expiresAt: Date.now() + 60000,
            form: { message: "填写筛选条件", fields: [] },
          },
        },
      },
    }),
  );
  assert.match(html, /来自 数据平台/);
  assert.match(html, /请勿填写密码、密钥或验证码/);
  assert.doesNotMatch(html, /MCP|plugin_/);
});
