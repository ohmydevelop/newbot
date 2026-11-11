import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { database } from "../server/db.js";
import { toolDisplay } from "../server/tool-display.js";
import { connectorLabel, displayLabel } from "../shared/tool-display.js";
import { elicitations } from "../server/elicitation.js";
import { FakeCodex } from "./fixture.js";
import { AgentEvents } from "../server/ag-ui.js";

test("tool labels survive reconnect without mixing thread catalogs or retaining configuration", () => {
  const root = mkdtempSync(join(tmpdir(), "newbot-tool-display-"));
  const db = database(root);
  try {
    db.addThread("a", "fixture");
    db.addThread("b", "fixture");
    const names = toolDisplay(db, (_thread, server) =>
      server === "internal" ? "数据连接" : undefined,
    );
    names.remember("a", [
      {
        name: "internal",
        env: { SECRET: "DO_NOT_STORE" },
        tools: {
          read: {
            title: "查看数据",
            description: "DO_NOT_STORE",
            _meta: { secret: "DO_NOT_STORE" },
          },
        },
      },
    ]);
    names.remember("b", [
      {
        name: "internal",
        tools: { read: { annotations: { title: "其他数据" } } },
      },
    ]);
    assert.deepEqual(names.get("a", "internal", "read"), {
      serverTitle: "数据连接",
      toolTitle: "查看数据",
    });
    assert.equal(names.get("b", "internal", "read").toolTitle, "其他数据");
    const restored = toolDisplay(db, () => "数据连接");
    assert.equal(restored.get("a", "internal", "read").toolTitle, "查看数据");
    assert.doesNotMatch(
      db.get("tool-display:a")!,
      /DO_NOT_STORE|env|description|_meta/,
    );
    assert.equal(
      restored.get("unknown", "internal", "read").toolTitle,
      undefined,
    );
    names.remember("a", [
      { name: "internal", tools: { read: { title: null } } },
    ]);
    assert.equal(
      names.get("a", "internal", "read").toolTitle,
      undefined,
      "a refreshed tool without metadata must not retain an obsolete title",
    );
    assert.equal(names.get("b", "internal", "read").toolTitle, "其他数据");
  } finally {
    db.raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("live events, approval recovery and forms share names without changing executable identity or approval parameters", () => {
  const root = mkdtempSync(join(tmpdir(), "newbot-tool-display-"));
  const db = database(root);
  const codex = new FakeCodex();
  db.addThread("thread", "fixture");
  const names = toolDisplay(db, () => "已配置连接器");
  names.remember("thread", [
    { name: "generated-id", tools: { read: { title: "读取报表" } } },
  ]);
  const forms = elicitations(codex as any, db, () => {}, names.approval);
  try {
    const events = new AgentEvents((threadId, _turn, item) =>
      names.item(threadId, item),
    );
    const output: any[] = [];
    events.on("event", (e) => output.push(e));
    events.notification({
      method: "item/started",
      params: {
        threadId: "thread",
        turnId: "turn",
        item: {
          id: "item",
          type: "mcpToolCall",
          server: "generated-id",
          tool: "read",
          arguments: { id: 7 },
          status: "inProgress",
          result: null,
          error: null,
        },
      },
    } as any);
    const item = output.find((e) => e.content?.item)?.content.item;
    assert.equal(item.display.toolTitle, "读取报表");
    assert.equal(item.server, "generated-id");
    assert.equal(item.tool, "read");
    const approval: any = {
      id: 44,
      method: "mcpServer/elicitation/request",
      params: {
        threadId: "thread",
        serverName: "generated-id",
        mode: "form",
        message: "Confirm",
        _meta: {
          codex_approval_kind: "mcp_tool_call",
          tool_title: "读取报表",
          tool_params: { id: 7 },
        },
        requestedSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    };
    codex.approvals.set(44, approval);
    const shown = forms.publicApproval(approval);
    assert.deepEqual(shown.display, {
      serverTitle: "已配置连接器",
      toolTitle: "读取报表",
    });
    assert.deepEqual(shown.params, approval.params);
    assert.equal(
      (approval as any).display,
      undefined,
      "never mutate the native approval",
    );
    assert.deepEqual(forms.list()[0], shown);
    const form = forms.publicApproval({
      ...approval,
      id: 45,
      params: {
        ...approval.params,
        _meta: null,
        requestedSchema: {
          type: "object",
          properties: { limit: { type: "integer" } },
        },
      },
    });
    assert.equal(form.display?.serverTitle, "已配置连接器");
    assert.ok(form.params.elicitation);
    assert.equal(
      codex.calls.length,
      0,
      "reading labels never calls tools or requests a model",
    );
  } finally {
    forms.close();
    db.raw.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("display metadata stays bounded plain text and unknown operations are not renamed", () => {
  assert.equal(displayLabel({ title: "invalid" }), undefined);
  assert.equal(displayLabel("  hello\n\u202eworld  "), "hello world");
  assert.equal(displayLabel("x".repeat(1000))!.length, 160);
  assert.equal(connectorLabel("plugin_" + "a".repeat(32)), "插件连接器");
  assert.equal(connectorLabel("my-connector"), "my-connector");
});
