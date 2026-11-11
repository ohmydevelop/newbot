# Issue 2026-11-10-03：实施计划

日期：2026-11-10。用户已批准实施。原 issue、image-16/17/19.png 保持原样。进度与证据见 `issue-03-progress.md`、`evidence-issue-03/`。

## 产品约定

每个聊天独立工作目录，共享 newbot 独立 Codex 进程和 CODEX_HOME；专家在当前聊天持续生效；全局配置在下一轮发送前同步，活动任务使用固定快照。配置/引用/修订号以 SQLite 为准，技能和插件保留原生文件结构，密钥沿用私密凭证库。独立目录不是 OS 级安全边界。个人 ~/.codex、~/.agents 不可修改。

第一版每个聊天选择一个专家，专家组合插件、技能和连接器的引用，不嵌套专家、不改变模型/审批、不启动第二个 Agent。全局停用不能由专家绕过。旧聊天保留原目录和历史，新聊天首次创建线程时分配目录，空白草稿不分配。

## 反馈、因果与验收

| ID | 触发 / 实际 | 被破坏的约定 / 根因 | 预期 / 验收 | 状态 |
| --- | --- | --- | --- | --- |
| G1 | 网关卡片标题和下拉文字不齐，默认按钮挤占区域，删除藏于编辑框 | 信息起线和操作区域没有统一；标题有独立图标占位 | 名称、数量、下拉统一起线；点击卡片设默认，编辑/删除/下拉互不误触；键盘及失败回退 | 完成：ui/gateway-notices、service/public-check.json |
| G2 | /models 不支持时无法手工补模型 | 编辑器及服务端目录/运行校验均缺手工来源 | 手工模型可保存、设默认、执行、重启恢复；未知推理能力不冒用默认值 | 完成：gateway-manual-models 与 model-defaults 测试、native/experts-native.json 第 4 项 |
| E1 | 插件、技能、MCP 分散，无专家 | 缺统一目录和稳定引用模型 | 扩展四分类，专家 CRUD、@ 引用、持续生效、失效依赖阻止执行 | 完成：experts 测试、ui/experts、native/experts-native.json |
| W1 | 新聊天沿用全局目录 | 创建/恢复/沙箱/技能/产物都闭包捕获同一 cwd | 两会话同名文件互不覆盖，浏览/产物/恢复使用各自目录，旧会话不搬迁 | 完成：session-workspaces 测试、native/session-extension-native.json、ui/workspaces |
| S1 | 侧栏无任务状态 | ThreadSummary 无状态，runs.accepted 只代表接收 | 原生事件维护轻量摘要；运行/等待/完成/失败/停止/未知，跨会话重连恢复 | 完成：thread-activity 测试、ui/activity |
| N1 | 错误条出现把消息向上推 | 通知占用 composer 正常文档流 | 普通通知浮层，字段错误就近，阻塞操作可恢复；聊天/输入框坐标稳定 | 完成：ui/gateway-notices 和 ui/regression |

## 已核实证据与关联风险

规划时源码、构建、本地与公网入口一致：index-DRtCyC7U.js。截图已逐张检查。ProviderSettings/GatewayEditor/session-runtime 存在 G1/G2；App 中 error-banner、BackgroundNotice 正常流导致 N1；bridge/codex/skills/artifacts 全局 cwd 导致 W1；db.list 不含执行状态导致 S1。

临时目录内真实 Codex 0.165.0 + 本地模拟 Responses 探针验证：项目技能独立、线程 MCP 配置互不串扰、跨线程工具拒绝、技能/插件线程禁用影响真实请求、保留线程 ID 恢复并更换 MCP。项目根禁止向上搜索后不加载祖先 AGENTS。未调用真实付费 Provider。

| 关联风险 | 依据与状态 | 处置 |
| --- | --- | --- |
| 工作区文件、产物、沙箱根 | 有代码证据：均使用全局根 | 全部改为服务端会话绑定解析 |
| 技能 ID 绑定绝对路径 | 有代码证据：skillId(path) | 稳定资源身份与旧引用兼容，不因投放目录改变失效 |
| MCP Apps 全局目录回退 | 有代码证据：catalogs.get("") | 会话目录存在时不可回退，按会话版本核对权限 |
| 扩展全局 reload/unload | 有代码证据 | 下一轮仅同步目标线程；安装卸载等共享操作等待空闲 |
| 目录失败冒用 native 模型 | 有代码证据 | 区分真实发现、手工、历史；不伪造发现成功 |
| 插件安装但部分能力缺失 | 隔离探针已复现：便携 mcp.json 未发现，兼容 manifest + .mcp.json 正常 | 固定版本契约检查；报告实际能力及部分兼容，不静默成功 |
| 迟到事件、重复请求与配置竞争 | 有代码证据，已验证 | thread-activity、experts、session-workspaces、conversation-recovery 与浏览器回归通过 |
| 新凭证环境无重启轮换 | 已知原生进程限制 | 既有私密通道/受控重连保留，不伪装热更新 |
| 强隔离、多 Agent、公用商店、正式上线 | 不适用 | 不进入本轮 |

