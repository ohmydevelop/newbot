# AUTO-1 进展
- 已确认开发 worktree newbot-systematize 干净，线上仍为 b261549 的已验收构建。
- 官方能力/界面结构与本地公共提交链已核对，计划落盘；Craft UI采集被工具审批规则拦截，用户问题待答。
- 本轮将沿用现有设计，不重新选择视觉方向。通知暂以站内/可选浏览器为实现假设。

## 实施与第一轮验证
- 后端：数据库 v19 增加任务、运行快照、附件引用、SMTP 配置与投递 outbox。调度器复用原 `/api/agent/run` 提交函数，不绕过现有模型/扩展/私密授权与 Chat/Plan/Work 规则。
- A1–A6：Temporal 日历、CAS 编辑、重复请求幂等、同任务不重叠、停机合并最近到期、每次新聊天、暂停/恢复/删除/停止、未知回执不重放；运行历史 cursor 分页、未读总数独立统计；长期任务附件不会被 24 小时清理。
- A7：入口顺序新建聊天→自动任务→搜索聊天；任务模板、当前聊天转草稿、触发器/时区/指令/附件/连接器/技能/专家/模式/模型、概览/运行记录。保留原聊天 DOM 和草稿。浏览器确证两处新表面问题：Modal 内 Picker 被遮罩挡住（共享层级上下文修复），长表单保存按钮被裁切（共享编辑器 flex + 单滚动区修复）。
- A8/A9：站内/邮件/两者/无；SMTP 设置加密保存并绑定版本，TLS/STARTTLS、私有 CA、检查连接/测试邮件；状态邮件包含结果入口，不发送凭证或工具上下文。邮件失败/未知可单独重发，不重新运行任务。浏览器提醒仅在页面打开时工作，不冒充后台 Web Push。
- `automation-targeted3.log`：9/9，含本地真实 SMTP 协议的 TLS、STARTTLS、证书拒绝、认证拒绝、发送失败、独立重试、发送中断、重启解密。测试邮箱为 example.test，本地接收器，未声称外部邮箱送达。
- `automation-browser3.log`：390/1280 浅深色 4/4 完整 CRUD / Run now / 打开聊天 / 暂停 / 重载 / 删除。
- `evidence-automations/native-live.json`：隔离复制线上数据库与真实 Codex/模型配置；无浏览器定时到期、真实模型完成、服务重启不重复、手动第二次新会话、暂停后不触发均通过。线上任务、会话和配置未被本次测试修改。
- 部署迁移校验扩展到 v18→19，旧列/旧值原样校验，新增表首发必须为空，回滚恢复原版本；Python 2/2。新 Node 依赖随 server 产物分发并纳入 hash，不修改生产旧源码/package 或共享 node_modules。
- Craft 复查仍 `consent_required`；真实 grok.com 登录界面尚不可采集。此前“用户问题待答”已过期：用户选择自行开启项目许可，并明确要求邮件通知。

## 尚待完成
扩展浏览器与触摸滚动/拖拽/动效、SMTP 配置 UI、完整单元回归、独立设计复核、发布及公网 smoke。未具备外部 SMTP 账号，不能验证外部邮箱最终到达；邮件收件触发无已连接收件流，尚未实现；自然语言对话直接创建任务尚未实现，现有聊天→任务草稿入口为显式操作。

## 验收补充
- 全量单元：590 项，589 通过，1 项既有跳过，0 失败。新增邮件专用密钥丢失保护：已有 SMTP 密文时不重新生成空主密钥，保持锁定并要求恢复；验证重启读写和缺钥边界。
- SMTP 设置 UI：320/390/1280 均已实际填写保存、检查本地拒绝连接、Escape 返回父任务编辑器；频率/时区/模型/模式/连接器/技能弹层逐一打开关闭并验证焦点。全量浏览器回归进行中。
- 设计检测器仅产生 20 个 advisory（19 个字号、1 个圆角），无阻断条目；交由独立 Impeccable reviewer 与原设计、截图共同评估，不能凭检测器无 error 宣称视觉完成。
- 原生实测使用真实线上模型配置的隔离副本；通过注入时钟推进到期点，模型执行及会话恢复为真实 native 链路，测试不代表真实日历等待了整天。实际日历/DST 单元测试另有覆盖。

## 独立设计复核与关联滚动修复
- Impeccable reviewer disposition=fix，四项材料问题：搜索缺共享 catalog-search 样式、邮件/浏览器提醒挤连、邮件表单字段间距与英文原生文件按钮、Tabs 键盘语义。按清单一次批量修正；保留 DESIGN.md 与旧世界。等待重拍与 verdict。
- 第二轮全量浏览器 70/71；唯一实际失败是工作流程内滚动被共享 ProcessGroup 的 items 依赖恢复覆盖。已补充到计划 A7，修正“展开一次恢复/运行跟随/用户滚动”三种状态归属；追加侧栏同事件重渲染的确定性断言，不能单纯重跑后忽略。
- 移动触摸 12/12：新增任务的正常/减弱动画滚动、固定头部/保存；原专家、技能、插件、流程边缘交接和平板拖拽取消均通过。该环境是触摸事件浏览器仿真，无物理手机。

