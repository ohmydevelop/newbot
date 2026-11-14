# STACK-01 技术栈复用审计与后续计划

日期：2026-11-14。范围：只读技术审计、官方资料核对与建议；本轮不安装依赖、不修改产品代码、不部署。

## 用户目标与约定
用户要求“能用不造轮子”，对照 Codex、AG-UI、MCP、MCP Apps Host、A2UI 1.0、assistant-ui、Apps SDK UI、Radix/Vercel UI SDK、Motion/Cult UI、ECharts/Monaco，确认实际采用及同层替代。保留轻量、私有化、多模型、当前Grok视觉目标。将“同级别的机子”按上下文理解为同层技术/机制；若指机器性能，本轮未做硬件对比。

预期：区分安装、实际调用、协议版本与完整功能兼容，复用须减少维护量而非并排堆叠框架。此轮没有新的运行故障复现，不能把建议当已证实缺陷。

不变量：Codex为唯一Agent Loop；一次提交一次执行；会话切换/旧响应不能污染当前状态；已保存配置及聊天可恢复；第三方App权限由宿主校验；敏感输入不进入普通聊天；UI迁移不能破坏附件、审批、A2UI、MCP Apps；保留用户已确定的Grok视觉，不因参考表提ChatGPT而自动重做外观。

## 实际采用（源码与构建证据）
| 层 | 现状 | 证据/边界 |
|---|---|---|
| Runtime | Codex app-server，npm基线0.165.0；部署使用固定源码fe2f185的补丁二进制 | server/codex.ts读取CODEX_BIN；native/codex/manifest.json列3个补丁；.env选择fe2f185-connector-ca，不将npm版本当线上原版 |
| 通信 | @ag-ui/core、encoder 1.0.4，Codex事件适配，HTTP控制+SSE/poll | server/ag-ui.ts、server/index.ts、web/store.ts；含newbot扩展，未证明任意AG-UI客户端即插即用 |
| 工具 | MCP，Codex负责原生连接；应用也使用官方client/server 2.4.0 | package-lock.json、server/mcp-apps.ts与原生运行路径；权限/凭证为宿主责任 |
| 嵌入 | ext-apps 2.0.4的AppBridge/PostMessageTransport+自研受限Host | web/components/McpApp.tsx:270/430、mcp-app-host.ts；不是从零造消息桥，也不是全功能Host |
| 动态UI | web_core/react 0.14.0官方处理器/渲染器，实际v0.9 | shared/a2ui-runtime.ts:69、Panel.tsx:2、catalog.tsx；newbot:ui/v1/v2是Catalog版本不是协议1.0；官网已列1.0，当前未升级 |
| 聊天 | React+Zustand自研消息/输入/流程/滚动/恢复，未使用assistant-ui | web/App.tsx、web/store.ts、web/components/chat；Markdown已有react-markdown/Shiki等复用 |
| 设计 | 自有CSS tokens+Tailwind+Radix，未使用Apps SDK UI | web/tokens.css、plugins.css、ui.tsx、vite.config.ts；不是完整第三方设计系统 |
| 交互 | Radix Dialog/Dropdown/Popover/Slider及原生表单控件 | web/components/ui.tsx、ActionMenu.tsx、RuntimeSelector.tsx；未使用AI SDK/shadcn作为独立组件体系 |
| 动效 | CSS transition/keyframes+reduced-motion，无Motion/Cult UI | web/shell.css、styles.css、plugins.css；无复杂动效库 |
| 图表/代码 | ECharts锁定6.1.0，Mermaid/Shiki；无Monaco | Chart.tsx、Renderer.tsx、ArtifactPreview.tsx；Shiki是高亮，不是代码编辑器 |
| 图标 | Lucide+集中自定义Grok功能轮廓 | ReferenceIcons/AppIcons/SettingsIcons/CatalogIcon；库本身不会保证业务语义、槽位及对齐 |

构建manifest实际列出Chart、McpApp、a2ui/Chat懒加载chunk及入口index-DNEjO7fH.js；上一轮部署证据证明该入口与公开站一致。本轮未重启/修改运行服务。

## 同类风险与判断
| 优先级/范围 | 状态 | 共同机制与依据 |
|---|---|---|
| P1 全聊天接assistant-ui | 待验证 | 现有Zustand所有权+防重/恢复/审批/newbot扩展，不应引入第二状态源；官方ExternalStoreRuntime适合保留现有store，但功能等价和减少代码尚未做POC |
| P1 A2UI升级 | 有代码证据 | 当前写死v0.9；历史快照与action恢复依赖版本。1.0官网支持不证明选定npm版本和现有catalog可直接替换 |
| P1 增加AI SDK AgentLoop | 有代码证据 | Codex已管理模型/工具/历史；额外推理层职责重复。若仅取UI组件需单独判断，不等同引入Loop |
| P2 多套基础样式 | 有代码证据 | 自有tokens、Radix和Grok图标已落地；Apps SDK UI默认ChatGPT视觉若直接全量引入会产生两套样式契约。实际迁移工作量待验证 |
| P2 Motion/Monaco体积与移动体验 | 待验证 | 尚无新增需求证明CSS/预览不足；没有包体或运行基准，不给虚构增量KB/性能结论 |
| MCP Apps授权/证书/安装适配 | 有代码证据 | SDK提供协议机制，产品有独立origin、凭证、审批、安装目录约束，不能靠UI库删去宿主边界 |
| 本轮外部OAuth/真实业务执行 | 不适用 | 只分析技术选型，沿用GCF-10证据边界，不重新授权或执行业务工具 |

