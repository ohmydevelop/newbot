import { test } from "node:test";
import assert from "node:assert/strict";
import { ESLint } from "eslint";

test("catalog structural gates reject reintroduced controls, invisible labels and legacy detail containers", async () => {
  const lint = new ESLint();
  for (const [file, source, messageId] of [
    [
      "ToolsSettings",
      '<button className="primary catalog-add">新连接器</button>',
      "add",
    ],
    [
      "SkillsSettings",
      '<button className="icon-button catalog-create" />',
      "add",
    ],
    ["ExpertsSettings", "<CatalogAddButton />", "accessible"],
    [
      "GatewayEditor",
      '<label className="field-label"><span className="sr-only">名称</span><input /></label>',
      "label",
    ],
    [
      "ConnectorEditor",
      '<div className="field-label"><span className={compact ? "sr-only" : undefined}>地址</span></div>',
      "label",
    ],
    ["McpSettings", '<div className="provider-row mcp-row" />', "legacy"],
  ] as const) {
    const [result] = await lint.lintText(`const view = ${source};`, {
      filePath: `web/components/${file}.tsx`,
    });
    assert.ok(
      result.messages.some(
        (m) =>
          m.ruleId === "newbot/catalog-contract" && m.messageId === messageId,
      ),
      `${file}: ${JSON.stringify(result.messages)}`,
    );
  }
  const [valid] = await lint.lintText(
    'const view = <><CatalogAddButton label="添加专家" /><label className="field-label"><span className="field-caption">名称</span><input /></label><button className="catalog-use-button">在聊天中使用</button></>;',
    { filePath: "web/components/ExpertsSettings.tsx" },
  );
  assert.equal(valid.errorCount, 0, JSON.stringify(valid.messages));
});
