# 实现能力与限制

更新：2026-11-09。对应固定 Codex CLI 0.165.0、产品 0.2.0 用户反馈改进版（开发阶段）。实例当前值以登录后的 `GET /api/runtime/capabilities` 为准；本文是字段解释，不把布尔值当成对所有第三方服务的兼容承诺。

| 能力字段                          | 实际范围                                              | 条件与限制                                                                                      |
| --------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| threads / streaming / approvals   | 原生会话、消息流、审批与恢复                          | 浏览器离线不停止任务；进程退出不保证原任务继续                                                  |
| eventProtocol / webTransport      | AG-UI 1.0.4；SSE 或 poll                              | 两种传输使用同一事件语义；产品状态与审批使用 newbot 扩展                                        |
| providerManagement                | 配置管理、目录发现、基础 Responses 诊断               | 成功连接不代表 Agent 工具、上下文恢复和所有推理参数兼容；两个真实 Provider 矩阵留在 R1          |
| configuration / mcpManagement     | 脱敏、版本保护、配置恢复、原生发现和重载              | Codex 配置为准；会影响运行时的操作受空闲/维护保护                                               |
| mcp / mcp.protocolVersion         | MCP 由 Codex 协商                                     | 协商版本未知时为 null，不宣称实现某版规范全部扩展                                               |
| skillDocuments / skillSelection   | 已发现技能受控读取、显式结构化输入、历史引用          | 最多 8 个；说明最多 256 KiB，失效或变化时重新校验                                               |
| elicitation                       | 普通非敏感表单、拒绝、取消与超时                      | 最多 12 字段/32 选项，默认 300 秒；私密输入与 URL 模式关闭                                      |
| mcpApps / mcpAppHost.available    | 官方 SDK 隔离 Host、结果、主题、高度与工具授权        | 需要可用的独立 App origin；当前只支持 inline 模式、内联依赖                                     |
| mcpAppHost                        | 同 Server/UI 资源内的 App 可见工具，逐次授权          | 网络、外链、下载、聊天写入、模型上下文、Sampling、额外资源、工具目录、Prompts 和 App 日志均关闭 |
| mcpAppLifecycle                   | 关闭、过期、取消、会话归属与重新打开                  | 恢复页面不恢复旧授权；重新打开会校验当前权限                                                    |
| artifacts                         | 受控登记、不可变版本、预览、下载、用量和清理          | 不提供任意路径读取；当前文件最多 8 MiB                                                          |
| artifacts.previewKinds            | 文本/代码/Markdown/JSON/CSV/图片/PDF                  | HTML 运行预览只在独立 origin 可用时加入；不启用时仍可源码/下载                                  |
| artifacts.pdf                     | 受控 Range、分页与缩放                                | 最多 500 页、单画布最多 800 万像素；不是 PDF 编辑器                                             |
| a2ui                              | 线协议 v0.9、固定 Catalog 与 6 种组件类型             | 只对新原生线程注册工具；支持增量、草稿和重启只读恢复；私密字段关闭                              |
| privateCredentials / trustedInput | 临时 Provider 检查、Provider/HTTPS MCP 内存或加密保存 | 与聊天/普通表单分离；凭证不可回读；加密可用性以 storage.encrypted 为准                          |
| trustedInput.sudo                 | 显式启用时的固定 sudo.identity                        | 仅执行一次固定 id -u；不允许任意命令、Agent 主动请求、保存密码或 stdio 凭证注入                 |
| runRecovery.abandonUnseen         | 放弃尚未登记的发送并持久阻止迟到请求                  | 已有预留/派发/未知/已接收或旧版回执不能覆盖；不是取消已运行任务                                 |
| traces                            | 可选 OTLP 元数据导出                                  | 未配置时关闭；无完整模型内部 Span，不默认记录内容或凭证                                         |
| a2a / acp                         | false                                                 | 不在本版实现；多 Agent、模型网关、多租户及插件商店同样不在范围内                                |

本地单一 localhost/127.0.0.1 主站可使用另一个主机别名隔离应用。两个别名都作为主站时，不能同时用作应用域，需要显式 APP_ORIGIN。命名主站没有独立应用域时，Apps 和 HTML 执行能力应为 false，而不是显示为完整支持。

私密输入需要 HTTPS 或本机安全来源。能力可用不表示第三方接收方可信，也不表示同 UID 进程受到强隔离；完整边界见 [凭证隔离记录](credential-isolation.md)。

D7.5 新增三项服务端契约检查：无应用域时关闭执行能力；应用域与固定 sudo 开启时仍保持最小权限；固定运行时、未知 MCP 版本和无敏感配置的能力读取。测试不创建模型 Turn，不执行 sudo。

## 2026-11-09 用户反馈改进

详见 [.issue 计划](../.issue/2026-11-09/plan.md) 与 [验证进度](../.issue/2026-11-09/progress.md)。新增会话级网关/模型/推理/审批设置、原生插件管理及结构化引用、图片缩略图与附件预览、统一执行过程和原生计时。运行请求保存配置修订号，SQLite 开发版本为 6。

- `capabilities.sessionSettings`：固定 0.165.0 支持同一原生线程切换网关；模型是否完整兼容仍需按模型验证。
- `capabilities.plugins`：原生实验接口，仅已配置的本地市场（包括 Git/包来源）；生产模式需显式 `EXPERIMENTAL_PLUGINS=true`，不接管 ChatGPT 云端账号。
- 网关默认模型保存在 Codex Home 的受管理命名 profile 文件，全局默认使用 Codex 原生配置接口。工具连接和技能状态继续由 Codex 管理。
- 本轮测试使用隔离数据、合成凭证和本地模型端点；正式双 Provider、OAuth、公开部署和长期运行验收继续保留在 R1。

## 第二轮设置体验

详见 [第二轮反馈记录](../.issue/2026-11-09/progress-02.md)。`providerManagement.privateEditor/generatedIds` 表示网关名称/地址与私密 API Key 可在一个编辑器保存、内部 ID 自动生成；密钥以二进制私密通道提交，默认本机加密。`skillManagement.uninstall = personalArchive` 仅支持受管理的独立个人技能移出发现目录并保留备份；项目、系统、管理员和插件技能不能通过此接口移除。前端工具与插件合并管理，执行与配置仍使用各自原生接口。SQLite 保持 v6。
