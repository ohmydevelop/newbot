# NB-V1 · 迁移与验收映射（G0）

| 问题/约定 | 现有机制 | 迁移/删除目标 | 证据及后续验证 |
|---|---|---|---|
| V01 一次发送一次执行 | index.ts run route、runs.ts | 提取共享命令服务供 AgentRunner 调用；不复制回执 | conversation-recovery、credentials 测试；新增 Runner run/connect 重复边界 |
| V02 迟到状态与作用域 | shared/events.ts、event-feed.ts、activity | 投影到 CopilotKit，之后移除 store.ts Agent 双状态 | event-feed、turn-activity、history 用例；新增跨 Bot/旧 run stop |
| V03 断线/恢复 | native 历史、runs、session-runtime | connect 从现有历史重建，保留 unknown | conversation-recovery、session-runtime；真实断流重连 |
| V04 动态界面 | A2UI0.9、McpApp/AppBridge | 1.0 Catalog 与版本读；保留标准 Bridge | a2ui、official-mcp-app；浏览器表单/刷新/授权 |
| V05/V06 授权/凭证 | private fields、credentials、App policy | security-ui 组合新控件，服务端策略复用 | credentials、elicitation、mcp-app-policy；合成秘密负向检查 |
| V07 配置 | provider/session runtime revision、extension配置 | 新设置页面复用同一路由 | provider-runtime、configuration-recovery、插件/TLS/OAuth |
| V08 即时发送/紧凑步骤/滚动/附件/追问 | web/chat、composer-drafts、suggestions | CopilotKit 新呈现，稳定行为继续保留 | submission、chat-presentation、suggestions；真浏览器手机/桌面 |
| V09 Bot/主机 | Runner ledger/control、db.owns 存在性校验 | 补全作用域与执行隔离；禁止仅换名称 | runner 系列测试只证明各自范围；双 Bot/独立节点待验证 |
| V10 部署 | build-web 发布和前代资产保留 | G6 才目录搬移/部署，补版本清单 | baseline.json；当前压缩测试失败详见进度 |

待删除对象需在替代通过后逐项确认：web/store.ts 的 Agent 消息写路径、自制 SSE 客户端及重复消息状态、被新组件替代的通用聊天/表单控件。保留领域策略、权限校验、回执、Codex adapter、AppBridge、旧 A2UI 版本读取；不能按文件名整包删掉。

隔离工程位于 labs/v1-integration，根 TypeScript include 不包含 labs。安装和构建输出均在 lab 内；root lock、生产 dist 与 `.data` 不接入新依赖。该工程是兼容性证据，不是新的部署架构。
