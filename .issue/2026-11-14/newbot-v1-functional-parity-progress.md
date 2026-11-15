# NB-V1-PARITY · 本轮处理结果

2026-11-15。已恢复原完整产品的公网入口；新版功能等价迁移仍未完成。

## 共同原因
交付时把 labs/v1-integration 的文本探针作为用户体验新版的入口。该 shell/API 原本就不含插件、技能、专家、设置等完整领域能力，独立数据也没有原插件。技术验证成功没有满足用户“保留现有能力”的产品约定。不是原插件被删除，也不能通过补图标解决。

## 本轮实施
- 原始反馈、风险及实施步骤已先保存：[计划](newbot-v1-functional-parity-plan.md)。
- 原 .env 与一致 SQLite 快照备份到忽略且受限的 `.data/backups/2026-11-15-functional-parity`；不提交密码、凭证或数据库。
- 原 Cloudflare tunnel 日志反复 `Unauthorized: Tunnel not found`，浏览器 ERR_CONNECTION_CLOSED。重启原 web 隧道生成新地址，仅更新 .env PUBLIC_ORIGIN，正常重启原服务加载新 Origin。
- 完整入口：https://graph-curriculum-activities-rats.trycloudflare.com/ 。仍用原密码和原数据。原 dist/native 未改，服务 PID2322970；Apps origin 仍独立，未修改。
- 新文本探针及 `.data/v1-online` 保留，不删除已产生的预览聊天；它不再作为完整产品替代入口推荐。
- 主实施计划新增交付约束，提前规划业务接入；[功能保留矩阵](newbot-v1-feature-parity.md) 将10组原能力逐项列为用户可用版本门槛。没有更换架构决策或引入第二Agent循环。

## 实际验证
- 公网原密码登录200；未登录threads401；非法Origin403；Secure/HttpOnly cookie保持。证据 `evidence-v1/functional-parity/http.json`。
- 浏览器原24条聊天导航可见，Codex已连接；插件中心实际显示Sentry/Slack/GitHub/cloudwalker、newbot_test/hids。状态是当前UI所示，不代表本轮重新授权所有第三方。
- 商店下拉显示 Codex official、Awesome Codex Plugins、newbot-imports。
- 技能页实际显示qwe、Image Gen、OpenAI Docs等；独立专家页显示牧云安全专家及1技能/1插件组合。
- 设置→模型服务实际显示原服务25模型，默认deepseek-flash；没有改变配置或开关。
- 重启前后逐行比较threads、extension_packages、extension_imports、plugin_connection_settings、private_field_sets、provider_configuration全相等（24/5/3/2/4/1条），证据只记录数量和相等结果，不含秘密。
- 截图：connectors.png、skills.png、experts.png、models.png，均在 `evidence-v1/functional-parity/`。
- 本轮无产品代码/构建改动，未重复全量测试；检查配置生效、实际浏览器入口、只读数据一致和HTTP认证边界。

## 未完成项
CopilotKit新版本尚未迁移上述完整功能。本轮恢复的是原可用产品，不把旧UI截图冒充新版交付。第三方OAuth/安装写操作、附件发送、MCP Apps实际应用调用没有在本轮重新验收。Apps域名可达但根路径403，不能据此宣称App协议回归通过。Cloudflare quick tunnel没有固定域名保证。
