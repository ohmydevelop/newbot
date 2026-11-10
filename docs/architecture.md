# ADR-001 · 标准化 Agent Web Host

状态：D1–D7 开发功能冻结候选版，正式上线验收待 R1。更新：2026-11-09。产品版本 0.2.0，固定 Codex CLI 0.166.0；原 2026-11-07 基础验证保留在 [历史记录](validation.md)。

## 架构

```text
React / Zustand / Radix / Tailwind
    ├─ Markdown / Shiki / KaTeX / Mermaid / ECharts
    ├─ 受限 A2UI Catalog 与普通表单
    └─ MCP Apps / 文件预览（独立 origin）
              │ HTTP 控制 + AG-UI（SSE / poll）
Fastify ─ 登录、授权、事件适配、受控文件、私密消费者
    ├─ SQLite：Web 索引、回执、审计、UI 状态、加密凭证元数据
    ├─ 本地快照、加密主钥、独立 Codex Home
    ├─ 可选 OpenTelemetry OTLP
    └─ stdio JSONL ─ Codex App Server
                         ├─ Native Providers
                         ├─ MCP
                         └─ Agent Skills
```

Codex 是唯一 Agent Loop，管理模型、工具和原生聊天历史。Bridge 不实现第二套推理框架或模型网关；Web 使用 AG-UI 标准事件与 newbot 产品扩展，控制请求使用 HTTP。临时 Cloudflare 分享使用相同语义的 poll，普通环境默认 SSE。

SQLite 保存 Web 认证、会话索引、请求防重回执、附件/文件版本关联、授权审计、A2UI 最小快照/普通草稿，以及加密凭证及版本信息。完整聊天仍由 Codex 持久化。静态资源按完整构建发布，保留上一代不同内容资源。

## 已实现与条件

D1 文件登记及版本/预览，D2 Skills 查看和原生选择，D3 Provider/MCP 配置与恢复，D4 App 生命周期与普通表单，D5 A2UI 真实 Agent 表单与恢复，D6 受限私密消费者，以及 D7 体验/资源收尾均已完成开发验证。具体入口与限制见 [能力清单](capability-matrix.md)、[使用指南](user-guide.md) 和 [整体计划](roadmap.md)。

MCP Apps 与 HTML 运行预览需要独立应用域，缺少条件时不报告可执行能力。A2UI 只允许固定 6 种组件类型和普通输入；新线程注册原生工具，旧线程不自动迁移。私密保存支持 Provider/HTTPS MCP，sudo 仅限显式启用的固定身份检查。

不实现 A2A、ACP、多 Agent、多租户、模型网关、RAG 平台或任意 Agent 私密执行通道。两个真实 Provider、真实 OAuth、Docker、固定域名、长时并发与完整恢复演练留在 R1，不能用模拟测试替代。

## 恢复与安全

浏览器断开不发送中断；Bridge 消费事件并保留活动审批。请求使用稳定 ID 和持久账本，未知结果不重发；放弃仅可为未登记 ID 建立拒绝迟到请求的回执。进程退出后读取原生历史，不承诺恢复仍在执行的命令。

旧连接响应不能覆盖新连接。客户端历史缓冲有上限，超限只读核对；后台事件缓存、App 授权与 A2UI 状态仍使用各自已有的资源限制和归属校验。聊天草稿在当前页面内存，A2UI 普通草稿按既有服务端策略保存。

主站使用认证、Origin 校验、工具审批和受控文件路径。App/HTML 使用独立 origin、短时能力与不含 allow-same-origin 的沙箱，网络和工具权限按 Host 白名单控制。SDK 协议兼容不等于开放所有能力。

私密输入只到受信消费者，不进入聊天参数；错误和 Trace 使用限定公开出口。它不是对任意用户内容或恶意 MCP 输出的 DLP 系统，不能在 Codex 收到第三方结果之前拦截原生内部循环。单容器、同 UID、浏览器或 JS 内存不是强秘密隔离边界，完整限制见 [D6.5 记录](credential-isolation.md)。

固定 A2UI 旧版 Zod 的依赖审计问题仍存在，受限输入入口提供应用级资源预算，未声称修复上游。生产发布风险与检查见 [功能冻结记录](feature-freeze.md)。
