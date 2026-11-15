# 前端职责与行为约定

适用codex/newbot-systematize。保持现有Newbot外观、领域入口与服务端协议；不引入第二套Agent运行时。控件规范见[ui-controls](ui-controls.md)，验证记录见[体系化计划](../.issue/2026-11-14/newbot-systematize-plan.md)。

| 职责 | 唯一所有者/入口 | 必须维持的约定 |
| --- | --- | --- |
| 表单动作、保存按钮、目录刷新 | FormActions / FormSubmit / CatalogRefreshButton | 共享布局与忙碌呈现，业务提交仍由调用方负责 |
| 页面目录请求 | operation-scope + use-operation-scope | 同步写入门；过期任务不能更新当前页面或解除新任务的忙碌状态；退出页面不冒充取消已发出的服务端写入 |
| 模型目录与配置修订 | configuration-read + ProviderSettings | 只采纳当前Provider修订对应的结果；修订持续变化须停止重读并提供恢复入口 |
| 模型普通字段/私密字段 | GatewayEditor + PrivateFieldEditor + private-input | 普通保存与私密回执分开；已保存/结果未知不可合并为普通失败；密钥不得进入普通聊天或配置事件 |
| 专家保存与目录刷新 | ExpertsSettings + ConfigurationFeedback | 已确认保存但读回失败只允许恢复读取，不能重新创建 |
| 聊天执行与服务端权威状态 | store.submitRun / pending-runs / loadThread | origin同步去重，requestId追踪，迟到确认不改当前会话，服务端状态决定执行是否完成 |
| 编辑草稿与乐观消息 | composer-drafts / submission-preview / App | 即时展示；只有匹配版本的确认才能清理草稿；普通草稿为页面内状态，不承诺刷新持久化 |
| 消息与流程显示 | UserMessage / ProcessGroup | 文字和图片分开；过程默认折叠；业务执行状态与标题保持明确；内外滚动应可传递 |
| 声明式UI | 既有A2UI renderer/catalog与服务端动作 | 只使用注册组件；表单恢复与提交由服务端作用域/修订/授权验证 |
| 交互式工具应用 | MCP Apps Host、独立sandbox、官方Bridge | 不通过普通聊天执行任意HTML；工具操作仍经服务端授权；第三方iframe保留独立应用状态 |

新增功能先确定状态所有者，再接共享控件。不要仅统一显示文字而绕过服务端生效、凭证或恢复路径。已有模块满足约定时直接复用；依赖升级和协议迁移另立计划，不与外观整理混合。
