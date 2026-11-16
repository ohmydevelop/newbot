# 自动任务

Primary target: web/components/Automations.tsx
Related targets: web/automations.css, web/components/AutomationEditor.tsx, web/components/ConversationNavigation.tsx
Mode: Operate

## Direction contract
THESIS: 把重复聊天工作保存为可检查的计划；每次执行是可继续的会话，不是独立日志仪表盘。
OWN-WORLD: 继承 DESIGN.md 温黑/中性浅色、Noto 字体、共享圆角、参考图标槽及菜单动效。不开新视觉体系。
STORY: 新建聊天下进入任务，选择现有任务或创建，先设何时再写做什么，保存后立即试运行；通过概览/运行记录检查并打开结果。
FIRST VIEWPORT: 原导航保持原宽度和折叠位置；自动任务主区域居中最多848px（含内边距），紧凑标题/搜索/加号，已存任务和分类模板同时可用，桌面双列手机单列轻量行。编辑在同一区域逐级进入；图标名称→触发器→说明/扩展→通知，固定标题和操作、正文单滚动。复用共享Picker/ActionMenu，取消恢复列表位置与焦点。
FORM: seed: none (pinned)。用户指定“尽可能1:1还原它的设计理念”和“侧边栏的新建聊天下面添加自动任务”。2026-11-17补充普通Chrome登录态目录与未保存草稿（桌面1280、手机390）证据，路径006-automations-live-alignment-plan.md。保留用户指定的侧栏入口及Newbot工作区外壳；正文对齐实测紧凑目录/分组/编辑顺序，不复制收费广告或更换整个设置系统。未观察Grok已保存运行历史，不声称全功能或所有像素一致。
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Finish outcome
Verdict: ship for the live-reference alignment round. Independent review found one material issue (768px catalog density with retained sidebar); intrinsic column sizing fixed it and all six catalog captures were reviewed again. Evidence: .issue/2026-11-16/006-automations-live-design-review.md and .impeccable/review/automations-live/. DESIGN.md and PRODUCT.md retained; no shipping raster assets added. This covers observed catalog/editor design and the requested Newbot adaptations, not an exact certification of unobserved Grok saved-task history or external event integrations.
