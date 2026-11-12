# 富表面使用率：实施记录

对应计划：`rich-surface-usage-plan.md`。日期：2026-11-12。

## 阶段状态

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| S1 | 呈现优先级与工具描述改写 | 完成 |
| S2 | App 工具目录投影（`appTools` / `catalogFresh` / 后台刷新） | 完成 |
| S3 | A2UI 失败按错误码给出修复动作 | 完成 |
| S4 | 单测 + 全量回归 + 类型 + 构建 | 完成 |
| S5 | 文档、记录与开发服务同步 | 完成（真实对话的触发率对照仍待做） |

## 改动

### 1. 每轮呈现优先级（`server/presentation.ts`）

`presentationInstructions(rich, appTools)` 改为固定三步：带 `ui://` 的 MCP 工具 → `newbot_ui` 富表面 → Markdown。富表面分支给出可判定触发条件（≥2 组可比数值→Chart，≥3 条标签/数值→Column+Metric，已有图片→Image，≥2 字段→表单），附一个最小可用调用示例，并要求失败后读 `error`/`hint` 修正再重试一次。同时保留“同一数据不重复、短对话保持文本、不虚构数据/来源”的反向约束。

v1 分支（`thread-ui != v2`）保持互斥：不下发 v2 组件、不提 `waitForAction`；但真实的 App 可渲染工具仍会列出（App 与 A2UI 版本无关）。

### 2. 删除劝退措辞（`server/a2ui-tool.ts`）

工具描述改为触发式开头（“答案结构化时优先”），删除末尾 `For normal answers use Markdown instead.`，保留全部结构、安全与授权边界说明，并加入“一次给全、更新而非重建、失败修正后重试一次”。

### 3. App 工具目录投影（`server/mcp-apps.ts`、`server/bridge.ts`）

- `appTools(threadId, limit=20)`：只读当前线程缓存目录，只返回声明了 `ui://` 的工具；未知线程返回空。
- `catalogFresh(threadId, ttlMs)`：目录时间戳查询；目录裁剪（>32）时同步清理时间戳。
- `appCatalog(threadId)`：10 分钟 TTL，后台 `refresh`，失败静默，不阻塞发送；在 `thread/start` 与 `turn/start` 触发。
- 注入点覆盖两处 `executionContext`（基础版与插件版包装），避免后者覆盖丢失清单。

### 4. 失败可修复（`shared/a2ui-policy.ts`、`server/a2ui.ts`）

新增 `a2uiRepairHint(code)`：`INVALID_JSON` / `RESOURCE_LIMIT` / `FORBIDDEN_KEY` / `INVALID_MESSAGE` / `invalid_ui_arguments` / `ui_storage_unavailable` / `ui_request_rejected` 各自给出可执行动作并统一要求“修正后重试一次”；未知码回退到完整树说明。错误码本身不变（对外契约不变）。

## 验证结果

- 新增 `tests/rich-surface-usage.test.ts`（5 项，全部通过）：
  - 三级优先级、触发条件、示例、重试要求、App 工具名注入；
  - 未缓存时不得虚构工具名；v1 分支不含 v2 组件与 `waitForAction`；
  - `appTools` 只投影带 `ui://` 的工具、支持 limit、未知线程为空、TTL 生效；
  - 修复提示互不重复、可执行、不含绕过授权的表述；
  - 新线程后台刷新后，`executionContext` 的 instructions 含真实工具名（集成，FakeCodex）。
- 相关回归：`tests/a2ui-agent`、`a2ui-baseline`、`a2ui-catalog`、`mcp-app-lifecycle`、`mcp-app-host` 共 78 项全部通过。
- 全量 `npm test`：495 项，494 通过、1 跳过（既有跳过项）、0 失败，日志 `evidence-rich-surface/full-tests.log`。
- `npx tsc --noEmit` 通过；`npm run build` 通过，日志 `evidence-rich-surface/build.log`。
- 开发服务已用新构建重启两次（首次 3296511 → 3365126；撤销 `server/bridge.ts` 的无关格式化后重建，最终 PID 3373227，`:3100` ready）。公网入口复查：首页 200、`/api/health` 200、匿名 `/api/config` 401、App 域 `/api/config` 403、首页资源 200。证据 `evidence-rich-surface/service-restart.json`。
- 新构建产物已包含新指令文本（`dist/server/index.js` 中可检索到 `MCP app tools` 与 `results render a live interactive app`）。

## 未完成项与边界

1. **RS-03 存量线程仍无法使用 `newbot_ui`**：`generated/codex/v2/ThreadResumeParams.ts:29` 没有 `dynamicTools` 字段（只有 `ThreadStartParams.ts:72` 有）。要覆盖必须改内核补丁，不在本轮范围；指令分支已明确禁止这些线程冒充 v2。
2. **真实对话的触发率对照未做**：需要固定 10 条提示词前后各跑一轮，统计“含 `newbot_ui` 的轮次”“A2UI 首调失败率”“`mcpToolCall` 中 `appAvailable` 占比”“简单问答被卡片化的比例”。本轮只有单测与构建证据，不宣称使用率已提升。
3. **首轮可能缺 App 清单**：目录刷新在后台进行，线程建立后的第一轮可能尚未完成刷新；第二轮起生效。这是“不阻塞发送”的取舍。
4. 前端入口（“生成卡片/转成图表”）、模型自动选择、埋点看板不在本轮。

## 证据位置

- `.issue/2026-11-12/evidence-rich-surface/full-tests.log`
- `.issue/2026-11-12/evidence-rich-surface/build.log`
- 代码：`server/presentation.ts`、`server/a2ui-tool.ts`、`server/mcp-apps.ts`、`server/bridge.ts`、`server/a2ui.ts`、`shared/a2ui-policy.ts`
- 文档：`docs/a2ui-agent.md`、`docs/mcp-app-host.md`
