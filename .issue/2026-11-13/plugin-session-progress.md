# 插件会话问题：进度

对应计划：`plugin-session-plan.md`。日期：2026-11-13。

## 问题 1（已完成）

**根因**：`privateFieldBinding` 把 `packageDigest` / `schemaDigest` 算进接收方指纹，插件升级即换指纹；`plugin-connections.secrets()` 只接受 pre-portable 旧格式，其余直接丢弃，于是私密字段既不显示也不注入。

**修复**：

| 改动 | 文件 |
| --- | --- |
| 绑定改为“目的地”语义：去掉包/结构摘要，保留 pluginId、connector id、url、command、args、env、cwd、headers | `server/private-fields.ts` |
| 新增 `previousPrivateFieldBinding`（portable + 摘要）与统一的 `reconcilePrivateRow()`：旧行在目的地未变时解密并按新指纹重封 | `server/private-fields.ts` |
| 插件连接读取、`saved()`、`info()` 都走同一迁移入口 | `server/plugin-connections.ts`、`server/private-fields.ts` |
| 复核文案改为“凭证会保留”，复核与停用门禁不变 | `server/plugin-connections.ts` |

**安全边界保持**：包更新后连接仍 `reviewRequired` 且 `enabled=false`，用户复核保存前不会运行新代码；URL / command / args / env / headers / cwd 任一变化仍使凭证失效。只有“同一接收方 + 新版本代码”会保留凭证。

**测试**（`tests/plugin-configuration.test.ts`，15 项全通过）：

- 升级（仅摘要变化）后 `env.SERVICE_KEY` 仍注入；
- 改 URL 后不再注入；
- 旧的“摘要绑定”行首次读取自动重封到新指纹；
- 既有“物理绑定不会被静默重绑”用例仍通过；
- 原“升级使代码绑定凭证失效”用例改为“升级需要复核但保留凭证”。

**已知限制**：本次修复之前已经升级过的实例（当前这台）凭证已经失效且无法自动恢复，需要重新填写一次；之后升级不再丢失。

## 问题 2（部分完成）

**A. `@` 不提插件**：`mentionAt` 原来要求 `@` 前是行首或空白，中文“帮我@”不触发。改为“前一字符不是 ASCII 字母/数字/下划线，也不是 `$`/`@`”，于是 CJK 与中文标点后可触发，`foo@bar`、`a$b`、`@@test` 仍不触发。测试：`tests/composer-selection.test.ts` 3 项通过。

**B. 下一轮插件丢失**：确认是现有语义——`session_inputs` 在派发后 `consume`，`composer.acknowledge` 清空 plugins/skills。修复属于问题 3（会话关联），不单独打补丁。

## 问题 3（待实施）

计划已写入 `plugin-session-plan.md`：把“下一条消息输入”升级为“会话关联”，不再在派发后消费；右侧关联栏分组展示插件/技能/连接器，可移除、可扩展（子 Agent）；移动端抽屉。

## 验证

- `npm run build` 通过。
- `npm test` 505 项：504 通过 / 1 既有跳过 / 0 失败（`tests.log`）。
- 相关专用套件：`plugin-configuration` 15 项、`composer-selection` 3 项全通过。

## 下一步

1. 问题 3 的服务端语义（不消费 `session_inputs`）与右侧栏 UI。
2. 移动端与截图验收。
3. 你这边重新保存一次牧云 Token（仅这一步需要人工）。

## 补充验证与新增诉求（11-13 下午）

**`@` 规则的最终结论（按用户 11-13 下午补充要求）**：

- 用户要求“不要在正文中间 @ 插件，会干扰输入”。因此**回退**了“中文相邻可触发”的改动：只在行首或空白之后识别 `@`/`$`，正文中间一律作为普通字符。
- 同时修了一个真实竞态：受控 textarea 的 value 先更新、caret 状态后更新，导致刚敲下 `@` 时 `mentionAt` 用的是旧光标位置，面板要等到下一次按键才出现。新增 `useLayoutEffect` 在 value 变化后同步光标。
- 隔离 fixture 实测（新构建）：行首 `@` 在 120ms 内打开面板；`帮我@` 不打开；`帮我看 @` 打开并可过滤；截图 `at-start.png`、`at-midtext.png`。
- 专用测试：`tests/composer-selection.test.ts` 3 项通过（行首 `@` 返回 token；中文相邻与邮箱式写法均返回 null）。

**新增诉求（未实施，记入计划）**：

1. 模型与推理强度选择器“一比一照搬”参考图（`image-2.png`），并把切换模型放到第二阶段/二级面板（`image-1.png`），因为切换模型不频繁。
2. 右侧会话关联栏（问题 3）仍待实施。

## 问题 3（已完成：会话关联 + 右侧栏）

**服务端语义**：派发后不再清空扩展。`server/session-inputs.ts` 新增 `remember(threadId, skills, plugins)`，在 `onDispatch` 用实际派发的引用写入关联并递增 revision；只有「无插件无技能」时才不写，避免每轮无谓改版本。`session_inputs` 从“下一条消息的输入”升级为“本会话的关联”。

**前端**：

- 会话恢复时继续从 `thread.nextInput` 水合，因此插件/技能在下一轮和切换会话后都保留。
- 顶栏新增“会话关联”按钮（带数量角标），打开右侧面板：插件 / 技能分组，逐项可移除；移除走 `session/inputs`，立即影响下一轮。
- 移动端为整屏面板（含遮罩），桌面为 320px 右侧栏；连接器（MCP）由插件提供，面板中注明管理入口。

