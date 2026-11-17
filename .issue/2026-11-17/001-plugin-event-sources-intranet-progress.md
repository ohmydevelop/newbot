# AUTO-7B 调查进度与证据

2026-11-17：完成内网出站订阅可行性分析，补充 AUTO-7，不覆盖前轮记录。

- 用户问题 → 公网 Webhook 前提不适合内网 → 核对 Kimi Bridge 固定提交、Gmail Pub/Sub/sync 与 GitHub 官方 API → 明确原生出站/轮询/可选转发的能力差异。
- 当前实现 → 读取 shared/automations.ts、server/automations.ts receiveEvent 事务与 Runner connection/control → 已有去重派发可复用，缺上游订阅、共享来源 inbox 与 checkpoint；Runner 不能直接充当 SaaS 授权接口。
- 方案修订 → 默认不暴露 Newbot，由插件贡献业务事件与交付能力，服务端持续监听，事件落盘后确认并可靠派发到固定任务会话。
- 已完成：公开文档/源码核对、风险分类、范围和验收计划落盘。
- 未完成：产品实现、具体中继产品选型、真实 Gmail/GitHub 账号与内网网络验证。未安装/运行 Kimi Bridge；本轮无产品改动、测试执行或部署，不将理论可行称作已兼容。

具体来源、固定提交、代码位置与验收项见 001-plugin-event-sources-intranet-plan.md。下一实施阶段需覆盖 N1–N9，保留原时间/Webhook 记录兼容，真实服务证据独立于模拟测试。
