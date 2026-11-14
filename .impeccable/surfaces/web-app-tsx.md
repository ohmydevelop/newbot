---
version: 1
slug: "web-app-tsx"
primary_target: "web/App.tsx"
related_targets: ["web/styles.css","web/components/WorkbenchRail.tsx","web/components/Settings.tsx"]
---

# 聊天工作区

Mode: Operate. 范围：web/App.tsx、共享主题、菜单、设置、工作区及登录。

## Direction contract

THESIS: 日常聊天优先，工具与设置按需展开；以用户指定的 Grok 当前页面为具体参照。

OWN-WORLD: 温黑 #131211 画布，#201f1d 输入容器，接近白色的正文与中灰辅助文字；2px描边图标、低对比边界、圆角输入框、紧凑圆形动作。浅色使用同一语义层级。

STORY: 进入后先看到问题与输入框；编辑后发送；会话内容占据主体；附件、模型、扩展与工作区在需要时打开。

FIRST VIEWPORT: 桌面左侧256px导航/57px折叠栏，顶部轻量状态栏；空白对话标题在内容区上三分之一，752px 输入框紧随。手机压缩导航为抽屉，320px 窄屏保持输入与发送可达。有消息时输入框落到底部。

FORM: seed: none (pinned)。用户确认“以日常聊天为主，工具和设置按需展开”“高度接近 Grok 的布局、配色与交互，保留 newbot 的现有能力”。采用代码优先的 app screen 路径，不生成装饰图片。

SIGNATURE INTERACTION: 桌面导航300ms连续收放并记忆偏好；手机抽屉与工作区保持方向和焦点；最近对话分组支持折叠；首页只保留标题与输入。2026-11-13用户进一步要求删除三个建议按钮和底部提示，并加厚字体；正文采用500字重。支持减少动态效果。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
