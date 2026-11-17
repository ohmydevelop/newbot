# AUTO-7B 内网事件订阅：可行性调查与后续计划

## 用户目标、范围与判断

原始问题：内网机器不能提供外部推送地址，是否可用订阅机制，参考 Kimi Bridge。
触发路径：内网部署 → 导入支持事件的插件 → 连接账号 → 选择业务触发器 → 关闭网页后继续接收。
预期：不开放入站端口、不依赖 Newbot 公网分享链接，服务端仍能获取事件并在任务的固定会话执行。
实际：当前自动任务有入站事件接收与持久派发底座，没有插件级出站订阅管理。AUTO-7 的接口设计还需明确传输能力，不能把公网 Webhook 当作普遍前提。

判断：有条件可行。主机能主动访问上游时，使用上游原生长连接、拉取队列或增量轮询；只有 Webhook 的来源需要可达的转发队列，或者提供语义受限的轮询替代。无入站、无出站/中继、上游也无可拉取接口时无法实时接收外部事件。订阅是业务关系，Webhook/WebSocket/Pull 是交付方式。

本轮仅分析和落盘，未改产品、配置或部署；没有实际联网订阅/账号端到端验证。源码工作树 newbot-systematize；不将源代码调查当作线上已实现证明。

## 证据与因果解释

1. Kimi Bridge 按开源 IM 桥接项目 Mtrya/kimi-bridge 解释，不是 Kimi 浏览器扩展 WebBridge。固定提交 f6e10e3b14915588e7279c66570030be6c6c427b：
   - src/kimi_bridge/platforms/feishu/__init__.py:565 使用 lark.ws.Client。
   - src/kimi_bridge/platforms/telegram/__init__.py:457、603 启动长轮询循环。
   - src/kimi_bridge/platforms/qq/__init__.py:635 使用 websockets.connect；微信 adapter.py:441 使用 get_updates 与游标。
   - https://github.com/Mtrya/kimi-bridge/tree/f6e10e3b14915588e7279c66570030be6c6c427b/src/kimi_bridge/platforms
   证实的是按平台实现出站适配器，不能推导任意 SaaS 都支持统一 WebSocket。仅阅读源码，未运行该项目，未核验其完整可靠性或许可证复用条件。
2. Gmail 官方支持 Cloud Pub/Sub，Pull/StreamingPull 由客户端主动发起连接；watch 需续期，收到提示后仍需 history.list 拉取增量。依赖 Google 项目、Pub/Sub 设施及各自权限，不是普通 MCP 工具令牌即可直接使用。
   - https://developers.google.com/workspace/gmail/api/guides/push
   - https://docs.cloud.google.com/pubsub/docs/pull
3. 不配置 Pub/Sub 时，可基于 Gmail history.list 周期同步；historyId 过期会返回 404，要求重新同步，不能承诺离线任意久都完整补齐。
   - https://developers.google.com/workspace/gmail/api/guides/sync
4. GitHub 通用 Events API 支持 ETag/X-Poll-Interval，但有限时间/条数窗口，官方明确非实时。不能把它当作完整 Webhook 替代。按 Issues/PR 等资源 API 的定向轮询也必须逐项证明事件语义，短暂中间状态可能不可恢复。
   - https://docs.github.com/en/rest/activity/events
   - https://docs.github.com/en/webhooks/using-webhooks/creating-webhooks
5. Newbot shared/automations.ts 固定 source；server/automations.ts:578 receiveEvent 校验 revision/enabled/trigger，在事务中去重并创建 run。可作为内部派发入口，适配器无需经公网 POST 回自己。但缺少跨任务的来源收件箱和订阅游标，不能直接宣称可靠 fan-out 已完成。
6. Newbot server/runner/connection.ts:173 已有主动 HTTP exchange；control.ts:414–421 在提交后确认收件。可借鉴确认顺序及恢复约定，但 Runner 是主机执行授权边界，不能把 SaaS 插件直接接入其命令权限或复用节点令牌。

根因判断：当前抽象把来源与入站验签协议绑定；业务事件、交付能力、持久订阅三个层次尚未分离。不是单纯增加一个 WebSocket 客户端即可解决。

## 不变量与相关风险

