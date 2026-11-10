# A2UI 官方最小样例实验室

D5.1 的独立开发夹具，不是聊天功能入口，不使用 Codex、账号、数据库或工具权限。只监听本机回环地址，不接入 Cloudflare 分享服务。

```bash
npm ci
npm run dev:a2ui
# http://127.0.0.1:3123

npm run test:a2ui-ui
node --import tsx --test tests/a2ui-baseline.test.ts

# D5.2：本产品 React 组件与受限运行时
npm run dev:a2ui-catalog
npm run test:a2ui-catalog-ui
```

浏览器检查需要 Playwright 及 Chromium；已有环境可通过 `PLAYWRIGHT_MODULE` 和 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定。`A2UI_TEST_PORT` 可调整手动样例端口，自动浏览器检查使用随机空闲端口。

可以选择文本、按钮、双向绑定和增量更新。清空后点击“下一条消息”可以逐条执行原样例；“重放”重建运行时并清除本地操作记录和输入。按钮事件仅显示结构化结果，不发起工具或模型请求。

`official/` 的四个样例、JSON Schema 和 Apache-2.0 LICENSE 原样复制自 `@a2ui/web_core@0.14.0` npm 发布包。`manifest.json` 固定 tarball integrity、包内路径和文件 SHA-256；检查同时比对安装包原文件。不要格式化或手工修改这些上游文件。`runtime.ts` 在兼容性检查时只替换消息的 `version`；原文件保持不变。

已验证基线为 v0.9。v0.9.1 输入能执行，但 SDK 将 Surface 协议归一化为 v0.9，不能将本检查当作完整 v0.9.1 认证。详细决策、依赖限制和 D5.2 接入方式见 [D5.1 记录](../../docs/a2ui-foundation.md)。

D5.2 的独立入口使用本产品六类 React 组件、固定 Catalog、资源限额与原子更新。名称/服务器/指标/备注可填写并形成结构化本地操作结果；支持更新、只读、关闭与重建。测试包含恶意描述、过量输入、重复提交及迟到结果。此入口也只监听本机，不接入真实聊天或工具，见 [组件与限额记录](../../docs/a2ui-catalog.md)。
