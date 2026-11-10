# 普通 MCP 输入表单（D4.3）

日期：2026-11-08。使用固定 Codex 0.166.0 生成的 `McpServerElicitationRequestParams` / `Response` 类型及真实 MCP 传输验证。Codex 继续负责 MCP 协商、请求和工具执行；Bridge 只负责受限 Schema、用户输入和响应生命周期。

## 操作与边界

原生 `mcpServer/elicitation/request` 的普通 `mode: form` 会在聊天中显示来源 MCP 服务、说明、字段和最长五分钟的处理期限。提交、拒绝提供、取消填写分别对应 `accept`、`decline`、`cancel`；后两者只发送 `content: null`，不发送草稿。默认值只用于预填，不代表自动批准或自动提交。

普通表单会明确告知：**不要填写密码、API Key 或验证码；提交内容会交给 MCP 服务，并可能进入模型上下文。** 这不是私密输入通道。明确涉及凭证的字段名、标题、说明和请求文本会被拒绝；这只是拒绝明显私密请求的检查，不能保证任意文本都不含秘密。真正的私密输入及受信消费仍在 D6 完成。

工具单次授权继续使用原有空字段表单和 `codex_approval_kind: mcp_tool_call` 识别，不转为普通输入。URL、`openai/form`、`openaiForm`、未知授权类型和不符合此版本范围的 Schema 不显示可填写字段或链接，仅提供拒绝/取消。通用 `approval/respond` 的允许操作不能绕过普通输入的校验。

## 支持的有限 Schema

- 扁平 object，1–12 个字段；必填列表只引用已声明字段，不允许额外内容或原型相关属性名。
- string：长度最多 2000 字符，支持 min/maxLength。可选 email、date、date-time，以及无内嵌用户名/密码的 HTTP(S) URI。格式支持是此产品的有限校验，不宣称覆盖所有邮箱或 URI 表示。
- number / integer：有限数值及 min/max；integer 要求安全整数。不把字符串、空字符串或布尔值隐式转换成服务端数值。
- boolean：显式选择“是/否”，保留 `false`，未选择与 `false` 有区别。
- 单选：`enum`、旧版 `enumNames`、`oneOf` 的 const/title。
- 多选：string enum items 或 anyOf const/title，支持 min/maxItems、唯一值和默认项。每个选择字段最多 32 项。
- 支持默认值，但默认值同样必须通过校验。未知关键字、嵌套对象、任意数组、引用、脚本、正则 pattern 等不进入渲染器。

Schema 限制为 32 KiB UTF-8，单次提交内容限制为 16 KiB UTF-8。所有说明通过 React 文本呈现，不执行 Schema 生成的代码、不加载外部资源。字段有可见标签、关联帮助/错误、必填说明；提交失败的校验摘要可聚焦并链接到对应字段。手机输入及按钮至少 44px。

共享规则在 `shared/elicitation.ts`，服务端按原始请求的受控规则重新校验输入，客户端校验只改善交互。Bridge 不额外把表单响应值保存到 SQLite、审计、输入事件、日志、Trace 或浏览器持久存储。这不限制 MCP 服务在工具结果中返回输入；工具结果会按普通对话显示和恢复，也可能进入模型上下文。

## 生命周期与接口

每个原生请求有独立随机 token，与原请求对象、线程和请求 ID 对应。响应入口为 `POST /api/agent/action`，产品 action 为 `elicitation/respond`，携带 `id`、`token`、`decision`，仅 accept 携带 content。要求有效主站登录及合法 Origin；线程必须属于工作台。不是 App iframe 的特权入口。

服务端每秒处理到期请求，最长等待五分钟；上游工具自己的超时或取消可能更早结束请求。超时发送 native cancel，并通知页面；任务完成时取消同一 Turn 尚未完成的普通输入。原生请求已解决、进程离线及重连时清理旧状态，不让旧 token 授权新请求。编号复用会创建新 token，旧草稿不会应用到新表单。

关闭页面不会终止任务。待处理请求及原到期时间保存在常驻进程内，刷新/重连恢复同一请求，不延长期限；填写中的草稿只存在当前 React 页面，刷新后不恢复。进程重启后不假设原输入仍然有效。对提交结果不明的网络故障，客户端重新读取待处理请求，不自动重发；仍待处理时保留当前草稿，已结束时移除旧表单。两个页面只能消费一次请求。

`/api/runtime/capabilities` 新增 `elicitation`，报告普通表单、字段/选项限制、最长等待及 `sensitiveInput: false`、`urlMode: false`。旧客户端可继续拒绝普通输入；新客户端遇到没有受控表单元数据的旧后端，不自行开放任意 Schema。

## 验证

- 类型检查、构建与 152 项自动测试通过；其中新增 15 项覆盖 Schema、UTF-8 大小、严格类型、取消/拒绝/超时、原生 ID 复用、重复响应、Origin/登录/线程及私密请求元数据不下发。
- `npm run test:elicitation-ui` 的 15 项浏览器检查通过：字段与类型、焦点/错误、取消/拒绝、未知/私密/URL 请求、刷新恢复、提交前后网络故障、两个浏览器、请求更新、无浏览器时取消、超时、手机深色界面及运行时恢复。证据在 `.data/elicitation-ui/`。
- `npm run test:elicitation-live` 使用独立 Codex Home 与真实 stdio MCP。四次模拟工具调用分别验证 accept、cancel、decline、超时；返回的原始结果保留数值、false 和数组，没有创建模型 Turn。证据在 `.data/elicitation-native-result.json`。
- 回归现有 MCP Apps Host 和 SDK 交互，保留逐次工具授权与 App 隔离。测试服务同步见 [服务更新记录](test-service-update.md)。

独立测试 MCP 见 [普通输入示例](../examples/test-elicitation/README.md)，不自动加入现有分享服务或修改其 MCP 定义。下一批 D4.4 扩展官方示例和并发/拒绝/恢复回归；正式环境的统一上线验收继续留到 R1。