## 阶段与完成条件

| 阶段 | 实施 | 验收门槛 | 状态 |
| --- | --- | --- | --- |
| P0 | 保存调查与计划；将原生探针整理为可重复隔离测试 | 原生版本、目录、技能、MCP、插件、恢复契约通过 | 完成：native/extension-native.json，9 项 |
| P1 | 网关卡片、手工模型、普通通知浮层 | 类型、针对性接口测试；桌面/手机深浅主题、键盘、失败回退与位置稳定 | 完成：P1 接口与 ui/gateway-notices |
| P2 | 持久化轻量聊天状态、全局摘要事件、侧栏固定状态位 | 快速完成、等待、失败、停止、迟到事件、多会话和重启 | 完成：thread-activity 测试与 ui/activity |
| P3 | 会话工作区、SQLite 扩展配置、资源快照、线程同步 | 文件/产物隔离，旧会话兼容，A 运行时更新不影响 A，下一轮采用更新，恢复可用 | 完成：65 项相关测试、原生 5 项、ui/workspaces |
| P4 | 扩展四分类、专家 CRUD、持续会话引用、原生展开 | 真正影响模型输入/工具能力；去重、失效依赖、恢复、权限与 UI 回归 | 完成：experts 自动测试、native/experts-native.json、ui/experts |
| P5 | 综合回归、文档、测试服务更新 | 类型/构建/相关自动和浏览器测试；无活动任务时安全更新；公开入口资源核对 | 完成：automated、ui/regression、service |

按实现→验证→修复→记录连续推进，无需重复确认。只把具备证据的条目标为完成；外部阻塞单列，不以隐藏提示、模拟能力或重建线程替代真实生效。

## 接口与兼容

- 扩展 gateway/save、gateway/catalog 及私密保存元数据，支持手工模型和来源；所有入口沿用白名单、并发版本检查和失败回读。
- 扩展现有控制 API 的目录、专家与会话扩展方法，不暴露任意 RPC；workspace/files 必须绑定 threadId，不接受浏览器 cwd。
- SQLite 从 v7 顺序增量迁移；保存稳定资源、专家、工作区绑定、运行快照和状态，不复制完整历史。先持久化后发布内存状态。
- 运行请求同时固定 Provider、会话设置、扩展目录和专家修订，加入幂等上下文；同步失败保留草稿和原确认状态。
- 普通 Provider 不重新写 config.toml；新拓展普通配置由 SQLite 管理，原生安装缓存/资源文件/会话仍保留。管理员和外部只读来源保持权限。

## 设计与参考

延续当前石墨灰界面，安静、准确、利落；4px 间距、统一文本起线、固定状态与操作位；色彩表达选中或真实状态。卡片桌面双列/手机单列、长摘要按需展开。取消冗余解释，不添加“了解更多”；必要的错误、权限、恢复操作保留。

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)、[技能](https://learn.chatgpt.com/docs/build-skills)、[项目根](https://learn.chatgpt.com/docs/config-file/config-advanced)、[插件格式](https://developers.openai.com/plugins/build/plugins)。最新文档不是固定二进制兼容性的替代。
- [Carbon 可选择卡片](https://www.carbondesignsystem.com/building-blocks/core/components/tile/guidelines)、[Fluent 通知](https://fluent2.microsoft.design/components/web/react/core/toast/usage)。
- UI/UX Pro Max 查询的可见焦点指导适用；第一次 card actions 查询不贴合，不采用其泛化成功 toast 建议。Unslop 的间距、色彩、文案方法来自 [Damir Sokolovsky](https://x.com/heydamir)，CC BY 4.0。

## 本轮收尾

P0–P5 已完成。最终 355 项自动测试、18 项原生检查、90 组浏览器检查通过；原生检查使用真实固定 Codex 和本地模拟上游，不代表真实付费 Provider 兼容性验收。测试服务已备份并更新，公网资产与磁盘构建一致。

- 保留边界：独立目录不是 OS 隔离；原生共享插件安装/卸载和环境凭证轮换仍需空闲；正式部署、双真实 Provider、OAuth 和长期运行验收继续后置。
- 旧记录核对：19 个有原生 SQLite 记录的旧会话 cwd 与绑定一致；另外一个既有空会话没有原生持久记录和执行记录，原样保留，没有重建线程冒充恢复。见 `service/legacy-roots.json`。
- 所有需求的完成证据均在本目录；没有未解决的本轮实施阻塞。使用说明见 [会话工作区与扩展](../../docs/session-extensions.md)。
