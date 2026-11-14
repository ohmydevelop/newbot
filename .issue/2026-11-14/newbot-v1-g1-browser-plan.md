# NB-V1-G1-BROWSER · 独立浏览器接线页

状态：实现前记录。承接 runtime-plan，2026-11-14。

目标：证明同一独立宿主可使用 Apps SDK UI 的真实控件，以及 CopilotKit 自带聊天呈现和消息状态，与已验证的 Runtime/真实模型通信。不是 G2 完整产品换皮。

用户已指定 Apps SDK UI 默认设计系统、ChatGPT 风格、日常聊天优先、减少说明语。本页直接使用这些明确选择；不重做视觉选择访谈。原 PRODUCT/DESIGN 记录旧线上 Grok 界面，保留作为旧版事实，正式 G2 再更新。

## 界面契约
- Mode: Operate。名称 newbot，白/中性灰与深色主题来自 Apps SDK UI；内容居中、顶部新建聊天/主题、底部输入，正文优先。
- 登录页使用官方 Input/Button；聊天使用 CopilotChat，消息权威只在 CopilotKit。应用状态仅保存登录、当前 thread ID 和主题。
- 不展示不支持的附件、前端工具或插件操作，不增加静态推荐问题和免责声明。测试范围在文档说明，不塞进聊天正文。
- thread 必须由现有服务端创建，刷新使用已确认 thread ID 恢复；显示错误且提供重试，不静默创建新聊天掩盖失败。
- 按官方组件槽位关闭不支持的控件；不靠 CSS 隐藏报错或把模型拒绝伪装成成功。

## 风险与验收
| 机制 | 状态 | 验证 |
|---|---|---|
| 共享 CSS reset/token | 待验证 | Vite 构建、浅深色、手机390/桌面1280，无横向溢出 |
| Provider发现与主动connect | 待验证 | 真浏览器登录、发送、刷新，SDK不生成另一份历史 |
| cookie/Origin与独立宿主 | 已有HTTP测试，新浏览器待验 | 同源请求/真实服务，无 window.openai 伪造 |
| 即时显示与运行按钮 | 待验证 | 点击发送后用户消息出现、运行/停止状态明确 |
| 固定追问、云服务、调试浮层 | 待验证 | 不配置suggestions/Intelligence；禁用Inspector/learning/telemetry |
| UI控件样式与交互 | 待验证 | 官方Apps SDK Input/Button键盘/错误/禁用状态 |

构建输出只写 `labs/v1-integration/dist`，隔离服务仅绑定 loopback。先类型与构建，再真实浏览器交互和批量截图；截图不能代替真实模型结果。完成后记录证据、限制和独立审查，不声明完整v1已交付。

## 首轮浏览器发现（修正前）
- 已复现：`thread/start` 不属于旧 `/api/agent/action` 白名单；新增仅 lab 注册的 `/api/v1/threads`，沿用登录/Origin、空 schema、服务端 native 创建。恢复走既有 GET threads，禁止放宽旧白名单。
- 已复现：CopilotKit 1.88 每次附带 `forwardedProps.__copilotkitRequestId`。源码确认它是 UUID 关联字段；只校验并丢弃这一字段，执行仍以 AG-UI runId 为准，其他 props/tools/context 继续拒绝。
- 已复现：只导入 Apps SDK UI CSS 时缺少 Tailwind 基础 token，官方按钮出现原生边框。按包 README 补齐 Tailwind import；组件样式与 token 已恢复。
- 有代码证据：错误后的“重试”读回同一 threadId 不会重新挂载 SDK，无法保证恢复连接。补充连接代次并仅在读回成功后重挂载 Provider；旧代次错误不得改变当前界面。
- 已复现：CopilotKit 默认深色消息面板与 Apps SDK header 背景不同，composer贴底。使用 Newbot token 对接 --background/--foreground，增加底部安全间距；输入槽位加可访问名称。第二轮集中验证这些调整。

## 私有化资源边界
浏览器网络记录已复现 Apps SDK UI 的 KaTeX CSS 指向 `cdn.openai.com/common/fonts/katex`（40次字体请求记录，包含刷新）。不将“不需要ChatGPT全局”误写成“无外网资源”。方案：lab明确锁定已有KaTeX版本，构建时将该精确字体前缀映射到包内同名字体，由Vite产出同源资源；不下载绕过浏览器限制，不改供应商文件或放宽CSP。验收同时检查构建CSS无该外链、浏览器普通聊天/公式无第三方字体请求。其他复杂第三方App出站策略属于后续独立Host验收。

## G1 界面方向契约（独立验证页）
- **THESIS**：证明一条已有执行链能由官方前端接管。用户发送、看到回复、停止和刷新恢复是本页的核心操作。
- **OWN-WORLD**：用户原文“以 CopilotKit 作为唯一 Agent 前端集成框架”“以 OpenAI Apps SDK UI 作为默认视觉设计系统”；采用官方控件与图标、中性明暗主题。没有自创视觉品牌，也不以此页代替 G2 产品设计。
- **STORY**：登录 → 服务端创建/恢复聊天 → 输入 → 即时本地消息与运行按钮 → 官方流式回复 → 停止或刷新继续查看。错误提供重连；不放静态追问、插件占位按钮或营销说明。
- **FIRST VIEWPORT**：newbot 顶栏、新建聊天和主题操作；中央正文阅读列；输入固定在可见底部并留安全间距。空聊天保留唯一输入任务，手机不拆列。
- **FORM**：`seed: none (pinned)`。首屏沿用户“日常聊天为主，工具和设置按需展开”的选择；G1只验证文本链路，使用官方CopilotChat布局和Apps SDK UI控件，不开第二轮视觉选型。QUALITY BAR：真实控件、可访问名称、清晰focus、文字对比≥4.5、390/1280无横向溢出、明暗主题一致、断网不重复执行。无图片comp，截图仅为实际渲染证据。

## 公式实际渲染发现
真实模型返回`$$a^2+b^2=c^2$$`后，DOM中没有KaTeX class/MathML，显示三份纯文本。已确认不是字体或模型错误：CopilotKit默认Streamdown1.6.11导出的默认顺序是raw→katex→sanitize→harden，sanitize清除了刚生成的安全公式标记。最小修正采用公开markdownRenderer槽位与公开defaultRehypePlugins，调整为raw→sanitize→katex→harden；不关闭过滤、不允许模型可执行HTML、不重写Markdown组件。对照验证公式标记保留、恶意HTML/脚本协议仍被拒绝；普通文本、代码和流式展示继续由CopilotKit处理。此项是同一渲染边界的兼容修复，不代表完整Markdown/G2验收。

当前状态：本文件所述基础文本/浏览器批次已实现并验证；完成证据、未覆盖失败边界及下一步见 [runtime-progress](newbot-v1-g1-runtime-progress.md)。不代表G1整体退出。
