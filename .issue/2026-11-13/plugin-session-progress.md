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

## 003.md 第二批反馈（已完成部分）

| 反馈 | 处理 |
| --- | --- |
| 右侧“新建”要像参考图 | 右栏 `+` 改为菜单（Radix dropdown），列出会话关联 / 工作区文件 / 产物，选择即切换标签 |
| 侧栏切换按钮位置要固定 | 左栏开关固定到顶栏左侧（`aria-expanded` 随开合变化），移除侧栏内部的重叠按钮 |
| 右栏开关同一位置 | 顶栏右侧保留唯一开关（`aria-pressed`），宽屏隐藏右栏内的收起箭头，仅窄屏浮层保留 |
| 私密图标布局 | 顶栏右侧顺序改为：Codex 状态 → 私密授权 → 会话关联（右栏开关） |
| “文件存储”改名 | 设置标签改为“存储”，小节标题保留“文件存储” |
| “新聊天”改名 | 侧栏入口改为“新建聊天”，设置里的快捷键说明同步 |
| 去掉左侧“扩展”入口 | 侧栏主导航只保留“新建聊天” |
| 设置“扩展”改“插件” + @ 图标 | 标签改为“插件”，图标换成 `AtSign` |
| 上传限制太小、要可调 | 新增文本附件上限设置：默认 200 KB，可在“存储”里调整为 32–2000 KB；服务端校验、`/api/storage` 返回、`upload/text-limit` 审计 |
| 上传 .docx 报错 | **未解决**：附件仍只支持 PNG/JPEG/WebP 与纯文本/代码；.docx 是二进制文档，需要转换器，未在本轮实现 |

实测（隔离 fixture）：侧栏只剩“新建聊天”；顶栏顺序 status → 私密 → 关联；右栏 `+` 菜单三项；存储页把上限改为 500 KB 后 `/api/storage` 返回 500000；控制台 0 错误。截图 `ui-batch-rail.png`、`ui-batch-storage.png`。

## 附件支持任意文件 + 全局上传上限（已完成）

**任意文件**（`server/files.ts`）：

- 不再按扩展名拒绝；识别 PNG/JPEG/WebP/PDF/ZIP(docx/xlsx/pptx) 魔数，其余按内容判断。
- 无 NUL、UTF-8 可解码且不超过文本上限 → `text/plain`，仍内联进模型输入。
- 其他一律 `application/octet-stream` 二进制：发送时复制到该会话工作区 `attachments/<文件名>`，输入中写入相对路径与说明，由 Agent 用文件/命令行工具读取或转换。
- 同名自动加 `2-`、`3-` 前缀；文件名过滤控制字符与路径分隔符。
- 安全：二进制（含 SVG/HTML）不会以 `image/*` 或可执行 MIME 内联；`/api/files/:id` 始终 `Content-Disposition: attachment`，测试已改为断言这一点。

**全局上限**（存储设置）：

- 单文件：默认 8 MB，可调 1–64 MB（`upload:max-bytes`，`/api/storage` 返回 `maxUploadBytes`，`POST /api/storage/max-upload` 写审计）。
- 文本内联：默认 200 KB，可调 32–2000 KB（保留）。
- 单条消息附件总量上限 64 MiB。

**实测**：上传伪造 `.docx`（PK 魔数）→ 200，mime `application/zip`；发送后注入了“附件已保存到工作区：attachments/内存.docx…”，文件确实落在 `workspaces/<thread>/attachments/`；把上限调到 1 MB 后上传 2 MB → 400「附件为空或超过 1 MiB」。

`npm test` 505 项（504 通过 / 1 跳过 / 0 失败），`npm run build` 通过，服务已重启。

## DOCX 内联解析（已完成）

