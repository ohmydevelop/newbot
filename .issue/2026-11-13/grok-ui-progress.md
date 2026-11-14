# UI-20261113 进度与证据

- 用户确认：日常聊天优先；高度接近 Grok；保留现有能力。
- 已阅读：AGENTS.md、README、App、Sidebar、Settings、WorkbenchRail、共享 Modal、主题/布局样式、隔离夹具与构建脚本。
- Craft Anything：已初始化 brief 和 plan；web_site_open 被 consent_required 阻止，已向用户请求具体采集授权，未绕过。
- 工作树基线：仅有与本任务无关的未跟踪 browser-access/craft-anything-mcp 记录，保持原样。
- 当前运行入口：未发现 3100 或 5173 监听；存在其他开发服务，未操作。计划以独立夹具与候选构建验证，不宣称生产已更新。
- UI/UX 数据库返回 AI-Native UI，但紫色/青色建议与已确认 Grok 方向冲突，弃用自动配色，使用参考实测值与可访问性约束。
- 初始待办：Grok 采集授权、原始/最终浏览器证据、实施与验收（后续结果见下文）。

## 参考只读观察与基线

在 Craft 的独立网页执行授权待回复期间，仅对先前已打开的 Grok 页面读取可见 DOM 样式与截图，未代为打开菜单或执行新页面。证据：grok-visible-tokens.json、grok-desktop-geometry.json、grok-surfaces.json、grok-desktop-main.jpg。桌面截图裁去账号与历史区域。

实测：深色画布 rgb(19,18,17)，正文 rgb(252,252,252)，辅助文字 rgb(158,158,158)；输入框 rgb(32,31,29)，宽上限 752px、圆角 24px、边框为正文色 6% alpha；按钮 40px、100ms 色彩过渡；标题 24px/550，图标约 16–22px、部分 stroke 1.75。Grok 使用 universalSans 回退 Inter 等；不复制其字体文件。1440×900 下输入框顶部约271，标题约206。679px 下依然标题+输入框成组；先前320px截图输入靠下，需单独响应适配。菜单与设置动画尚未观察，不冒称精确复刻。

newbot 基线已通过隔离夹具 127.0.0.1:3146 加载 .data/grok-ui-before；before-desktop.png。该入口与真实用户数据隔离，模拟 Codex。

## 第一轮实施与浏览器验证

- 共同机制：提取 web/tokens.css 管理浅深色语义；web/shell.css 管理统一应用布局；ConversationNavigation 分离导航呈现；ChatStarters 负责可编辑话题建议。已有业务状态/API 保留。
- 首屏：桌面标题与 752px 输入区成组，手机输入靠底；共享菜单、设置、目录、消息排版、登录与工作区统一。
- 已验证（真实浏览器+模拟 Codex）：建议不产生 thread，焦点回到输入；发送后 1 turn/1 user-message；测试回复完成；既有会话草稿在新建/返回后恢复；浅色/深色切换；网关与长名称、插件目录、附件→技能、模型面板；手机侧栏→设置→关闭焦点返回；工作区 Escape 关闭恢复按钮焦点。
- 已修正：手机长会话标题挤压右侧按钮（第一轮截图 chat-mobile.png 可见），改为 flex 分配+ellipsis；工作区窄屏使用 Radix Dialog 管理焦点/遮罩/Escape，并修正 fixed 被 relative 覆盖的共同 CSS 原因；桌面 resize 增加键盘支持，tablist 增加方向键与 ARIA 关联。
- 自动验证：tsc 通过；npm test 共512，511通过、1跳过、0失败（unit-tests.log）。候选 Vite 构建通过（build.log），保留既有大 chunk / 第三方注释警告。
- 检测器：唯一提示是原有 Markdown blockquote 的 3px 中性边线，属于引用语义而非装饰卡片；交由审查确认，不借本次任务改 Markdown 表达。
- 测试夹具曾退出，页面呈现“重新连接中”与相关禁用状态；重启隔离夹具后重新登录并完成行为验证。未归因于产品代码。
- 用户已批准 Craft 网页执行/菜单采集，重试仍返回 consent_required。读取 settings 显示 ask_before_running=true；未改变全局保护。独立采集仍受工具内部授权限制，菜单/设置的精确 Grok 动效没有作为已验证结论。

## 二轮边界复核

320px首页 pageWidth=320、900px首页 pageWidth=900；390px长标题修正后工作区按钮 right=378<390。工作区方向键切换到“工作区文件”，分隔线左键把宽度从300调到320，均由实际DOM记录。

新增已复现边界：工作区打开文件选择器后关闭，原 App 强制将焦点返回 textarea，落到仍开放的抽屉后面。同机制覆盖文件选择与产物预览，已统一改为记录工作区发起控件并优先返回它；来自 composer 的文件入口仍回输入。需对新构建验证此修正，不将第一次失败记录当通过。

## 最终验证与截图修正

- 新构建已复核文件选择器关闭：焦点为“选择工作区文件”、insideWorkbench=true、仅余工作区一个 dialog。原失败和修正后结果均保留在 browser-checks.json，分别为 file-modal-return 和 file-modal-return-fixed。产物预览复用相同恢复函数，有代码证据；夹具没有实际产物，本轮未做真实产物打开验证。
- 停止入口验证到按钮显示“已请求停止…”并禁用，随后夹具按计划完成回复、恢复输入。该证据只证明停止请求反馈与恢复，不证明真实上游取消。
- 独立审查发现 IAB 原截图受宿主侧面板裁切，返回图片尺寸小于 DOM 视口。已改为同一页面 CDP Page.captureScreenshot，以实际 viewport clip 输出完整 PNG；未修改页面内容。desktop-dark/light、settings-dark/light、providers-light、workbench-desktop、chat-desktop 为1440×900，tablet-900/workbench-tablet为900×900；手机390×844及320×720证据完整。审查所用同名文件已替换，并以 magick identify 核实。
- 证据目录：evidence-grok-ui；真实浏览器读取/交互结果见 browser-checks.json，源码检查见 typecheck.log，构建见 build.log，自动测试见 unit-tests.log。
- 验证边界：本轮上游为隔离测试夹具；未操作真实账号配置、未验证真实模型服务兼容性、未发布生产。Grok 内部菜单/设置精确动效仍受 Craft 工具授权状态限制。
- 搜索入口补充验证：输入“新想法”过滤并选择结果，返回会话、搜索 dialog 关闭；见 browser-checks.json 的 search-navigation。
- 独立完整审查结论：ship。审阅16张交付截图、参考与相关源码/测试日志，无材料级修正要求；详见 grok-ui-review.md。其范围不含真实上游兼容性和未观察的 Grok 内部交互。
- 基线3146测试进程已关闭；候选3147保留供用户预览，浏览器临时尺寸已恢复。原有生产服务未改动。
- 独立文档代理已写入 DESIGN.md 与 .impeccable/design.json，验证文档格式、源码颜色、token引用及组件片段一致；未修改产品代码。最终 git diff --check 通过。
- 本轮完成：调查与计划 → 统一主题/布局及组件重构 → 关联定位/焦点修复 → 浏览器/自动验证 → 独立审查ship → 设计文档。未完成的外部参考采集与未验证范围如上，不记作已验证。
