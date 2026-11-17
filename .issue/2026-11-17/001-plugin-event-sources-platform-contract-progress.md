# AUTO-7E 评估进度

2026-11-17：已核查当前 shared contracts、service registry、task schema 与 UI。确认用户指出的架构偏差：通用 engine 已有，但插件只选择宿主内置 GitHub 实现，尚非完整可扩展事件平台。计划及机制相关风险已落盘至同目录 platform-contract-plan.md。本轮仅修改调查记录；未改产品代码、未运行新的实现测试、未部署。下一阶段以第二个插件无需修改平台即可接入作为验收约定，避免仅将枚举放宽冒充解耦。

2026-11-17 实施启动：正式计划已补充。纠正 D8：发现生产实际指定的0.0.0内核，前轮默认CLI失败不是生产故障证据。本轮开始协议及执行桥，尚未修改部署。

续轮阶段记录：
- 31 项事件桥/订阅/OAuth/迁移回归通过（临时日志 /tmp/bridge-suite.txt，最终证据会归档）。修复账号更新重建活动 adapter；流式领取直到持久确认保持同一批次，心跳合并避免空闲缓冲耗尽。
- v23 原位迁移补通用 arguments，保留旧 task/revision/trigger/account/thread/webhook；事务失败回滚并可重试。不改独立订阅库主键，消除跨库双写需求。v1 来源继续隔离兼容，未冒称已升级成 v2 插件。
- 签名 webhook 通过本地真实 HTTP relay + 模拟 MCP peer 验证：challenge、签名/时间/订阅隔离、去重、加密状态重启、确认、撤销。此测试将 https://relay.test 映射到本地 HTTP，不作为公网 HTTPS/MCP SaaS 验收。
- 原生配套内核 smoke 已通过（/tmp/event-bridge-native.txt）；追加实际事件插件包导入验收中。
- 浏览器首次矩阵8项通过；截图发现新通用布尔控件受旧 label grid 影响，复选框与文案分离，正在统一 scoped checkbox 行并增加几何断言。未上线。

发布前边界复核：发现“host 已落盘、未 ack 时崩溃”可能遇到租约过期/被重新领取，若将旧回执一直作为失败重试会卡住后续拉取。共同修正：中继未被接管的同一回执仍可确认；已被替代的回执返回 obsolete，不确认现持有人，允许 host 继续拉取并通过 inbox 去重。新增故障边界测试，适用于 relay 插件与 MCP webhook 共用 ack 入口。

发布候选验收：
- 完整回归642项：641通过、1项历史外部原生下载测试按条件跳过；补充回执恢复11项通过（见 evidence-event-bridge/tests.txt、receipt-recovery.txt）。
- 动态信箱插件通过真实 MCP stdio→账号→任务→同一会话链路；不同账号共享中继路由时消费者命名空间互不抢事件。GitHub/信箱/中继包通过固定 Codex 内核安装、读取、卸载。
- 本地 OAuth 授权/PKCE/拒绝/重放/刷新/加密恢复，私有 CA 真实 HTTPS 同源信任边界，两个生态独立 hook 出站 HTTP 均通过。未使用真实第三方账号授权，未安装完整 OpenClaw/Hermes 产品。
- 8项浏览器矩阵通过，12项移动浏览器触摸/拖拽/滚动/动画通过。独立审查 EB-UI-1 resolved（ship仅限该修正评分）；旧主题/字体/共享菜单保持。
- 生产数据库只读副本迁移演练 v20→v23：55张既有表所有行不变，迁移记录写入；发布脚本已增加对应版本检查和失败恢复测试。
- 提供单文件中继部署包、Compose、独立插件与开发文档 docs/event-bridge.md。公网 HTTPS 中继地址及真实事件上游未配置，不将本地替身验收写成外部服务已连通。
- 当前阶段：准备提交并通过发布门禁；尚未更新线上服务。发布后结果追加到此记录，禁止用本条作为已上线证明。

## 上线结果

2026-11-17 已发布产品提交 `d10faeaf0943f51f15d98fda63d2bccb7c10e390` 到用户实际 `newbot-test.service`（3100）。发布凭据、备份路径、数据库/构建校验见 `evidence-event-bridge/deployment.json`、`release-receipt.json`。v20→v23 成功，18组受保护表摘要保持不变；此前离线迁移演练覆盖全部55张既有表。

首次尝试在登录前因旧临时隧道失效而停止，未切换任何资产；旧 `*-current.log` 实为11月13日已停止日志。恢复 web/apps 两条隧道，备份并更新生产 `.env` 中的精确 origin，保留端口、密码、模型与账号配置。`*-current.log` 现在指向活跃日志，避免后续再次读取失效历史地址。失败预备文件已保留在 `.data/preflight-failed-d10faeaf0943/`。

当前入口：https://promised-retailers-python-prizes.trycloudflare.com 。公网390/1280两宽度真实登录、自动任务入口、未保存编辑器、触发器菜单、source API200及release source核对均通过（`public-browser.json`）。没有创建生产测试任务、发送外部消息或更换用户密码；生产截图保留在 gitignored `.data/event-bridge-public/`，避免把真实工作区信息提交到公开仓库。

补充真实 MCP Streamable HTTP + 私有 HTTPS/CA 的事件发现与读取通过（`http-mcp.txt`），是实际 SDK transport 测试，不仅是普通 HTTPS 请求。

中继可执行包及5个插件/hook归档已交付到生产 `.data/event-bridge-releases/d10faeaf0943/`。中继仍是可选独立服务：未配置持久公网 HTTPS relay 地址、未连接真实 SaaS 账号，因此不宣称真实 Gmail/Slack/OpenClaw/Hermes 完整产品或公网 webhook 已运行。已完成标准接口、部署包、本地实际出站/签名回调与恢复验证；这些外部部署条件不影响 poll/push 插件运行。

CI 已加入边界与浏览器验证；本轮验收以本地证据为准，不冒称远程 CI 已执行。唯一全量测试跳过项为历史远程原生商店下载用例；事件包本地原生导入已另行通过。物理手机和软键盘仍无设备可测。