- 新增 `server/attachment-text.ts`：直接读 `.docx` 的 `word/document.xml`（自有最小 ZIP 解析，支持 stored/deflate），保留段落换行与制表符，解码 XML 实体，输出上限 4 MiB。
- `files.inputs()`：`.docx` 且解析成功、文本不超过文本上限时，**正文直接内联进模型输入**，同时仍把原文件复制到会话工作区（两边都有）；解析失败或超限时退回二进制说明，不阻塞。
- 其它 Office/PDF 暂不解析（xlsx/pptx/pdf 走工作区 + 工具），保持“能解析就解析、不能解析就是二进制”的原则。
- 新增 `tests/attachment-text.test.ts` 3 项：压缩/未压缩两种 ZIP、非 docx/损坏数据返回 undefined、实体与空白规范化。

实测：伪造 `.docx` 上传 → 200；发送后输入包含“附件：notes.docx（原文件已保存到工作区 attachments/notes.docx）”+ 提取出的两段正文；工作区确实存在 `attachments/notes.docx`。

`npm test` 508 项（507 通过 / 1 跳过 / 0 失败），`npm run build` 通过，服务已重启。

## 004.md 反馈 + PDF 解析（已完成）

**右栏开关统一为“门”图标、位置固定**：

- 顶栏里原来的 Layers 开关和右栏内的收起箭头都移除，只保留一个 `position: fixed` 的门形开关（打开时 `DoorClosed`、关闭时 `DoorOpen`），固定在页面右上角，开/关都在同一坐标；实测 (1392, 15) 三次切换不变。
- 右栏标签条高度改成与顶栏一致的 65px，图标垂直居中对齐（盾牌中心 y=33、标签条图标中心 y=33）。

**PDF 文本抽取**：

- `server/attachment-text.ts` 新增 `pdfText()`：动态加载已安装的 `pdfjs-dist` legacy 构建，读前 20 页、限制字符数，失败返回 undefined。
- `files.inputs()` 改为异步；PDF/docx 能抽取且未超文本上限时内联正文，同时仍把原文件复制进工作区；其他情况保持二进制说明。
- 实测：上传含 “Quarterly revenue grew 12 percent” 的 PDF → 200；发送后输入为“附件：report.pdf（原文件已保存到工作区 attachments/report.pdf）+ 抽取正文”。
- 测试新增 PDF 用例（构造最小 PDF），`tests/attachment-text.test.ts` 共 4 项通过。

`npm test` 509 项（508 通过 / 1 跳过 / 0 失败），`npm run build` 通过，服务已重启。

## 标题与上限合并（已完成）

- 顶栏标题改为**当前会话名称**（取侧栏摘要里的 DB 标题，创建后立即显示；无会话时显示“新对话”），带 `title` 悬浮提示。
- 左侧产品名文字“newbot”移除，只保留气泡标识（按钮仍可点击回首页，无障碍名保留）。
- 上传上限合并为一个：**单文件上传上限**（默认 8 MB，1–64 MB）；原“文本附件上限”设置、接口 `/api/storage/text-limit`、`textLimitBytes` 字段全部移除；文本内联与 docx/pdf 抽取改用同一个上限。

实测：新建会话并发送后顶栏显示会话名；侧栏无“newbot”文字；存储页只有一个上限输入。截图 `titles-dark.png`、`storage-single-limit.png`。

`npm test` 509 项（508 通过 / 1 跳过 / 0 失败），`npm run build` 通过，服务已重启。

## 存储配额改为用户配置（已完成）

- 移除硬编码的 512 MiB 总配额：`storageLimit(db)` 读取 `storage:limit-bytes`，**未设置即不限制**；`files.save` 与 artifacts 写入/采纳只在配置了配额时拒绝。
- 新增 `POST /api/storage/quota`（`bytes: number | null`，0/null = 不限，上限 1 TiB），写审计 `storage/quota`；`/api/storage` 的 `limitBytes=0` 表示不限。
- 存储设置新增「存储配额（GB）」：留空 = 不限制；有配额时才显示进度条与“配额已满”提示。`formatFileSize` 增加 GB 单位。
- 测试改为用小型配额模拟写满（不再依赖 512 MiB 常量），错误文案断言改为 /上限/。

