# 富表面使用率：A2UI 与 MCP App 的触发机制

## 问题与用户目标

用户提问（2026-11-12）：如何让模型高频使用 A2UI，如何让模型尽可能使用 MCP App。

拆成四个可验证的问题：

- RS-01 A2UI（`newbot_ui`）实际使用率低：模型即使有工具也倾向输出 Markdown。
- RS-02 MCP App 出现率低：模型不知道哪些工具的结果会渲染成交互界面，也没有被引导优先调用。
- RS-03 存量线程永远拿不到 `newbot_ui`，功能只对建线程之后的对话可用。
- RS-04 A2UI 失败后模型缺少可操作的修复信息，一次失败即退回 Markdown。

用户目标：在不放宽任何权限、不虚构内容的前提下，让模型在“结构化答案 / 可交互对象”这类场景**默认选择富表面**，并让失败可恢复。

## 实际行为与预期行为

| 编号 | 触发条件 | 实际行为 | 预期行为 |
| --- | --- | --- | --- |
| RS-01 | 用户要求对比两组以上数值、给指标卡、填表 | 多数输出 Markdown 表格或纯文本 | 默认用 `newbot_ui` 的 Chart / Metric / 表单承载 |
| RS-02 | 用户要求查看/监控某个已有 MCP 工具管理的对象 | 模型可能自己拼 A2UI 或让用户看 JSON | 优先调用带 `ui://` 的工具，让其结果渲染成 App |
| RS-03 | 继续 2026-11-07 之前创建的线程 | 没有 `newbot_ui`，只能 Markdown | 明确记录为协议阻塞，界面/指令不得谎称可用 |
| RS-04 | 一次 A2UI 调用参数不合法 | 得到 `{error:"INVALID_MESSAGE", hint:"Use the registered catalog version, ..."}` | 得到指出“缺什么/怎么改/重试一次”的提示 |

## 被破坏的不变量

1. **可用性必须来自真实注册**：指令不得让模型以为存在未注册的工具或组件。
2. **呈现选择不影响权限**：提示词只调整表达方式，不改变审批、工具范围、`visibility` 或会话校验。
3. **老线程不得冒充新契约**：`thread-ui != v2` 的线程不能被引导使用 v2 组件。
4. **事实优先**：追求卡片不得导致数据、来源或限制说明丢失；不得同一份数据重复展示两次。
5. **失败可达**：一次失败后模型应能自我修正并重试一次，而不是静默降级。

## 已知证据

- `server/presentation.ts:1`：现在的措辞是 `Use visualizations when they improve the answer` … `Short/simple answers should stay text`；`server/a2ui-tool.ts` 描述末尾还有 `For normal answers use Markdown instead.`——最后读到的一句是劝退。
- `server/bridge.ts:1687`：`dynamicTools: [a2uiTool]` 只出现在 `thread/start`。
- `generated/codex/v2/ThreadResumeParams.ts:29`：`ThreadResumeParams` 没有 `dynamicTools` 字段（只有 `ThreadStartParams.ts:72` 有），因此 RS-03 无法靠 resume 补工具，需要内核补丁。
- `server/mcp-apps.ts:73-106`：只有 `mcpToolCall` 结果带 `ui://` 资源才产生描述符；`catalog` 只在 `refresh()`（`mcpServerStatus/list`）时建立，模型侧看不到“这个工具带界面”的信号。
- `server/mcp-apps.ts:303-328`：资源必须是匹配 URI 的 `text/html`、≤2 MiB。
- `server/a2ui.ts:400-419`：失败返回 `error` 码 + 固定通用 hint。

## 根因判断

- RS-01：三层抑制叠加——(a) 指令用“能改善时”这种无判定标准；(b) 结尾显式劝退 Markdown；(c) 单次调用要求“一次给全 + 引用已存在”，失败成本高且失败后提示不可操作。
- RS-02：**模型的决策依据里没有“哪些工具带 App”这一项**。工具描述由 MCP server 作者撰写，Codex 传给模型的工具表不含 `_meta.ui`。宿主侧唯一可用杠杆是把已发现的目录投影进 `developerInstructions`，并给出触发语。
- RS-03：协议字段缺失，属阻塞项，不是文档遗漏。
- RS-04：错误码没有映射到修复动作。

## 尚未确认的假设

- H1：把触发条件写成可判定规则 + 一个最小示例，能显著提高 `newbot_ui` 使用率。未验证（需对照实验，见验收）。
- H2：在 `developerInstructions` 里列出 App 可渲染工具，会提高模型调用这些工具的倾向。未验证；但该列表来自真实目录，不引入虚假能力。
- H3：每轮下发 App 清单不会明显拖慢首次响应（清单来自缓存，刷新在后台）。

