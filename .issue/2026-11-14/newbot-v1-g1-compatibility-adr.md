# NB-V1-G1 ADR-001 · 隔离依赖与协议探针

2026-11-14。状态：候选组合通过初步探针；尚未批准生产切换。

## 实测决策

1. lab 精确安装 CopilotKit 1.88.0、AG-UI 1.0.4、Apps SDK UI 0.2.2、React 19.3.1、Tailwind 4.3.5、A2UI core 0.15.0 和 MCP ext-apps 2.0.4。独立 package-lock，不改变根依赖与生产服务。
2. 官方 `@a2ui/react@0.15.0` 的独立 strict-peer 安装失败：其 markdown-it 0.2.2 要求 web_core ^0.14.0，React 包要求 ^0.15.0。证据 `evidence-v1/G1/official-react-install.log`。没有使用 force/legacy-peer/override 掩盖。
3. 候选采用 `@copilotkit/a2ui-renderer@1.88.0` 的 basicCatalogV1，与官方 core 的 MessageProcessor 处理 `version: "1.0"`。仅证明协议状态更新可用；Catalog 中 Apps SDK UI 控件的交互、action 绑定和浏览器恢复尚待验证。
4. 使用公开 `@copilotkit/runtime/v2` 的 AgentRunner 与 Fetch handler。实际 connect 请求需要 RunAgentInput 形状（含 runId/messages），不是仅 threadId。后续 Fastify wrapper 必须遵循实测契约。
5. 当 identifyUser 已配置而 runner 没有 isThreadAccessible 时，上游拒绝执行并返回 500 配置错误。这是防止无作用域执行的前置要求，不能关闭 identifyUser 绕过。现有 db.owns 不足以实现多 Bot 权限。

## 依赖与轻量目标

首次安装报告 980 个包，当前 lab node_modules 约 1000 MiB（包含三套 UI/Runtime 探针所需依赖），不是浏览器首屏体积。Runtime 包直接依赖 ai 及多个 @ai-sdk 包，属于框架传递依赖。架构“不采用 Vercel AI SDK”落实为 Newbot 不直接建立第二模型执行/通信层，不能声称依赖树中完全没有该包。是否接受最终部署体积还需打包与裁剪证据。

初次安装用 ignore-scripts 检查依赖树，随后独立 npm ci（不传 ignore-scripts）通过；npm 11 默认未批准的 Scarf postinstall 未执行，未绕过安装策略。strict-peer-deps 在 lab .npmrc 中保持开启。禁用 CopilotKit telemetry 环境变量；探针 fetch guard 只能证明该进程观察到的 fetch 请求，不代表完整浏览器/网络出站审计。

## 未通过的完整 G1 门槛

Fastify 鉴权/流式取消、真实 Codex 调用、前端 Action 与审批、Apps SDK UI 浏览器交互、MCP App 生命周期、旧 A2UI 恢复、bundle/性能均未完成。本 ADR 不修改生产 renderer，不引入第二框架，不改变既有凭证与数据路径。

依据：安装锁与实际包源码；[CopilotKit Runner 文档](https://docs.copilotkit.ai/backend/agent-runner)、[A2UI SDK 文档](https://a2ui.org/concepts/sdks/)、[OpenAI UI 文档](https://developers.openai.com/plugins/build/chatgpt-ui)。
