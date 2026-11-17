# AUTO-7 插件提供事件源：调查与后续计划

## 用户目标与问题
用户观察Grok安装Gmail/GitHub应用后可在事件源选择触发器，询问是否存在留给插件的抽象接口、是否能通过插件导入触发器。本轮仅调查与设计，不修改产品或部署。

触发路径：安装/导入应用→连接账号→自动任务添加触发器。预期：支持事件能力的插件贡献业务事件、可选账号/资源与条件表单，平台负责订阅及任务执行。实际Newbot目前是固定来源菜单与签名协议适配器，插件导入不贡献事件源。

## 证据、事实与假设
1. 源码已核实：shared/automations.ts:50 eventSourceLabels与source enum固定Webhook/GitHub/Hermes/OpenClaw；AutomationScheduleFields.tsx:AddSchedule读取此常量；server/automation-events.ts按source分支验签；server/ecosystem-imports.ts仅迁移技能及限制说明。这不是插件动态注册系统。
2. 既有真实Grok采集：2026-11-16/006-automations-live-alignment-plan.md记录登录态Gmail/Outlook、GitHub/Linear、Finance、Webhook等触发种类；未执行安装前后对照实验，不能据此证明任意第三方插件可贡献事件。
3. Grok Automations官方确认邮件匹配触发与连接器用于任务执行：https://x.ai/news/grok-automations 。
4. Grok Bot（不同产品表面）官方明确routine事件集成与Slack/GitHub应用连接分开，可能需要单独连接：https://docs.x.ai/grok-bot/skills-routines-and-automations 。不能把Bot的实现或界面直接当成grok.com已证实机制。
5. Grok连接器官方介绍OAuth及自定义MCP工具发现，但所核对文档未证明存在通用第三方触发器SDK：https://docs.x.ai/grok/connectors 。
6. Gmail推送通过Cloud Pub/Sub、watch/historyId及到期续订实现，不能仅用读取邮件的工具声明代替：https://developers.google.com/workspace/gmail/api/guides/push 。GitHub可订阅repository/organization/App事件，创建仓库Webhook要求对应管理权限：https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks 。

判断：用户需要的是插件业务事件能力与平台订阅生命周期。上一轮完成了接收/去重/派发底座及技能迁移，没有实现本层；必须明确这一差距。Grok内部是否使用开放插件注册接口仍待证明，本计划接口为Newbot设计建议。

## 必须维护的约定
- P1：只有已安装且声明支持的能力可注册；账号未连接/权限不足不显示为可用。事件权限与工具权限分别核对，不能默认MCP会话凭证可用于调用底层SaaS订阅API。
- P2：插件提供业务事件、配置schema、资源选项和受控适配器；平台统一渲染。前端新增业务来源不需要修改枚举或复制页面。
- P3：订阅持久化且可核对，创建/续期/取消可恢复；重复保存、超时回执丢失、迟到通知不重复派发。暂停/卸载/断连不能继续激活任务。
- P4：事件只进入绑定的Bot/账号/任务及专属会话；凭证不进入模型或配置表单schema。一个账号的订阅不可被另一个账号复用。
- P5：插件清单只有声明不等于可执行能力。外部适配器需实现受控接口及信任边界，不在导入阶段执行任意JS/Python。此契约是Newbot扩展，不宣称Codex/MCP已有统一触发器标准。

## 同类风险清单
|优先项|状态|共同机制与关联范围|后续验收|
|---|---|---|---|
|固定来源列表|有代码证据|菜单、schema、签名分支与插件目录分离|导入合规测试插件后无需改前端即可发现新业务事件|
|授权错用|待验证|连接器OAuth、私密配置、账号与订阅能力|未授权/缺scope明确补连接；工具可调用不冒充事件可监听|
|订阅生命周期|有代码证据：当前仅被动接收，没有上游订阅管理|保存/编辑/暂停/恢复/删除/插件卸载与升级|失败回滚或待核对；续期/重启/撤销权限；迟到回调隔离|
|平台派发|已验证底座，插件整合待验证|沿用AUTO-6去重/FIFO/同会话执行|不同插件相同事件ID不碰撞；不会重复启动或更换会话|
|技能与事件混淆|有代码证据|OpenClaw/Hermes导入、Codex插件元数据|导入预览分别列技能/工具/触发器及不支持项|
|Grok内部公开SDK|待验证|界面行为不等于公开扩展协议|只引用已确认产品行为，不编造内部接口或零改造兼容|

## 后续实施顺序与边界
1. 定义版本化TriggerProvider契约及插件扩展清单：providerId、事件定义、连接要求、配置/输出schema、资源选项、适配器引用。订阅接口覆盖创建、续期/核对、取消、通知规范化；按需支持有游标轮询。
2. 服务端注册表从已安装插件及实际连接能力派生；存储插件/版本/connectionId/事件类型/条件/订阅状态/续期时间/游标。内置定时和高级Webhook沿用，旧四类记录做兼容映射，不能改ID导致既有回调失效。
3. UI改为“应用→账号→业务事件→条件”，图标/名称与设置插件目录同源；现有Hermes/OpenClaw协议格式进入高级接入配置，不把传输协议混同Gmail等业务来源。
4. 先用可导入的测试插件贯通动态注册及重启/卸载/升级，再接GitHub和Gmail实际适配器。Gmail需要对应项目/订阅设施，GitHub需要有效订阅权限；满足既有权限时复用连接，否则补授权。缺外部条件时标未验证，不添加假可用状态。
5. 自动化测试覆盖上述P1–P5、已有时间/Webhook兼容、UI窄屏与连接状态；本地模拟与第三方真实账号验证分别标注，再按授权发布。

不改Codex Agent Runtime；复用现有事件队列/任务会话/凭证边界。不在本轮问题讨论中安装插件、创建第三方订阅或更改已部署版本。

## 状态
调查与设计已完成；待后续实施。进度见001-plugin-event-sources-progress.md。
