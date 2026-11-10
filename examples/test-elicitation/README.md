# 普通输入测试 MCP

此示例通过官方 MCP SDK 发起普通表单，填写模拟监控参数并原样返回 action/content。不会创建任务、发送通知或读取真实服务器。**不要输入密码、API Key、验证码或其他秘密。** 普通输入会返回给工具，也可能被模型看到。

```bash
npm run build:mcp-test
node dist/mcp-elicitation/server.js
```

第二条命令运行 stdio MCP，供 Codex 作为子进程启动；不是 HTTP 网页。可通过工作台 MCP 设置增加一个 stdio 连接，command 使用 Node 可执行文件的绝对路径，args 使用本项目 `dist/mcp-elicitation/server.js` 的绝对路径，tool timeout 建议 360 秒。此示例不自动修改现有配置。

让 Agent 调用 `collect_preferences` 即可显示表单。工具使用 MCP `2025-11-25` 表单修订，匹配此版本 Codex 的已验证接口；不宣称覆盖其他协议修订或输入模式。

开发者可直接运行下列流程，使用临时目录和独立 Codex Home 验证，不需要模型调用或真实凭证：

```bash
npm run test:elicitation-live
```

验收包括填写后的严格类型、取消、拒绝和服务端超时。当前产品支持范围及生命周期见 [D4.3 记录](../../docs/mcp-elicitation.md)。
