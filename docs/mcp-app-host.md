# MCP Apps Host 能力与受限请求（D4.2）

日期：2026-11-08。本批沿用 Codex 0.166.0、官方 `@modelcontextprotocol/ext-apps` 2.0.4 和独立 origin 的受限 iframe；不增加新的工具、网络或模型权限。后续 D4.3 普通 MCP Elicitation 已完成，见 [普通输入记录](mcp-elicitation.md)；更广的官方示例矩阵继续放在 D4.4。

2026-11-11 更新：当前固定内核为 0.165.0；应用工具范围与展示改进见 `.issue/2026-11-11/` 的对应计划与验证记录。下方开发验证数量为原批次历史记录，不替代当前验证。

## 实际能力

App 主界面只显示操作目录中的可读标题、关闭和必要加载/恢复状态；协议名称、生成的连接器 ID、能力清单不占用业务阅读区。逐次授权时显示接收方和操作，原始标识与参数可展开查看。非敏感工具标题按线程保存用于历史恢复，不能作为可用性或权限的依据；执行前仍以服务端重新发现的权限为准。没有 App-visible 工具时，标准握手不宣告 `serverTools`。能力诊断继续通过受鉴权的运行能力接口提供。

标准初始化只宣告确实提供的工具调用与沙箱边界。`sandbox.permissions` 为空，连接、外部资源、嵌套 frame 和 base URI 的 CSP 域名列表为空；不宣告日志、外链、下载、聊天消息、上下文更新、额外 MCP 资源或模型 Sampling。日志通知被丢弃，不采集其正文。

宿主上下文明确 `displayMode: inline`、`availableDisplayModes: [inline]`，继续通过官方 SDK 同步主题和界面样式。申请全屏或画中画时返回真实的 `inline`，并在 App 外显示保持内嵌的原因。

共享策略在 `shared/mcp-app-host.ts`，标准类型直接使用已安装 SDK。`/api/runtime/capabilities` 的 `mcpAppHost` 报告启用状态及配置边界；每次 `/api/mcp-apps/open` 返回按 View 工具范围生成的 `hostPolicy`。这些是产品诊断元数据，不替代 MCP Apps 的标准 `ui/initialize`。客户端不会根据元数据扩大权限；标准握手和拒绝处理采用自身实现的受限策略。旧后端未返回这些诊断字段时，客户端仍按同一限制运行。

## 未开放请求的结果

| 请求                                                           | 结果与副作用                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `ui/message`、`ui/open-link`、`ui/download-file`               | 按各自标准结果 Schema 返回 `isError: true`，附固定 `reason: unsupported`、能力键和提示；不发送消息、打开页面或创建下载。 |
| `ui/update-model-context`                                      | 返回 JSON-RPC `-32601`；不以空对象冒充写入成功。                                                                         |
| `resources/read`、`resources/list`、`resources/templates/list` | 返回 JSON-RPC `-32601`；不转发额外资源请求。原始 UI HTML 仍由 Bridge 为打开 View 受控读取。                              |
| `tools/list`、`prompts/list`、`sampling/createMessage`         | 返回 JSON-RPC `-32601`；不暴露目录或触发模型。                                                                           |
| `ui/request-display-mode`                                      | 返回真实的 `inline`；不支持的模式有固定提示。                                                                            |
| 未知请求                                                       | 固定 JSON-RPC `-32601`，不拼接方法名或参数。                                                                             |
| 日志及未知通知                                                 | 丢弃；通知不伪造响应或保存正文。                                                                                         |

错误数据仅包含固定能力键、固定原因和固定提示。不把 App 提供的消息、链接、文件内容、资源 URI 或方法名拼接到宿主提示，也不加入聊天、日志或 Trace。未开放请求不会关闭有效 View，也不会替换、批准或取消正在等待的工具决定。界面只保留最近一条提示，不堆积未受信消息。

能力声明不是授权。工具依旧由服务端校验 Web Session、来源线程、Server、原结果的 UI 资源关联和 App visibility，并在申请及批准时重新发现。每次工具执行必须显式批准一次；只允许同一连接中对应用可见的工具，不以是否共享 UI 资源 URI 划定工具权限。D4.1 的过期、关闭、登出和重开行为保留。

## 开发验证

- `npm run check`、`npm test`、`npm run build` 通过；当前 137 项自动测试。新增 6 项测试直接连接真实 SDK 的 `App` 和 `AppBridge`，检查标准握手、结果 Schema、明确失败、内嵌模式、日志丢弃及无独立 App origin 的能力报告。
- `npm run test:app-host-ui` 使用临时目录、模拟工具与官方 SDK 的隔离 View，14 项浏览器检查通过。覆盖声明与诊断一致、键盘展开、受限请求无副作用、拒绝后保持连接、待审批不受干扰、逐次批准、无可用工具时降级、手机深色布局、44px 目标和网络隔离。证据在 `.data/app-host-ui/`。
- 既有 19 项生命周期浏览器检查及 MCP Apps SDK 的初始化、原始结果和单次批准交互回归通过。
- 共享测试服务更新后，读取真实 Codex 中已有的模拟监控结果，检查新策略、Cloudflare 页面的能力说明、真实初始化与受限请求。该流程不创建模型 Turn 或执行原 MCP 工具；服务记录见 [测试服务更新](test-service-update.md)。

本批不表示全部 MCP Apps 能力已支持。需要外链、下载、任意资源、聊天写入、模型调用或其他显示模式的 App 会得到明确拒绝。正式目标环境和上线整体验收仍留到 R1。
