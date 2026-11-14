# 聊天工作区

Mode: Operate. 范围：web/App.tsx、共享主题、菜单、设置、工作区及登录。

## Direction contract

THESIS: 日常聊天优先，工具与设置按需展开；以用户指定的 Grok 当前页面为具体参照。

OWN-WORLD: 温黑 #131211 画布，#201f1d 输入容器，接近白色的正文与中灰辅助文字；细线图标、低对比边界、圆角输入框、紧凑圆形动作。浅色使用同一语义层级。

STORY: 进入后先看到问题与输入框；编辑后发送；会话内容占据主体；附件、模型、扩展与工作区在需要时打开。

FIRST VIEWPORT: 桌面左侧约 256px 导航，顶部轻量状态栏；空白对话标题在内容区上三分之一，752px 输入框紧随。手机压缩导航为抽屉，320px 窄屏保持输入与发送可达。有消息时输入框落到底部。

FORM: seed: none (pinned)。用户确认“以日常聊天为主，工具和设置按需展开”“高度接近 Grok 的布局、配色与交互，保留 newbot 的现有能力”。采用代码优先的 app screen 路径，不生成装饰图片。

SIGNATURE INTERACTION: 导航与工作区的短距离滑入保持空间方向；菜单轻量出现；首页建议先成为可编辑草稿，发送行为由用户掌控。支持减少动态效果。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