**实测（隔离 fixture，新构建）**：

- 通过 `@` 选择“测试插件”并发送 → 服务端 `nextInput.plugins = 1`、revision 1（此前会被清空为 0）；输入框仍显示插件 chip；角标为 1。
- 打开右侧栏：分组“插件 1 / 技能 0”，条目“测试插件”。
- 点击移除 → 服务端 `plugins = 0`，面板显示“暂无”，无控制台错误。
- 截图：`associations-dark.png`（桌面）、`associations-mobile.png`（390px）。

**测试**：`tests/skill-use.test.ts` 改为断言“派发后仍保留关联”（revision 2 + 同一技能），8 项通过。全量 `npm test` 505 项（504 通过 / 1 既有跳过 / 0 失败），`npm run build` 通过。

**限制**：关联仍存在 `session_inputs`（服务端持久化，重启保留）；插件被升级/删除时由既有 `unifyPluginInputs` 与 `references()` 规则收敛，面板会显示实际可用项。

## 模型与推理强度选择器（已完成）

按参考图重做（`image-1.png` / `image-2.png`）：

- **收起态**：一个触发器显示「模型名 + 当前推理强度 + ⌄」，取代原来“模型下拉 + 大脑图标”两个入口。
- **展开态（第一阶段）**：只显示推理强度——左上角是**返回箭头**（沿用“返回=退出”的心智，点击关闭弹框），居中蓝色强度标签，右侧恢复默认按钮；下一行「模型名 ›」进入第二阶段；下方是带刻度点的滑杆（拖动或方向键调整，松手保存）。
- **第二阶段（模型列表）**：**不再同时显示强度调节**，只显示搜索与模型目录；左上角同一个返回箭头回到强度界面。点击弹框外部同样直接关闭。
- 面板高度改为内容自适应（之前固定 520px，收起模型列表时会出现一大片空白）。

实测（隔离 fixture）：面板 380×150；拖动/方向键后强度从“默认”变为“高”并保存；模型列表在第二阶段展开（2 个选项），返回键回到强度视图；控制台 0 错误。截图 `runtime-effort.png`、`runtime-models.png`。

`npm test` 505 项（504 通过 / 1 既有跳过 / 0 失败），`npm run build` 通过；服务已重启（PID 638315）。

## P1：会话关联改为常驻右侧工作区（已完成）

参考 `003.md` 的 Codex 桌面端形态：右栏是布局的一部分，顶部是一条面板标签条。

- 新增 `web/components/AssociationsRail.tsx`：标签条（关联面板 + 预留 `+`）、收起按钮、面板正文（插件/技能分组，逐项移除）。
- 布局：`.workspace` 变为 `侧栏 260 + 主区 + 右栏 300`；主区 `min-width: 0` 自适应。实测 1440px 下右栏 300、主区 880。
- 交互：顶栏按钮或 `Ctrl+Shift+A` 开关；状态写入 `localStorage`；桌面无遮罩（边看边操作）。
- 窄屏：≤1080px 自动改为右侧浮层（带遮罩），≤760px 全宽。
- 顺带修了角标定位：`.topbar .icon-button` 之前不是定位元素，数量角标会飘到主区右上角。

实测（隔离 fixture）：右栏 300px、标签条 2 个、分组“插件 1 / 技能 0”、快捷键可关可开、移动端 390px 全宽、控制台 0 错误。截图 `rail-desktop.png`、`rail-mobile.png`。

**未做（P2/P3）**：文件 / 产物标签、拖拽调整宽度、记住选中标签。

## P2：右栏加入“文件 / 产物”标签（已完成）

- `AssociationsRail` 扩展为 `WorkbenchRail`（`web/components/WorkbenchRail.tsx`），标签条现在有三个真实面板：
  - **会话关联**：插件/技能，逐项移除；
  - **工作区文件**：说明 + “选择工作区文件”，复用现有工作区选择器（模态）；
  - **产物**：把当前会话各轮产物按路径去重（取最新版本），显示文件名、类型、大小；点击用现有 `ArtifactPreview` 打开预览。
- 标签仍是 `role="tab"` + `aria-selected`；`+` 入口保留占位；收起按钮不变。
- App 侧新增 `railArtifact` 状态，从右栏打开产物预览（懒加载 `ArtifactPreview`）。

实测（隔离 fixture）：标签条 4 项（关联 / 文件 / 产物 / 禁用的 +），切换正常；文件页按钮能打开工作区选择器；产物页在无产物时显示“暂无产物”，控制台 0 错误。截图 `rail-artifacts.png`、`rail-files.png`。

**未做（P3）**：拖拽宽度、记住选中标签（目前切会话或刷新回到“关联”）、产物分页/版本历史入口。

## P3：可调宽度、记住标签（已完成）

- 右栏左边缘新增拖拽手柄（`role="separator"`），宽度限制 260–520px，松手写入 `localStorage`（`newbot:rail-width`）；≤1080px 的浮层模式自动隐藏手柄，不受内联宽度影响。
- 选中的标签写入 `localStorage`（`newbot:rail-tab`），刷新或重开页面后保持；开合状态继续用 `newbot:rail`。
- 实测：拖动 300 → 400px；刷新后右栏仍打开、标签仍是“产物”、宽度仍为 400；控制台 0 错误。截图 `rail-resized.png`。

**未做**：移动端手势关闭（仍用收起按钮/遮罩）、产物版本历史入口（预览内已有版本切换）。
