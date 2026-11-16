# 自动任务

Primary target: web/components/Automations.tsx
Related targets: web/automations.css, web/components/AutomationEditor.tsx, web/components/ConversationNavigation.tsx
Mode: Operate

## Direction contract
THESIS: 把重复聊天工作保存为可检查的计划；每次执行是可继续的会话，不是独立日志仪表盘。
OWN-WORLD: 继承 DESIGN.md 温黑/中性浅色、Noto 字体、共享圆角、参考图标槽及菜单动效。不开新视觉体系。
STORY: 新建聊天下进入任务，选择现有任务或创建，先设何时再写做什么，保存后立即试运行；通过概览/运行记录检查并打开结果。
FIRST VIEWPORT: 原导航保持原宽度和折叠位置；主区域居中最多800px，标题“自动任务”与新建在同一行，下方轻量任务行，空态提供三项可编辑模板。编辑器在共享保护焦点的Modal中，触发器→说明/扩展→通知，操作固定底部、正文单一滚动区。
FORM: seed: none (pinned)。用户指定“尽可能1:1还原它的设计理念”和“侧边栏的新建聊天下面添加自动任务”。依据官方Automations页面演示层级，登录产品现场尚因工具许可无法采集，不能称已实测1:1像素。桌面/手机交互复用原实现。
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