|编号/优先级|约定与关联机制|状态、证据与处理|
|---|---|---|
|N1 高|内网默认无入站地址依赖；浏览器关闭后仍监听|有代码证据：现有来源为入站接收。新增服务端生命周期；Gmail/GitHub/桥接插件全部纳入|
|N2 高|只有已持久接收的事件才能向上游确认或推进游标|有代码证据：现有 receiveEvent 只覆盖单任务；跨任务 fan-out 待验证。先持久来源事件，再可靠分发，避免部分成功后 ack 丢任务|
|N3 高|重复投递不重复启动同一任务；并发消费者有归属约束|待验证：订阅租约、账号隔离、provider/account/eventId 命名空间。至少一次投递加幂等，不承诺外部副作用全局恰好一次|
|N4 高|重启、断网、撤权与游标过期可恢复且状态真实|待验证：持久 checkpoint、退避、续租/续期、限流、历史缺口状态；首次基线不当作一批新事件执行|
|N5 中|暂停/删除任务与卸载插件后无迟到执行|有代码证据：现有 revision/enabled 守卫可复用；共享订阅需引用计数及可靠任务分发状态，不能停掉其他任务|
|N6 中|MCP 工具权限不冒充 SaaS 订阅权限|待验证：各平台 OAuth/scopes、Pub/Sub IAM。已有连接仅在凭证用途匹配时复用|
|N7 中|原生推送与轮询不伪装成等价实时体验|官方文档证据：GitHub Events 延迟/窗口、Gmail history 过期。显示必要的延迟/需重新连接状态，不堆协议说明|
|N8 中|代理限制与 TLS 配置仍然有效|待验证：长连接/gRPC 被阻断时仅在上游支持时降级 HTTPS Pull；不得关闭证书校验。模型网关不纳入，本轮只涉及订阅传输|
|N9 中|可选转发只获得事件所需权限|待验证：转发验签、租户隔离、保留期与拉取认证；不开放 Newbot 管理界面，不向转发上传模型密钥|

## 建议架构与实施顺序（待实施）

1. 扩展 AUTO-7 TriggerProvider：业务事件定义与 delivery capabilities 分离，支持原生 stream、pull、poll、webhook/relay。插件声明配置 schema、连接要求和受控适配器；平台统一选择可用方式。不存在已确认的通用 Codex/MCP 触发器标准，使用版本化 Newbot 扩展。
2. 单 Server 增加订阅管理模块，按 connection + 上游资源/订阅范围共享监听，再按条件分发给任务。不是每个任务创建一条相同轮询，也不另起一套 Agent Runtime。
3. 增加来源 inbox、持久 checkpoint、租约和逐任务分发记录。先持久化来源事件，后 ack/推进 cursor；异步可靠派发复用任务队列/固定会话。对 API 分页、游标更新与断电边界设计事务。限流、容量满、权限撤回及缺口须显式处理。
4. 私有部署优先实现 Gmail 增量轮询和经过逐项语义验证的 GitHub 资源轮询；使用官方客户端支持 Gmail Pub/Sub StreamingPull 作为低延迟选项。无相应凭证/设施时不能标可用。GitHub 完整 Webhook 事件采用可选外部接收队列，内网主动拉取；先评估现有可自托管桥接/消息队列，再决定最小适配，当前未完成具体中继产品选型。
5. OpenClaw/Hermes/Kimi 的适配按实际项目提供的接口实现，导入技能不会自动获得监听能力。借鉴桥接机制，不嵌入其完整运行时。若复用代码需另外核对许可证与依赖。
6. UI 保持应用→账号→事件→条件；传输方式默认自动选择，只有延迟差异、缺配置或连接失败需要用户决策时显示。沿用 Grok 交互，不引入默认必填公网回调字段。
7. 兼容旧时间与 Webhook 触发器，保留 trigger ID/密钥/历史任务会话；迁移不能自动开通外部订阅或改变事件语义。既有 Cloudflare 分享地址与任务监听解耦。

## 验收与边界

- 阻断所有外部入站，仅允许必要出站：创建订阅、关闭网页、产生事件，任务在原会话执行；分别留本地模拟与真实账号证据。
- 两个任务共享来源，模拟一次分发成功另一次失败；重启后补齐且不重复已接收任务。重复/乱序事件、接收后 ack 前断电、并发消费者均覆盖。
- 断网重连、HTTP 429、OAuth 失效、watch 续期失败、游标过期及队列满：可观察恢复/缺口，无静默假成功。
- 首次连接不回放全部历史；暂停/删除/卸载与迟到投递竞态不运行任务；共享其他任务不受影响。
- 原有定时/直连 Webhook/同会话串行执行回归；窄屏表单、状态与连接选择浏览器验收。
- 本轮不实现/上线、不新建第三方账号或订阅、不搭建公网转发；未在实际内网验证出口策略。可行性已建立，具体来源覆盖与端到端可靠性待实施验证。