实测：留空时显示“未设置上限”且无进度条；填 2 GB → `/api/storage` 返回 `2147483648`、显示“2.0 GB”；清空 → 回到不限。

`npm test` 509 项（508 通过 / 1 跳过 / 0 失败），`npm run build` 通过，服务已重启。

## 参考图（image-16）配色与尺寸对齐（已完成）

**取样方法**：对 3042×1588 截图做直方图与定点采样（像素坐标按 2x 折算）。

| 角色 | 参考值 | 本仓库改为 |
| --- | --- | --- |
| 主画布 | `#131211` | `--bg` 同值 |
| 侧栏 | `#181716` | `--sidebar` 同值 |
| 抬升面（气泡/输入框） | `#201F1D` | `--surface` / `--menu-bg` 同值 |
| 选中/悬浮 | `#2A2928` | `--hover` 同值 |
| 主文字 | `#FCFCFC` | `--text` 同值 |
| 次要文字 | `#9E9E9E` | `--muted` 同值 |
| 强调蓝（语音球） | `#299FFF` | `--accent` 同值 |
| 描边 | 近 `#2D2C2A` | `--line` 取同族 |

浅色模式改成同一暖灰族，避免两套色调割裂：画布 `#faf9f7`、侧栏 `#f3f1ee`、抬升面 `#efedea`、描边 `#e3e0db`、强调 `#0b7ce0`。

**尺寸/图标对齐**：

- 侧栏宽度 260 → **288px**（参考 299）；主导航行高 42 → **34px**、圆角 10、图标 19 → 18
- 会话行最小高度 38 → 34、圆角 10；输入框圆角 26 → 24
- 品牌标识 29 → 26；搜索/新建/收起图标统一 18
- 字距/行高保持上一轮按用户要求调好的正文数值（16px / 2.0 / 0.07em），不因参考图回退

实测（1521×794 视口，与参考同尺寸）：画布 `rgb(19,18,17)`、侧栏 `rgb(24,23,22)`、输入框 `rgb(32,31,29)`、侧栏 288px、导航行 34px、正文 `#fcfcfc`、强调 `#299fff`。截图 `align-dark.png`、`align-light.png`。

**未对齐（属于功能差异，不擅自加）**：语音球/麦克风、消息下方的点赞/重生成图标组、Grok Bot 构建器、项目分组、右上角链接与更多菜单。

## 追问推荐、文字亮度、侧栏开关位置（已完成）

- **推荐追问**：每条已完成的最后一条回复下方渲染 2–3 条带折角箭头的建议（有代码时给“解释这段代码/可运行示例/潜在问题”，有列表时给“总结成三条/展开第一点/给例子”，否则给“继续展开/具体例子/其他方案”）。点击**直接发送**，不是填入草稿。
- **欢迎页建议**同样改为点击即发送（之前只填草稿）。
- 发送函数支持显式文本：`send(e?, text)`，从 composer store 同步读取，避免状态竞态。
- **文字亮度**：深色主文字 `#FCFCFC` → `#E3E1DD`（暖灰白），对比从约 18:1 降到约 13:1，减少刺眼；次要文字保持 `#9E9E9E`。
- **侧栏开关归位**：放回侧栏顶部（品牌 + 搜索 + 收起），顶栏只在侧栏关闭时显示“展开”；聊天栏标题不再被开关占位。

实测：欢迎建议点击后立即产生 turn；回复完成后出现三条建议，点击“继续展开”产生新 turn 且最后一条用户消息就是该文本；侧栏内有收起按钮、顶栏无开关；正文为 `rgb(227,225,221)`。截图 `followups-dark.png`。

`npm test` 509 项（508 通过 / 1 跳过 / 0 失败），`npm run build` 通过，服务已重启。
