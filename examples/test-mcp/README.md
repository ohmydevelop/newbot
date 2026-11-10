# Newbot MCP 测试 Server + MCP App

一个真实的 stdio MCP Server，使用官方 TypeScript MCP SDK 与 MCP Apps SDK。资源监控图表中的全部数据均为模拟值，不读取或修改真实服务器。

工具：

- `echo`：回显非敏感文本，验证普通 MCP 调用。
- `show_metrics`：返回 CPU / 内存 / 磁盘的结构化模拟数据，并关联 `ui://newbot-test/metrics.html`。

App 支持三台模拟服务器、15 分钟 / 1 小时 / 6 小时范围、三个指标切换和刷新。切换指标在 iframe 本地完成；刷新、服务器与范围变化通过 Host 调用 `show_metrics`，继续使用工作台的单次授权。所有依赖内联，不需要外部网络或 API Key。

## 使用当前工作台

```bash
npm run build
```

在 `.env` 中设置 `ENABLE_TEST_MCP=true`，重新启动工作台。该开关使用 Codex 的原生 CLI 配置覆盖，只对本工作台启动的 App Server 生效，不修改全局 `~/.codex/config.toml`。

在聊天中输入：

> 调用 newbot_test 的 show_metrics，展示资源监控实验台。使用 node-a 和 1h，明确说明是模拟数据。

工具完成后，聊天中自动显示可交互 App。重新打开已有对话，也会恢复 UI 资源和最新一次模型工具结果；在 App 内后续刷新的临时显示不重复写入模型上下文。

## 接入其他支持 stdio 的 MCP 客户端

```bash
npm run build:mcp-test
node dist/mcp-test/server.js
```

Codex 原生配置示例（将路径替换成实际的绝对路径）：

```toml
[mcp_servers.newbot_test]
command = "node"
args = ["/absolute/path/newbot/dist/mcp-test/server.js"]
```

不要在终端手工输入普通文本：stdio 中的 stdout 专用于 MCP 协议。

## 开发与测试

```bash
npm test
npm run check
npm run build:mcp-test
```

`tests/test-mcp.test.ts` 使用官方 MCP 客户端启动真实子进程，验证发现、工具调用、输入校验、刷新序号及内联 App 资源。`server.ts` 是 Server，`app.ts` / `app.css` 是界面，`model.ts` 定义双方共享的数据 Schema。