## 同类风险清单

| 关联功能 | 共同机制 | 检查结果 | 处置 |
| --- | --- | --- | --- |
| 普通问答被过度卡片化 | 同一份 `developerInstructions` | 有代码证据：无反向约束时规则会覆盖简单问答 | 纳入：写死“简短对话保持文本、同一数据不重复”；验收含反向指标 |
| v1 老线程误用 v2 组件 | `presentationInstructions(rich)` 分支 | 有代码证据：分支已存在但措辞松散 | 纳入：分支保持互斥，单测断言 |
| 存量线程缺工具（RS-03） | `dynamicTools` 仅 `thread/start` | 有代码证据：`ThreadResumeParams` 无该字段 | 排除实现，记录阻塞与界面限制 |
| App 清单过长/陈旧 | 每轮 `developerInstructions` | 待验证 | 纳入：上限 20 条 + 10 分钟 TTL，后台刷新失败不影响回合 |
| 目录刷新阻塞发送 | 新增刷新触发点 | 待验证 | 纳入：只做后台刷新，不 await；首轮可能缺清单，记录 |
| 权限被提示词放大 | 提示词 vs 服务端校验 | 不适用：`apps.authorize`/`validate` 每轮重算，`newbot_ui` 仍走服务端校验 | 排除，只需在文案中避免“已授权”表述 |
| 自动度量面板 | 无现成埋点 | 待验证 | 排除本轮；给出人工对照方法 |
| 前端“生成卡片/转成图表”入口 | 前端交互 | 不适用本轮 | 排除，列为后续 |
| 模型选择策略 | 不同模型工具服从度差异 | 不适用本轮 | 排除，记录为后续实验 |

## 修复范围

1. `server/presentation.ts`：改为三级呈现优先级 + 可判定触发条件 + 一个最小示例，并把 App 可渲染工具清单作为参数注入。
2. `server/a2ui-tool.ts`：重写描述——触发条件前置，删除劝退句，保留全部安全与结构约束。
3. `server/mcp-apps.ts`：新增 `appTools(threadId)`（只读缓存目录，只列有 `ui://` 的工具）与 `catalogFresh()` 时效查询；目录裁剪时同步清理时间戳。
4. `server/bridge.ts`：`executionContext` 注入清单；`thread/start` 与 `turn/start` 后台触发目录刷新（10 分钟 TTL，不阻塞发送）。
5. `server/a2ui.ts` + `shared/a2ui-policy.ts`：失败提示按错误码映射为可执行的修复说明，并明确“修正后重试一次”。
6. 测试：新增指令/提示/目录投影单测；回归 A2UI 与 MCP App 既有测试。
7. 文档：`docs/mcp-app-host.md` 增补“使用率”说明。

## 明确不处理

- `thread/resume` 下发 `dynamicTools`（协议无字段），不做内核补丁。
- UI 侧“生成卡片 / 转成图表 / 打开应用”入口改版。
- 模型自动选择、埋点与看板上线。
- 任何权限、审批、`visibility`、沙箱策略的放宽。

## 实施顺序与依赖

S1 指令与工具描述（纯文本，零行为风险）→ S2 目录投影（`appTools` + 注入 + 刷新触发）→ S3 失败可修复提示 → S4 测试与类型/构建 → S5 记录。

依赖：S2 依赖 S1 的 `presentationInstructions` 签名；S4 依赖前三个阶段的实现。

数据兼容：不改数据库、不改线协议、不改双方沙箱；老线程行为保持不变（指令分支互斥）。

## 验收标准

- 单测：`presentationInstructions(true, [...])` 含三级优先级、触发条件、重试一次、App 工具清单；`presentationInstructions(false)` 不含 v2 组件与清单。
- 单测：`appTools` 只返回目录中带 `ui://` 的工具；未知线程返回空；TTL 生效；目录裁剪后时间戳被清理。
- 单测：`a2uiRepairHint` 对 `INVALID_MESSAGE` / `RESOURCE_LIMIT` / `INVALID_JSON` / `ui_storage_unavailable` 给出不同且可执行的说明。
- 回归：`tests/a2ui-agent.test.ts`、`tests/mcp-app-lifecycle.test.ts`、`tests/mcp-app-host.test.ts` 通过；`npx tsc --noEmit` 与 `npm run build` 通过。
- 人工对照（不在本轮自动断言）：固定 10 条提示词，改动前后各跑一次，记录「含 `newbot_ui` 的轮次占比」「A2UI 首调失败率」「`mcpToolCall` 中 `appAvailable` 占比」「简单问答被卡片化的比例」。

## 完成状态

见 `rich-surface-usage-progress.md`。证据目录：`.issue/2026-11-12/evidence-rich-surface/`。
