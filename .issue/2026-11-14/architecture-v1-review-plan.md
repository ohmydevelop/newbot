# ARCH-01 · 用户 Newbot v1.0 架构评审与修订计划

> 2026-11-14 后续执行入口已更新为 [NB-V1正式实施计划](newbot-v1-implementation-plan.md)。本文件保留历史选型/评审证据；涉及默认视觉、备选框架与阶段安排，以NB-V1为准。

日期：2026-11-14。仅评审，不安装依赖、不实施迁移、不改变服务。原文为本会话用户提供的《Newbot 最终确定性技术架构 v1.0》，不改写原始反馈。以下为评审意见，不能当作原文已具备的保证。

## 目标、状态与评审结论

目标：唯一CopilotKit集成框架、AG-UI、A2UI1.0、独立MCP Apps Host、Apps SDK UI默认设计系统、轻量私有化、Codex和多模型/多主机可演进。预期是可冻结且可验证的工程契约，实际文案已给出清晰分层，但包含未验证的包级冻结和未定义的安全/执行所有权。

结论：**有条件通过架构方向，不宜原样作为全部可实施且兼容的版本基线。** 固定框架/协议/视觉方向；具体renderer与包版本通过最小样例后冻结。允许官方SDK适配与产品权限边界，不允许重复实现协议客户端或第二Agent Loop。

本次提案明确Apps SDK UI/ChatGPT为默认视觉，评审以此为新方向；此前Grok逐像素约定与STACK-02的shadcn默认配方需在正式采纳时更新。折叠、即时发送、滚动、附件分块等用户行为约定继续保留。用户明确排除assistant-ui，后续不自动切换到STACK-02原备选，遇到阻塞应记录并修订实施方案。现有历史文档不覆盖，不把技术评审扩为产品改造。

## 已确认事实与依据

- 当前源码检查点d9f9d56、计划检查点40754bf；当前server/web/shared目录已有MCP Host、A2UI0.9、凭证、OAuth、模型配置、恢复机制，不是空白项目。
- 当日注册表再次读取并保存architecture-v1-package-evidence.json：Apps SDK UI0.2.2 peer允许React18/19、Tailwind^4.0.10，dependencies含radix-ui以及react-markdown/react-syntax-highlighter等；独立Vite应用实际运行/Tree-shaking未测。
- A2UI React0.15.0依赖web_core^0.15.0和markdown-it^0.2.2；markdown-it0.2.2 peer为web_core^0.14.0，区间不相交。React包未列/v1_0导出，web_core列出/v1_0。根入口行为需执行验证，缺少子路径不等于断言完全不能渲染1.0。
- CopilotKit TypeScript Runtime使用AgentRunner的run/connect/isRunning/stop管理生命周期；官方允许应用自有持久化。仅写前端CopilotKit+AG-UI不等于已经明确服务端接入和恢复。
- server/bridge.ts新线程注册dynamicTools:[a2uiTool]；server/codex.ts接收item/tool/call。当前不是所有任意前端Actions都已向Codex注册。
- shared/mcp-app-host.ts当前默认inline且禁网络/外链/下载/modelContext等；Docker/数据库复杂应用的能力不能仅靠新iframe自动获得。
- docs/runner-architecture.md说明远程节点开发通道已有测试、主Bridge仍本地，资源同步/完整恢复未交付。不能再造一个语义相同的connector，也不能将现有隔离目录当成多Bot强安全隔离。

## 问题、不变量、关联范围与建议

