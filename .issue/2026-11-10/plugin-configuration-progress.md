# 插件统一配置进度

## S0 调查完成

- 用户确认：插件详情内统一管理连接器与技能；最终用户只填写插件需要的业务设置，不手工编辑启动命令。
- 只读核对实际服务与 SQLite：CloudWalker 0.5.0 已安装、两个技能选中、原生 MCP 列表为空；导入源为原始 ZIP。保存 [安装基线](evidence-plugin-configuration/installed-baseline.json)。
- 当前前端资源与本地产物一致，未改变服务、配置或用户安装。先前导入进度的“尚未安装”是当时状态，本轮用户已自行完成安装。
- 核对统一插件入口、连接器编辑限制、凭证绑定、技能启停路径。PC-01 至 PC-05 见 [计划](plugin-configuration-plan.md)。
- 隔离 Codex 0.165.0 探针：原生插件 MCP 正常启动，嵌套 env 覆盖被忽略；顶层同名 MCP 覆盖生效但原生 pluginId 变为 null；原生插件 MCP 启停有效。仅调用合成 inspect 工具，无真实模型/牧云业务请求，临时目录已清理。证据：[native-overrides.json](evidence-plugin-configuration/native-overrides.json)，[探针](evidence-plugin-configuration/native-overrides-probe.mts)。
- 官方标准调研：MCPB user_config、MCP Registry 参数描述、Agent Plugins schema 与 OpenAI userConfig 兼容限制均已读取。建议宿主支持标准描述适配，不把这些字段误称为 MCP 核心握手能力或当前 Codex 原生支持。

## S1 配置描述 — 已实施，针对性验证通过

- 添加 MCPB `user_config` 适配及版本化宿主关联扩展；支持文本、数字、开关和敏感字段，拒绝敏感值进入命令/URL、受保护环境变量、不支持的模板及配置格式。
- CloudWalker 当前安装包的完整摘要与兼容描述匹配，实际解析结果只有“牧云平台地址”和“API Token”。原包保持原样。
- 导入预览同时读取包声明的连接器名称，不再将原生发现遗漏误报为包内无 MCP。

## S2 运行适配与凭证 — 已实施，针对性验证通过

- SQLite v14 增量保存插件连接配置，复用 AES-GCM 凭证库和私密二进制通道；普通值与秘密同事务提交，带对象修订、接收方绑定和操作回执。
- 运行参数通过插件专属稳定名称下发，原生插件的同一 MCP 禁用以防重复；状态显式记录 `ownershipSource: newbot-plugin`，不伪造原生 pluginId。
- 5 项新增测试通过，覆盖重启、同名隔离、并发、包/地址变化、清除、HTTP 私密头与非法描述；已有私密字段测试 4 项通过。
- 实际 Codex 0.165.0 隔离验证：两个插件同名 MCP 正常执行合成工具、读取标准 MCP App HTML，收到各自测试参数；停用只影响下一线程，旧线程仍可工作；原生技能结构保留，线程配置包含单技能禁用。原生状态文件未出现测试秘密。见 [runtime-adapter.json](evidence-plugin-configuration/runtime-adapter.json)。这是合成 MCP 验证，不代表牧云真实业务联调。

## S3 统一插件入口 — 已实施，等待浏览器验收

- 插件详情集中配置连接器、查看工具目录和技能说明、逐项启停；秘密只显示保存状态，可替换和清除，结果未知时先查询操作回执。
- 服务端公共技能目录、`$` 候选和专家可选技能排除插件组件；连接器列表依据归属过滤，即使插件目录读取失败也不会泄漏到独立管理页。
- 旧会话待发送引用与专家成员通过稳定资产归属归并为插件；历史消息保持原记录。
- 2026-11-10 当前 CUA 返回 `Local browser use is disabled in Work settings`，无可用浏览器。真实桌面、手机、主题和键盘验收受阻，不用 API 或构建替代视觉验收。

## S4 回归与测试服务 — 已验证（真实浏览器除外）

- 最终全量自动测试 **392/392** 通过，类型检查通过，见 [tests.log](evidence-plugin-configuration/tests.log)。新增插件测试覆盖私密保存回执、登录归属、跨插件技能访问拒绝、独立连接器/技能接口拒绝编辑插件组件、旧草稿和专家归并，以及资源安装空闲锁。
- 原生探针扩展为两个 stdio 插件和一个 HTTP 插件，均使用同名连接器；Bearer、自定义头和环境变量分别到达正确接收方。两个本机 Responses 请求证明：启用技能实际进入能力上下文，停用技能缺席，测试密钥未进入请求；未使用真实模型供应商。见 [runtime-adapter.json](evidence-plugin-configuration/runtime-adapter.json)。
- 同类排查发现导入曾复用私密配置热更新的免空闲路径，现改为资源专用互斥边界；参数/密钥仍可保存用于下一轮，安装和替换等待空闲并撤销旧 App 视图。
- 构建通过，Vite 保留既有大型图表/高亮资源分块提示，未视为构建失败。设计检测仅提示现有 Markdown `blockquote` 的引用线，它是语义引用样式，非插件卡片装饰，保留。见 [design-detect.json](evidence-plugin-configuration/design-detect.json)。
- 备份后在空闲维护窗口更新服务，SQLite 13 → 14；23 个会话、68 个请求、5 个附件未变，抽查 3 个历史结构一致。Provider、登录密码、加密主密钥、个人与实例 Codex 配置均未改动。见 [迁移验证](evidence-plugin-configuration/service/migration-update.json) 和 [最终服务更新](evidence-plugin-configuration/service/local-update.json)。最终又校正插件内说明页的来源标签为“插件技能”，避免归类为独立用户技能；相应构建、服务及公网资源再次核对。
- 实际服务读取：CloudWalker 保持已安装、两个原生技能完整；连接器显示平台地址和 Token 待填写。独立技能目录剩 5 项且无插件组件，普通连接器配置不包含插件目标。公网静态资源与本地构建摘要一致。见 [live-readback.json](evidence-plugin-configuration/live-readback.json)。
- 用户的 CloudWalker 凭证未收集、未填入测试值、未调用真实业务接口。浏览器控制关闭这一限制仍存在，因此真实视觉、键盘和 iframe 交互不能标记验收完成。

作者说明已保存到 [docs/plugin-configuration.md](../../docs/plugin-configuration.md)（仓库文档）；插件关联扩展与固定内核适配边界均已明确说明。
