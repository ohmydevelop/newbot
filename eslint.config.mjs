import ts from "typescript-eslint";
import { catalogContractRule } from "./scripts/catalog-lint.mjs";
export default ts.config(
  {
    files: ["web/components/**/*.tsx"],
    languageOptions: {
      parser: ts.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { newbot: { rules: { "catalog-contract": catalogContractRule } } },
    rules: { "newbot/catalog-contract": "error" },
  },
  {
    files: [
      "web/components/{Settings,ExtensionsSettings,ConversationNavigation,PanelResizer,WorkbenchRail,CatalogToolbar,ProviderSettings,GatewayEditor,CatalogFilter,SkillsSettings,ExpertsSettings,ToolsSettings,ConnectorEditor,SkillReader,PrivateFieldEditor,MarketplaceSettings}.tsx",
      "web/{catalog-state,panels,panel-sizing}.ts",
    ],
    languageOptions: {
      parser: ts.parser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "JSXOpeningElement[name.name='select']",
          message:
            "目录/设置采用 CatalogFilter 或共享菜单，不能另建原生主题不一致的 select。",
        },
        {
          selector: "Literal[value='模型服务'], JSXText[value=/正在加载扩展/]",
          message: "设置统一称为模型，共享加载状态不暴露内部扩展模块名称。",
        },
        {
          selector:
            "JSXAttribute[name.name='style'] ObjectExpression Property[key.name=/^(color|background|fontFamily|transition|animation)$/]",
          message: "视觉值必须来自公共样式与设计 token。",
        },
        {
          selector:
            "JSXAttribute[name.name='className'][value.value='sidebar-plugins']",
          message: "插件管理只位于设置，聊天快捷选择由现有组件承载。",
        },
        {
          selector:
            "JSXAttribute[name.name='className'][value.value='extension-tabs']",
          message: "连接器、技能、专家是设置的平行分类。",
        },
      ],
    },
  },
);