| ID/优先级 | 约定及现象 | 证据状态与共同范围 | 修订/验收 |
|---|---|---|---|
| A1/P1 | 协议版本不等于SDK兼容；固定@a2ui/react与当前peer冲突 | 有元数据证据；渲染、Catalog、历史、action均关联 | 冻结A2UI1.0；renderer作为锁定版本兼容验证项。无force安装，官方示例+自有Catalog+旧0.9恢复通过再冻结；没有实测前不宣布可用 |
| A2/P0 | 执行/历史应有唯一权威，图缺CopilotKit Runtime/Runner | 有官方接口与现有源码证据；发送、恢复、取消、分页、切换 | TS Runtime嵌入同Server；AgentRunner薄适配现有请求账本/事件流。Codex唯一执行者；newbot持有归属/回执；UI是投影。connect不run、重复提交不重复执行 |
| A3/P0 | “模型网关/MCP Gateway/Host Connector”可能形成重复执行路径 | 架构职责歧义，待设计明确；模型、主机命令、App工具 | providers默认为Provider配置/路由适配，非新推理循环；MCP Gateway仅负责必要路由/授权，复用同一会话授权路径。Host Connector对应现有Runner演进，不另建一套控制协议 |
| A4/P0 | CopilotKit前端Actions不会自动成为Codex工具 | 有源码证据，端到端待验证；前端action/A2UI action/MCP调用/人工审批 | 统一actionId/botId/sessionId/turnId、schema、版本与授权范围；映射native动态工具调用与结果回传。仅匹配一次结果，断线/刷新/超时有状态，危险副作用在Server执行 |
| A5/P0 | 模型生成审批内容不能定义权限，服务端授权≠任意A2UI按钮 | 设计需补边界；授权、凭证、插件配置、主机执行 | security-ui显示Server生成的待授权意图和规范化参数；绑定实际操作和有效期，一次消费。模型Catalog仅普通表单/确认，不得伪造安全授权框；私密字段不进入AG-UI shared state |
| A6/P0 | “敏感数据不进入模型”范围无限，无法以当前边界证明 | 有既有凭证通道及架构边界证据；日志、工具结果、历史、遥测 | 改为系统管理凭证/密钥/私密字段原值不进入模型、普通事件/日志/遥测；按接收方短时注入。业务敏感内容另有数据分类、投影、脱敏与批准策略；不得声称任意用户粘贴或工具返回的秘密自动消除 |
| A7/P0 | Bot隔离缺bot定义与执行隔离，生产化阶段过晚 | 待验证；现有单实例与Runner设计不能证明多Bot隔离 | 明确botId→Home/工作区/配置/凭证/审批/存储/节点身份。文件系统/进程/容器或OS权限边界按威胁模型选择；目录不同不等于同UID任意命令隔离。第一阶段设计数据归属，最后阶段才做规模化验收 |
| A8/P1 | 统一设计系统应避免SDK+Radix+Markdown双实现，iframe不能被父CSS强制统一 | 有包元数据证据；表单、弹层、深色、A2UI、第三方App | Apps SDK UI已有控件优先复用；Radix补缺。自有组件/A2UI映射一套tokens；第三方MCP Apps通过标准主题上下文尽力一致，禁止破坏origin隔离强制注入CSS。Markdown选择一条产品渲染路径 |
| A9/P1 | “Provider切换不重启Server”未定义切换作用于哪一轮 | 有当前runtime/revision机制证据；运行中任务/新轮次/能力 | 接受请求时冻结provider/model/revision；运行中轮次不被配置变化改写，下一轮使用新配置；不支持热重配的native可有序重建，Web Server不重启。回传实际生效版本 |
| A10/P2 | 全仓目录移动与行为迁移同批会遮蔽回归 | 工程风险判断，未复现；imports/build/tests/native部署 | 目录作为目标边界；原目录先做适配，以纯移动提交分离迁移。contracts/ui无server依赖，安全实现留Server，security-ui仅呈现/通道；不要提前为所有模块加发布流程 |
| A11/P2 | Motion/Monaco固定采用不等于首屏加载 | 产品预算待测；手机输入、Diff、WebWorker/CSP | Motion按交互使用并尊重reduced-motion，Monaco按编辑入口懒加载，普通消息代码用现有高亮；移动编辑需实际验收 |

## 可冻结的架构契约（建议补入原文）

1. CopilotKit是唯一Agent前端集成框架，Codex是唯一执行循环；使用官方AG-UI SDK和标准适配点，不自行实现第二客户端状态机。
2. CopilotKit TS Runtime位于Newbot Server，AgentRunner包装既有执行/回执/历史，不另存一份可互相覆盖的权威聊天历史。Zustand仅管理shell/设置/普通草稿等非Agent状态。
3. Codex持有native执行历史，Newbot Server持有逻辑会话归属、可确认检查点、授权和配置；前端持有可重建投影。若需要中心历史权威，应另定义不可变事件日志与一致性协议，而不是重复写三份历史。
4. Provider/MCP Gateway先定义具体功能和已有承载点；不得复制Codex的模型/工具循环。现有Runner与Host Connector使用一个身份/操作回执体系。
5. A2UI协议1.0固定；renderer优先官方兼容实现，包版本只有在安装、Catalog和恢复样例通过后固定，变更通过ADR留痕，不自动换Agent前端框架。
6. Apps SDK UI是默认设计系统及tokens来源，自有安全/业务组件组合官方控件；“使用独立宿主”不等于模拟window.openai，组件库与ChatGPT宿主扩展分开。第三方App主题是能力协商，不是强制继承。
7. 普通A2UI确认不能授予宿主权限；实际审批由Server产生且绑定具体操作。前端Actions分纯UI动作和服务端副作用，后者必须经过同一授权边界。
8. 系统凭证严格走私密通道；业务敏感内容采用明确的数据出站策略。各Bot默认拒绝跨边界，执行隔离与逻辑过滤分别验收。