## 发布前结论
- 修复后完整浏览器：71/71，0 flaky、0 skipped；旧版视觉金图未重录。确定性工作流程滚动回归通过，左右拖拽跨 iframe、失焦/取消/释放捕获、滚动边缘交接、正常/减弱动画真实帧验证通过。
- 全量单元最终590：589通过、1既有跳过、0失败；types、UI lint/design ownership、数据库迁移与回滚2/2通过。
- 设计 reviewer 二次 disposition=ship，四项材料修改全部 resolved；结论仅覆盖列出的四项，不扩大为逐像素 Grok 认证。DESIGN.md / PRODUCT.md 保持不变，截图保存在 `.impeccable/review/automations/`。
- 外部限制保持：Craft 登录态采集未许可、未配置外部 SMTP 收件验收、无真机。时间任务与 SMTP 功能已实现；邮件收件触发/自然语言自动创建/Web Push未实现，用户指南已明确。
- 最终触摸复验12/12，包含修复后的共享工作流程滚动、原拖拽/滚动/减弱动效。结果与帧采样已归档 `evidence-automations/{browser-results,mobile-results,verification-scope}.json`。准备发布，生产当前仍 b261549、数据库v18。

## 已上线
- 发布源码 `c85ccafed3f448fe1312bc2b2d209fa2152822be`，分支 `codex/newbot-systematize` 已推送。
- 公网 https://integration-love-angela-heated.trycloudflare.com/ 对应 webHash `a15465b93e3648481111edaf41cd19e1542747e5fa0586fa0db2f3753007ce72`，serverHash `e7aadd3df339ba8eb45cf10390351d5ff3fca67689c1155f91df0879cab82a3f`；数据库18→19。服务就绪，公开JS/CSS逐文件散列匹配。
- 备份 `/home/a/Documents/ChatGPT/newbot/.data/backups/2026-11-16-web-c85ccafed3f4`。10张历史会话/模型/扩展/权限相关表原有列和值发布前后完全相同。生产旧源码分支未重置；运行发布新dist，新增运行依赖包含在server产物内。
- 公网实际密码登录、自动任务入口、暂停后的手动运行、真实模型完成、运行记录打开完整聊天均通过，见 `public-smoke.json`、`public-run.png`。首轮验收脚本误点击同名侧栏新聊天（范围未限定），后台运行已成功；已限定到任务列表后复验通过。该首轮脚本失败保留 `public-smoke-attempt1.json`，不是产品 Tabs 故障。
- 两轮验证仅创建测试任务与测试聊天；测试任务已软删除、测试聊天已归档，当前无遗留测试周期任务。历史运行记录按产品保留策略保留，没有删除用户数据。
- 最终验收记录、用户指南及设计复核均已落盘。实现/本地验证/上线完成；外部 SMTP 收件待用户配置账号后验证，Craft实时Grok采集仍被项目策略阻断，未实现的收件触发/自然语言创建/Web Push保持明确标注，不宣称全部Grok功能或1:1像素已经通过。

## Craft 配置修正（用户明确授权修改配置后）
- 当前 session.project=null，project_list 返回0个项目；之前把 consent_required 归因为项目策略不准确。core_action_approve 的 other_tools 拒绝不能证明 web_site_open 的根因。
- 官方 settings_show 确认 /home/a/.config/craft-anything/config.toml 的 ask_before_running=true。按用户本轮明确授权，通过官方 settings_set 修改为 false，再读确认生效；未修改程序、MCP注册参数或审批记录。此设置是全局运行确认开关，不是 Grok 域名白名单；恢复方法为 settings_set ask_before_running true。
- web_site_open https://grok.com/automations 已执行成功，不再 consent_required。证据 ev_b62823f919de639d13a1a3f53ec5f54537ec299474fb67a2d789b75478cc1e21：Chrome155，1440×900；站点响应403，页面标题 Just a moment...。因此权限问题已解决，站点验证/登录仍未完成，不能宣称已采集自动任务UI。

- 进一步验证：Craft 可见浏览器访问根域名仍403；改用用户普通 Chrome 后 https://grok.com/ 正常打开，已有登录状态。没有操作验证挑战、复制凭证或读取私人会话。之前将 Craft 环境限制泛化为 Grok 不可访问不准确。后续可通过普通 Chrome 继续界面研究；首页已观察，自动任务页尚待核对。
