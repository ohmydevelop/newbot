# NB-V1 实施进度

2026-11-14：用户要求制定正式计划。已整合用户v1.0提案与ARCH-01评审，形成newbot-v1-implementation-plan.md。

## 已完成
- 冻结唯一CopilotKit、Apps SDK UI默认设计系统、AG-UI/A2UI1.0/MCP Apps方向。
- 明确替代STACK-02中的Grok视觉、assistant-ui备选和shadcn默认配方；保留历史，不回写旧验收。
- 定义Bot与专家/会话的区别、状态权威、Actions回传、可信授权、Provider生效和Connector执行边界。
- 规划G0—G6、风险映射、V01—V10验收、性能预算、代码删除目标、数据兼容与回滚。
- 版本信息沿用本日已采集官方文档/注册表证据；未把候选版本当已通过安装或集成。

## 阶段状态
| 阶段 | 状态 | 下一交付 |
|---|---|---|
| G0 基线/契约 | 进行中 | 已有文件/入口基线、契约草案、迁移映射；性能/完整隔离决策待验 |
| G1 版本与最小闭环 | 进行中 | 已有真实文本闭环、浏览器、7项HTTP测试；Actions/A2UI/Apps闭环待做 |
| G2 聊天与设计系统 | 待开始 | CopilotKit聊天、新tokens、旧基础代码删除 |
| G3 A2UI/Apps/编辑 | 待开始 | 1.0与旧数据兼容、标准Host、受控编辑 |
| G4 插件/配置/授权 | 待开始 | 统一深层操作与配置/认证回归 |
| G5 多Bot/Connector | 待开始 | 执行隔离、远程资源与检查点恢复 |
| G6 结构/内核/发布 | 待开始 | 全量验收、版本/数据/公开入口与回滚 |

## 尚未确认
A2UI React发布组合、Actions离线恢复、多Bot强隔离及完整多主机恢复。Fastify/Runner基础文本与独立Apps SDK UI已于下述G1批次验证，完整事件/交互迁移仍待完成。它们是分阶段验证项，不能算已支持。

## 2026-11-14 · 创建分支并启动

- 从 `40754bf` 创建 `codex/newbot-v1`，保留此前未提交的架构计划及本地历史证据。
- 修改代码前新增 [G0/G1计划](newbot-v1-g0-g1-plan.md)。源码调查形成 [身份/状态契约](newbot-v1-contracts.md) 与 [迁移映射](newbot-v1-migration-map.md)。
- 发现 db.owns 只验证会话存在性；多 Bot 授权是待实施事项，不复用方法名冒充归属校验。
- [baseline.json](evidence-v1/G0/baseline.json) 记录 HEAD、服务 PID、native/产物 hash、资源体积。公网 HTTP 200，首页内容与本地 dist 一致；没有构建嵌入清单，因此不能声称 hash 证明全部产物来自当前源码。
- 根类型检查通过。546 项基线测试：544 通过、1 失败、1 跳过。单独重跑仍失败：`tests/performance.test.ts:113` 期望 br，实际未压缩；当前 dist 入口资产无 .br/.gz。`scripts/build-web.mjs` 正常发布会执行 build-assets；当前产物如何绕过压缩步骤尚未确认。记录为部署产物差异，未修改断言或覆盖线上 dist。后续在隔离构建复验完整发布路径，生产发布前必须消除。
- 新增 `labs/v1-integration` 独立 package/lock，root package/lock/node_modules 未改。strict-peer 安装及普通 npm ci 通过；npm 默认未批准的 Scarf postinstall 未执行，未将它作为必需能力。
- 官方 A2UI React 包冲突已复现；候选 CopilotKit renderer 的 1.0 状态处理通过。详见 [ADR-001](newbot-v1-g1-compatibility-adr.md)。
- 隔离协议探针 5/5 通过：自托管SSE发现、run/connect分离、无归属Runner拒绝、A2UI1.0增量/删除、未知Catalog拒绝。记录在 `evidence-v1/G1/protocol-probes.log`；只使用测试Runner，不是真实Codex或浏览器验收。

## 下一批实施

将 run 路由背后的共同命令服务提取为 AgentRunner 可调用边界，保留已有回执、配置和私密输入约束；完成 Fastify cookie/Origin 与流式连接接线。然后同页验证真实 Codex、前端 Action、Apps SDK UI Catalog、MCP App 和可信审批。独立 lab 不可直接对公网提供测试Runner。

未改生产数据、根依赖、WebUI或线上服务。尚未完成浏览器性能基线、一致性全量备份、多Bot强隔离设计与G1完整闭环；没有宣称v1已交付。

## 2026-11-14 · 继续实施：真实执行与浏览器

从374fab6继续。已提取现有发送命令服务，接上真实CopilotKit Runtime/AgentRunner与官方HttpAgent，完成同源浏览器登录、真实deepseek-flash、刷新恢复、精确停止和断网重连。独立界面使用Apps SDK UI控件，未替换生产WebUI。

- 7项新HTTP/故障测试、1项Markdown安全边界测试、5项上游协议探针通过；真实SDK重复请求/重连只有1次native执行。
- 修正实际集成发现的AG-UI/RxJS类型版本不一致、完成历史缺少开始信封、SDK关联元数据误拒绝、掉线终态遗漏、重连按钮未重建连接、官方CSS基础缺失、嵌套深色token、CDN公式字体和公式过滤顺序。
- 根546项全量回归与基线相同，旧Brotli产物失败仍在；性能预算和完整G1仍未通过。
- 390/1280浅深色截图、真实原生状态、失败边界及未完成项见 [G1详细进度](newbot-v1-g1-runtime-progress.md)。复审仅确认其列出的两项界面修正已解决，不冒充全产品批准。
- 生产PID仍1291921；根依赖、数据及原生内核未改。临时验证实例结束后清理。

下一步仍按原计划接前端Action、A2UI1.0 Apps SDK Catalog、MCP App与可信审批，不以此批文本闭环跳过G1退出条件。

## 2026-11-15 · 功能退步反馈与交付纠正

用户明确拒绝仅有聊天的在线探针。已恢复原完整产品公网入口并核对历史、连接器、商店、技能、专家和模型设置；未修改产品构建或数据。新增完整功能等价发布门槛，G1探针不再作为日常入口推荐。详细因果、计划、证据和未完成迁移见 [NB-V1-PARITY](newbot-v1-functional-parity-progress.md)。本轮是可用性恢复，不是新版完整功能迁移完成。