## 建议调整的实施顺序

P0：冻结身份/状态/权限/事件契约、最小数据迁移方式和性能基线；保留当前生产入口。把版本兼容POC放在最前。
P1：同一最小样例同时贯通Codex→AG-UI→CopilotKit TS Runtime→UI，并用Apps SDK UI渲染普通回复/一个A2UI1.0表单/一个MCP App；测试一次前端action与一次受控审批。不是做完聊天再发现后两种UI不兼容。
P2：迁移聊天、工具状态、思考折叠、附件和恢复；默认视觉按新提案Apps SDK UI实施；保留原用户功能约定。建立单一消息和事件所有权，删除被替代基础代码。
P3：完善A2UI Catalog与Apps Host策略，深层插件/设置复用新设计系统，保留旧数据兼容。
P4：复用已有Runner扩展多主机/多Bot隔离，完成Provider生效边界、凭证/备份/故障接管；权限设计从P0起实施，不能拖到此时。
P5：性能/安全/恢复验收、native兼容、旧实现删除、备份部署和回滚演练。目录重排单独提交。

## 最小验证矩阵

- 安装：精确锁版本、干净npm ci、不用force；React19/Tailwind4/独立Vite不依赖ChatGPT宿主全局对象；SDK重合依赖与产物体积有报告。
- 消息：一次点击仅一个native turn；刷新只connect；重复事件幂等；旧会话/旧epoch不改变当前状态；中断仅停止对应任务。真实模型与模拟故障分开记录。
- Actions：合法注册→native请求→浏览器动作→同callId结果；离线、双标签、重复结果、过期、拒绝不能重复产生副作用；无浏览器时保留等待/取消而不伪造成功。
- 动态界面：1.0 create/update/delete、绑定/action、Apps SDK UI映射、旧0.9历史、reload/重启；未知组件、超限、失效action拒绝。
- 授权：篡改botId/sessionId、审批参数、重放token、跨App/跨MCP Server均拒绝；合成密钥不出现在AG-UI、模型请求、普通日志和遥测；真实凭证不用于负向泄漏测试。
- 多Bot/主机：两个Bot访问同名工具和不同凭证，交叉请求拒绝；实际代码执行尝试读取另一Bot工作区/环境失败；撤销节点与旧租约、未知副作用不自动重放；远端恢复必须真实双进程/必要时双主机，不把目录模拟称物理隔离。
- Provider：请求中切换，当前轮保持原版本，下一轮采用新版本；失败回滚可观察且Web Server不重启。
- UI：PC/平板/手机、明暗主题、键盘、长消息、折叠/滚动衔接、附件分块、状态位置、前端Actions等待/失败；Monaco及图表懒加载单独验证。
- 发布：旧数据可读，新增字段向后兼容，dist/native/DB备份可回滚，公网入口和资源匹配，不用最新包号替代实际运行版本确认。

修复范围：本轮只修改/新增评审记录与证据；不落实产品代码。实施条件是通过上述POC后更新实际版本基线。依赖/未知项：官方包兼容路径、Fastify handler、前端action断线机制、Bot信任模型、多主机完整恢复。当前没有声称它们已实现。

## 官方来源

- https://developers.openai.com/plugins/concepts/ui-guidelines （设计系统为可选组件库，不是完整ChatGPT客户端）
- https://developers.openai.com/plugins/build/chatgpt-ui （组件库与宿主扩展分开）
- https://docs.copilotkit.ai/backend/agent-runner （Runner契约）
- https://docs.copilotkit.ai/backend/copilot-runtime （TypeScript自托管路径）
- https://a2ui.org/concepts/sdks/ （协议与SDK分层）
- architecture-v1-package-evidence.json记录当日官方npm源URL及精确版本/peer/exports。