## 建议的实施顺序（尚未实施）
1. 首选assistant-ui隔离POC：用ExternalStoreRuntime接当前Zustand消息和动作，保留Codex/AG-UI/控制接口。官方亦有react-ag-ui适配器，但当前分离控制/事件及poll回退需先验证，不能声称直接接即用。仅替换一条完整聊天路径，成功后删除对应旧基础实现；不长期并行两套状态。
2. 审计A2UI官方1.0当前发布包exports/peer及升级指南，跑旧快照双读/新版本写入、Catalog映射、增量更新/action/恢复/输入限额；不只改version字符串。依赖历史记录为线索，不能把2026-11-08旧peer冲突当当前仍存在。
3. 基础控件优先继续复用Radix，共享按钮/字段/状态约定。Apps SDK UI可独立评估其组件，仍受Groktokens约束；无证据前不整站换皮。
4. 复杂布局/手势出现时才考虑Motion；Cult仅选择确有需求的片段。新增代码编辑需求时才评估Monaco，懒加载并核对手机适配；现有只读预览继续Shiki。

验收：POC覆盖发送立即呈现/停止、流式回答/思考折叠/步骤状态、附件分块、长消息滚动、切换/断线/迟到事件、审批、MCP App、A2UI及旧会话恢复；320/390/桌面明暗主题。测量首屏压缩JS、可交互时间、长会话内存、旧自研代码删除量，再决定推广。A2UI独立协议契约与真实UI验收。不得以接入成功替代行为等价。

完成：源码/锁文件/已发布构建清单和官方文档核对完成；没有迁移代码或性能测量。后续可按上述顺序立项，不因本分析扩大为自动重构。进度见同目录stack-reuse-audit-progress.md。

## 官方依据（2026-11-14检索并打开）
- assistant-ui ExternalStoreRuntime: https://www.assistant-ui.com/docs/runtimes/custom/external-store
- assistant-ui AG-UI: https://www.assistant-ui.com/docs/runtimes/ag-ui/overview
- A2UI SDK与协议版本: https://a2ui.org/concepts/sdks/
- OpenAI Apps SDK UI定位: https://developers.openai.com/plugins/concepts/ui-guidelines
- Radix定位: https://www.radix-ui.com/primitives/docs/overview/introduction
- Vercel AI SDK: https://ai-sdk.dev/docs/introduction （用户“Vercel UI SDK”不明确；这里条件性解释为AI SDK/AI SDK UI，不混同Radix）
- Motion: https://motion.dev/docs/react
- Cult UI: https://www.cult-ui.com/
- Monaco: https://github.com/microsoft/monaco-editor

## 补充：CopilotKit（用户“Cootit. KITT.”按此理解）
官网当日核对：CopilotKit提供聊天/headless API、工具调用与状态渲染、人工介入、A2UI与MCP Apps，覆盖面比单纯聊天组件广，值得列入同等级候选。当前newbot未安装@copilotkit相关包；使用AG-UI不等于使用CopilotKit。

候选接法：Codex继续作为Agent，newbot适配AG-UI agent contract，再接CopilotKit TypeScript runtime及前端。它不必替换Codex或产生第二Agent Loop，但会与现有事件/状态/恢复/Host适配产生重叠，必须实测能删除哪些自研部分。前一轮只强调assistant-ui过窄；若要统一整个Agent前端，CopilotKit应并列评估。若只替换聊天基础组件，ExternalStoreRuntime仍是改动面较小的候选，此为代码结构推断而非性能实测。

官方当前说明TypeScript runtime可以不依赖Intelligence运行；不能说CopilotKit必须上云或全部付费。另一方面，绕过runtime直接使用生产selfManagedAgents配置被列为Enterprise Intelligence，不能拿开发配置冒充免费生产方案。选择具体版本时核对包许可证、开源功能、持久化方式与telemetry，私有化要求不自动由“支持自托管”满足。

后续POC增加CopilotKit对照，采用同一验收矩阵与数据集；不同时叠加两套聊天状态，不依据官网功能列表宣称已兼容newbot MCP Host审批/私密输入。尚未安装、接入或测量。
来源：
- https://docs.copilotkit.ai/backend/copilot-runtime
- https://docs.copilotkit.ai/a2a/concepts/architecture
- https://docs.copilotkit.ai/teams/ag2/concepts/generative-ui-overview
- https://docs.copilotkit.ai/teams/ag2/backend/self-managed-agents
