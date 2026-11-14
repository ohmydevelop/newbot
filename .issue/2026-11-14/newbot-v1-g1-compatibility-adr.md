# NB-V1-G1 ADR-001 · 隔离依赖与协议探针

2026-11-14。状态：候选组合通过初步探针；尚未批准生产切换。

## 实测决策

1. lab 精确安装 CopilotKit 1.88.0、AG-UI 1.0.2、Apps SDK UI 0.2.2、React 19.3.1、Tailwind 4.3.5、A2UI core 0.15.0 和 MCP ext-apps 2.0.4。独立 package-lock，不改变根依赖与生产服务。
2. 官方 `@a2ui/react@0.15.0` 的独立 strict-peer 安装失败：其 markdown-it 0.2.2 要求 web_core ^0.14.0，React 包要求 ^0.15.0。证据 `evidence-v1/G1/official-react-install.log`。没有使用 force/legacy-peer/override 掩盖。
3. 候选采用 `@copilotkit/a2ui-renderer@1.88.0` 的 basicCatalogV1，与官方 core 的 MessageProcessor 处理 `version: "1.0"`。仅证明协议状态更新可用；Catalog 中 Apps SDK UI 控件的交互、action 绑定和浏览器恢复尚待验证。
4. 使用公开 `@copilotkit/runtime/v2` 的 AgentRunner 与 Fetch handler。实际 connect 请求需要 RunAgentInput 形状（含 runId/messages），不是仅 threadId。后续 Fastify wrapper 必须遵循实测契约。
5. 当 identifyUser 已配置而 runner 没有 isThreadAccessible 时，上游拒绝执行并返回 500 配置错误。这是防止无作用域执行的前置要求，不能关闭 identifyUser 绕过。现有 db.owns 不足以实现多 Bot 权限。

## 依赖与轻量目标

首次安装报告 980 个包，当前 lab node_modules 约 1000 MiB（包含三套 UI/Runtime 探针所需依赖），不是浏览器首屏体积。Runtime 包直接依赖 ai 及多个 @ai-sdk 包，属于框架传递依赖。架构“不采用 Vercel AI SDK”落实为 Newbot 不直接建立第二模型执行/通信层，不能声称依赖树中完全没有该包。是否接受最终部署体积还需打包与裁剪证据。

初次安装用 ignore-scripts 检查依赖树，随后独立 npm ci（不传 ignore-scripts）通过；npm 11 默认未批准的 Scarf postinstall 未执行，未绕过安装策略。strict-peer-deps 在 lab .npmrc 中保持开启。禁用 CopilotKit telemetry 环境变量；探针 fetch guard 只能证明该进程观察到的 fetch 请求，不代表完整浏览器/网络出站审计。

## 未通过的完整 G1 门槛

Fastify 鉴权/运行中取消、真实 Codex 文本与重连、Apps SDK UI 独立宿主基本交互已验证，见 runtime-progress。前端 Action 与审批、完整 MCP App 生命周期、旧 A2UI 恢复、bundle/性能仍未完成。本 ADR 不修改生产 renderer，不引入第二框架，不改变既有凭证与数据路径。

依据：安装锁与实际包源码；[CopilotKit Runner 文档](https://docs.copilotkit.ai/backend/agent-runner)、[A2UI SDK 文档](https://a2ui.org/concepts/sdks/)、[OpenAI UI 文档](https://developers.openai.com/plugins/build/chatgpt-ui)。

## ADR-001 补充 · 实际接线后的版本/协议决策

- CopilotKit1.88的官方client固定AG-UI1.0.2与RxJS7.8.1；直接使用1.0.4/7.8.2产生两份带私有字段的类型，真正TS接线失败。lab对齐1.0.2/7.8.1，经严格安装、类型、7项HTTP测试、官方SDK和真实模型验证；根旧版本不改，不强制override。
- 新Fastify入口调用同一AgentCommands发送闭包，原生Codex仍是唯一执行循环。用户身份来自服务器cookie；不使用BuiltInAgent，不重复持久化Agent历史。
- connect完成历史需要带RUN_STARTED的恢复信封；浏览器自带的__copilotkitRequestId只校验UUID后丢弃；记录于源码与回归。
- Apps SDK UI必须按README同时导入Tailwind基础CSS；CopilotKit嵌套data-copilotkit主题通过同一Newbot变量覆盖。独立Vite页面不依赖window.openai。
- Apps SDK UI0.2.2的公式字体指向OpenAI CDN，构建映射到KaTeX0.16.47同名字体，保留包内许可。记录原始/修正网络证据。
- CopilotKit传递依赖Streamdown1.6.11默认将sanitize放在katex之后，公式实际被破坏。通过公开markdownRenderer槽位重排公开插件为raw→sanitize→katex→harden；恶意HTML/脚本协议拒绝测试通过。仅复用现有Markdown依赖，不引入Vercel Agent SDK或第二Agent框架。
- 本次仍是G1文本兼容阶段。默认CopilotChat入口约0.83MB gzip，尚未满足计划的完整性能预算；不会以安装成功代替轻量部署验收。

干净安装后的npm audit还有37个受影响包记录（24 high/6 moderate/7 low），非强制修复预演ERESOLVE。此ADR仅为功能兼容检查点，**不是生产安全批准**；详见newbot-v1-g1-dependency-plan.md。不能照audit建议退回旧CopilotKit来换取绿色报告。
