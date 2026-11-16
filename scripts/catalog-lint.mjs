const attribute = (node, name) =>
  node.attributes?.find(
    (a) => a.type === "JSXAttribute" && a.name.name === name,
  );
const literal = (node, name) => attribute(node, name)?.value?.value;
export const catalogContractRule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      add: "目录添加入口使用 CatalogAddButton；聊天使用与安装操作不能混用 catalog-add。",
      label: "持久配置字段必须保留可见标签；placeholder 不能代替标签。",
      legacy:
        "MCP 详情不能继承旧卡片高度与滚动容器；使用 connection-detail-body。",
      accessible: "CatalogAddButton 必须提供非空 label。",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const classes = String(literal(node, "className") || "").split(/\s+/);
        if (
          classes.includes("catalog-add") ||
          (classes.includes("catalog-create") &&
            !context.filename.endsWith("/CatalogAddButton.tsx"))
        )
          context.report({ node, messageId: "add" });
        if (
          node.name.name === "CatalogAddButton" &&
          !attribute(node, "label")?.value
        )
          context.report({ node, messageId: "accessible" });
        if (
          node.name.name === "CatalogAddButton" &&
          literal(node, "label") === ""
        )
          context.report({ node, messageId: "accessible" });
        if (
          context.filename.endsWith("/McpSettings.tsx") &&
          classes.some((c) => ["provider-row", "mcp-row"].includes(c))
        )
          context.report({ node, messageId: "legacy" });
        const field = node.parent?.parent?.openingElement;
        if (
          node.name.name === "span" &&
          String(literal(field || {}, "className") || "")
            .split(/\s+/)
            .includes("field-label")
        ) {
          const value = attribute(node, "className")?.value;
          if (
            classes.includes("sr-only") ||
            (value?.type === "JSXExpressionContainer" &&
              context.sourceCode.getText(value).includes('"sr-only"'))
          )
            context.report({ node, messageId: "label" });
        }
      },
    };
  },
};
