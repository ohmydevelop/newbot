---
name: newbot
description: 聊天优先的温黑与中性浅色界面；扩展能力按需展开。
colors:
  light-bg: '#ffffff'
  light-sidebar: '#f8f8f7'
  light-surface: '#f3f3f2'
  light-hover: '#eaeae8'
  light-text: '#171717'
  light-muted: '#646464'
  light-line: '#e5e5e3'
  light-strong: '#1b1a18'
  light-on-strong: '#fff'
  light-focus: '#545454'
  light-danger: '#b42318'
  light-danger-fill: '#b42318'
  light-permission-risk: '#b54708'
  light-on-danger: '#ffffff'
  light-menu-bg: '#ffffff'
  light-control-hover: '#2b2a27'
  light-code: '#f4f2ef'
  light-success: '#25694d'
  light-accent: '#0b7ce0'
  light-accent-soft: '#e8f3fe'
  light-entity: '#a86412'
  light-on-accent: '#ffffff'
  dark-bg: '#131211'
  dark-sidebar: '#131211'
  dark-surface: '#201f1d'
  dark-hover: '#2a2928'
  dark-text: '#fcfcfc'
  dark-muted: '#9e9e9e'
  dark-line: '#2d2c2a'
  dark-strong: '#fcfcfc'
  dark-on-strong: '#131211'
  dark-focus: '#c4c4c4'
  dark-danger: '#ff9a90'
  dark-danger-fill: '#f08e85'
  dark-permission-risk: '#ff975a'
  dark-on-danger: '#30120f'
  dark-menu-bg: '#201f1d'
  dark-control-hover: '#ffffff'
  dark-code: '#1b1a18'
  dark-success: '#8fd3b3'
  dark-accent: '#299fff'
  dark-accent-soft: '#14293b'
  dark-entity: '#f5a742'
  dark-on-accent: '#0d1b2a'
typography:
  headline:
    fontFamily: '"Noto Sans", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "Segoe UI", "Hiragino Sans GB", "Source Han Sans SC", system-ui, sans-serif'
    fontSize: 28px
    fontWeight: 550
    lineHeight: 1.4
    letterSpacing: -0.02em
  title:
    fontFamily: '"Noto Sans", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "Segoe UI", "Hiragino Sans GB", "Source Han Sans SC", system-ui, sans-serif'
    fontSize: 16px
    fontWeight: 500
  body:
    fontFamily: '"Noto Sans", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "Segoe UI", "Hiragino Sans GB", "Source Han Sans SC", system-ui, sans-serif'
    fontWeight: 500
    fontSize: 15.5px
    lineHeight: 1.85
  label:
    fontFamily: '"Noto Sans", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "Segoe UI", "Hiragino Sans GB", "Source Han Sans SC", system-ui, sans-serif'
    fontWeight: 500
    fontSize: 14px
    lineHeight: 1.5
  composer:
    fontFamily: '"Noto Sans", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", "Segoe UI", "Hiragino Sans GB", "Source Han Sans SC", system-ui, sans-serif'
    fontWeight: 500
    fontSize: 16px
    lineHeight: 1.75
  code:
    fontFamily: ui-monospace, SFMono-Regular, Consolas, monospace
rounded:
  control: 12px
  panel: 20px
  composer: 24px
  menu: 16px
  row: 10px
  field: 9px
  pill: 999px
  circle: 50%
spacing:
  tight: 4px
  compact: 8px
  control: 12px
  section: 24px
  roomy: 32px
components:
  button-primary-light:
    backgroundColor: '{colors.light-strong}'
    textColor: '{colors.light-on-strong}'
    rounded: '{rounded.control}'
    padding: 9px 18px
  button-primary-light-hover:
    backgroundColor: '{colors.light-control-hover}'
  button-primary-dark:
    backgroundColor: '{colors.dark-strong}'
    textColor: '{colors.dark-on-strong}'
    rounded: '{rounded.control}'
    padding: 9px 18px
  button-primary-dark-hover:
    backgroundColor: '{colors.dark-control-hover}'
  button-icon:
    rounded: '{rounded.circle}'
    width: 36px
    height: 36px
  input-field:
    rounded: '{rounded.field}'
    padding: 10px 12px
  navigation-row:
    rounded: '{rounded.control}'
    padding: 6px
    minHeight: 36px
  catalog-row:
    rounded: '{rounded.control}'
  composer:
    rounded: '{rounded.composer}'
    padding: 14px 12px 10px
  button-destructive-light:
    backgroundColor: '{colors.light-danger-fill}'
    textColor: '{colors.light-on-danger}'
    rounded: '{rounded.control}'
    padding: 9px 18px
  button-destructive-dark:
    backgroundColor: '{colors.dark-danger-fill}'
    textColor: '{colors.dark-on-danger}'
    rounded: '{rounded.control}'
    padding: 9px 18px
---

# Design System: newbot

## Overview

**Creative North Star: "温黑聊天空间"**

以温黑画布、接近白色的正文、克制边线和圆角输入容器建立安静的聊天空间。中性无衬线承担中文阅读与控件信息，工具密度集中于需要操作的区域。浅色沿用相同语义角色，由白与灰区分层级。

保留 newbot 名称与既有能力。视觉参考包括 Grok 首页、插件中心、技能详情和设置外观的实际观察；精确菜单动效和付费流程未确认。保留 newbot 的模型服务、存储、安全及专家能力，不虚构 Grok 账号功能。

**Key Characteristics:**

- 温黑与中性浅色共享语义 token。
- 内容区克制，输入容器与圆形操作形成识别。
- 导航、设置和工作区按需展开，状态与授权保持可见。
- 短距离定向进入，并尊重减少动态效果设置。

本文件记录 2026-11-13 已实施界面。源码权威顺序：`web/main.tsx` 先加载 `web/styles.css`（导入 `web/pickers.css`、`web/tokens.css`），再加载 `web/shell.css`；共享 token 来自 `web/tokens.css`，最终布局与多数尺寸来自 `web/shell.css`。frontmatter 的 `light-*` / `dark-*` 分别对应 `:root` / `:root[data-theme="dark"]` 中同名 CSS 变量（去掉主题前缀并加 `--`）。spacing 是重复使用的源码数值摘要，非现有 CSS 自定义变量。

方向见 `.impeccable/surfaces/web-app-tsx.md`；参考边界与审查见 `.issue/2026-11-13/grok-ui-analysis.md`、`grok-ui-review.md`。本轮文档核对源码及已有审查，不将静态截图当成动画、软键盘或真实模型服务兼容证明。既有浏览器证据使用模拟 Codex 上游。

## Colors

中性色承担主要层级；彩色保留给状态、可操作强调与实体识别。

### Primary

反相主操作使用 `strong` / `on-strong`，用于发送和主要确认；`control-hover` 对应悬停。交互蓝 `accent` / `accent-soft` / `on-accent` 用于推理控件、选择状态和部分输入焦点，不能据首页中性色推断全系统禁止彩色。

### Neutral

温黑或白色 `bg` 是主画布；`sidebar` 是导航底色；`surface` 是输入和轻量容器；`menu-bg` 是浮层；`hover` 是悬停/选择层。`text`、`muted` 与 `line` 分别承载正文、辅助文字与边界，`code` 区分代码内容。`focus` 是按钮、链接和 composer 的中性焦点色。

语义状态使用 `danger` / `danger-fill` / `on-danger`、`permission-risk`、`success`；`entity` 用于实体色。不要将危险色用作装饰性品牌主色。

**The Semantic Theme Rule.** 以语义变量连接聊天、设置、菜单和预览；主题切换同时替换背景、文字、边线和状态色。

## Typography

**Display / Body Font:** 共用 frontmatter 的中性无衬线与中文回退栈；没有额外加载 Grok 字体资产。
**Label/Mono Font:** 代码使用 frontmatter 的 `code` 栈。

标题温和，正文清楚；不引入额外展示字体来改变已确认方向。字号是实际使用层级，不是统一比例生成的全局刻度。

- **Headline:** 首页标题采用 `headline`，760px 以下为 26px，480px 以下为 25px。
- **Title:** 顶部会话标题采用 `title`，手机降至 15px；设置内容标题16px，手机外层标题14px；插件详情24px、手机22px；工作区标题为 18px/550。
- **Body:** 聊天正文采用 `body`，手机 15px，字距 normal；用户气泡为 15px/1.75。
- **Label:** 根字号与导航为 14px；辅助说明常用 12–13px；根、正文与输入采用500字重，测试机器实际使用Noto Sans/CJK SC Medium。首页建议与composer提示文字已按用户反馈移除。
- **Composer:** 16px/1.75，维持输入可读性。

来源：`web/tokens.css`、`web/shell.css` 的标题、正文、输入与设置规则；`web/styles.css` 的代码栈。A2UI 保留独立内容排版变量（15.5px/1.75、0.04em），不能把聊天正文规则误写成全部嵌入内容的当前事实。

**The Content Before Decoration Rule.** 标题、正文和控件依靠字号、字重与空间区分，不给聊天正文恢复装饰性宽字距。

## Layout

共享内容上限由 `--content-width`（752px）控制；桌面展开导航由 `--navigation-width`（256px）控制，收起由 --navigation-rail-width 控制为 57px（含1px边线）。主顶部栏高 56px。页面使用 flex 分配内容与工具空间，列表和表单内部多用 4/8/12px 的紧凑间距，区块用 24/32px。

首页是当前聊天表面的表达：桌面标题与输入在内容区上部成组，标题区域上间距为 `clamp(54px, calc(23vh - 56px), 180px)`；已有会话由消息区占据剩余空间，输入留在底部。不是所有页面必须套用的模板。

| 条件 | 已实现行为与来源 |
| --- | --- |
| ≤1080px | 工作区变为右侧覆盖层，宽 `min(380px, 100vw)`；`WorkbenchRail.tsx` 与 `shell.css`。 |
| ≤760px | 导航变抽屉，宽 `min(288px, calc(100vw - 40px))`，收起栏隐藏；顶部栏至少 60px；输入区宽 `calc(100% - 24px)`，消息区宽 `calc(100% - 32px)`。 |
| ≤480px | 首页输入落到底部；重复技能/插件按钮收入“+”菜单；审批与模型仍可访问。 |
| 高度≤500px | 首页标题上下间距缩至 20px，允许主区域滚动。 |

桌面工作区默认 300px，可调范围 260–520px；与覆盖层宽度区分。设置模态桌面宽 `min(1000px, calc(100vw - 32px))`、高70dvh；手机宽 `calc(100vw - 32px)`、高85dvh，标题/关闭独立顶行，分类横向滚动、内容独立滚动。插件中心尺寸见专节。safe-area inset 用于手机导航与输入底部。来源：`web/components/WorkbenchRail.tsx`、`web/shell.css`。

## Elevation & Depth

主界面以明度和细边线区分层级，菜单、选择器、模态使用共享 `--panel-shadow`。浅色为 `0 12px 40px #00000018`，深色为 `0 16px 48px #00000055`（`web/tokens.css`）；模态遮罩继承 `web/styles.css` 的 `#0006`。阴影说明浮层关系，不替代边线与焦点。

**The Flat Resting Surface Rule.** 聊天画布与列表保持平面；浮层用边线和环境阴影说明覆盖关系。

按钮颜色反馈使用 `--motion-fast`（100ms）。桌面导航宽度以 --motion-navigation（300ms）与 --ease-navigation（cubic-bezier(0.23, 1, 0.32, 1)）连续过渡，来源为本轮Grok现场测量。手机导航从左侧 16px、工作区从右侧 20px 进入，透明度 0.6→1，使用 `--motion-panel`（180ms）与 `--ease-out`（`cubic-bezier(0.16, 1, 0.3, 1)`）。菜单仍使用既有 `menu-enter`（140ms，`cubic-bezier(0.22, 1, 0.36, 1)`）；并非所有动效都已统一为 100ms。`prefers-reduced-motion: reduce` 禁用动画、过渡和滚动动画。以上为 newbot 实现，Grok 菜单精确动效未确认。

## Shapes

输入主体使用 composer 圆角；模态使用 panel 圆角；菜单使用 menu 圆角；主要按钮和目录行使用 control 圆角。普通字段保留 field 圆角，导航/菜单行采用 row 圆角。圆形输入区图标按钮与圆角方形导航按钮区别于面板形状；不能强行用一个圆角替换所有控件。边界通常是 1px `line`；引用仍保留语义边线。Lucide 图标经 `web/shell.css` 统一描边 2，普通控件尺寸16–22px，主导航功能图标18px（24单位坐标网格不等于24px显示尺寸）；SidebarIcon采用18px圆角面板轮廓与实心侧栏几何。

## Components

### Buttons

主要按钮是反相实体，padding 见 frontmatter，最小高度 40px、字重 550；悬停使用 `control-hover`，按下向下 1px。危险确认使用独立危险色对。圆形图标按钮默认 36px，hover/open 显示 `hover` 底色和正文色；disabled 通常 opacity 0.45。按钮、链接、summary 的键盘焦点是 2px `focus`、偏移 2px。来源：`web/styles.css` 与 `web/shell.css`。

### Cards / Containers

目录以轻量行承载扩展信息：12px 圆角、hover `surface`，插件中心主要内容 padding 10px 8px、32px 图标底座与18px功能轮廓，标题14px/550、摘要12px。不是独立阴影卡片。设置和工作区由面板边界组织；共享模态与菜单阴影见上。来源：`web/plugins.css` 中插件目录的最终规则；其他独立目录保留原组件样式。

### Inputs / Fields

普通 input/select 使用 `bg`、1px `line`、field 圆角，焦点保留 2px `accent`。composer 使用 `surface` 与 composer 圆角、最小高 106px；textarea 最高 220px，内部背景透明。composer 聚焦时边线加强，并显示 1px `focus` 外框、偏移 2px。搜索型 picker 使用 popover 与可搜索列表，动作菜单保留 menuitem 语义，不互换键盘模型。来源：`web/styles.css`、`web/pickers.css`、`web/components/Picker.tsx`、`web/components/ActionMenu.tsx`。

### Navigation

历史更多与分组箭头使用14px参考轮廓，定义在 `ReferenceIcons.tsx`。

主导航行最小高36px，padding 6px，12px圆角，功能图标18px置于24px图标槽；手机触摸入口至少44px。hover使用中性色；搜索/新聊天/插件使用 ReferenceIcons.tsx 中实测轮廓，新聊天保留24单位网格内2单位描边，搜索和插件保留填充轮廓，不用全局描边替代几何。历史行维持42px，最近对话分组支持语义折叠。桌面展开偏好保存于ma_preferences.sidebar，手机抽屉状态不覆盖它；隐藏导航inert，不进入键盘顺序。设置导航桌面最小高34px、手机40px；图标16px，选中状态保留灰阶背景。抽屉、工作区覆盖层和嵌套模态保持焦点归属；工作区关闭应返回触发入口。来源：`ConversationNavigation.tsx`、`Settings.tsx`、`WorkbenchRail.tsx` 及共享样式。

### Composer and send

输入容器下方集中附件、模型、审批和发送动作。发送按钮桌面 36px，手机 40px；hover 上移 1px，active 复位。disabled 使用 `line` 底和 `muted` 图标（opacity 保持 1），不能只靠降低透明度表达。运行中停止、提交中等待与普通发送沿用 `App.tsx` 的真实状态条件。私密输入不是普通草稿的一种视觉样式，应保留独立组件边界。

侧车 `.impeccable/design.json` 的片段用于静态设计预览，采用实际样式与 CSS 变量并提供浅色 fallback；它们不实现 React 状态、Radix 焦点管理或网络行为。生成的 OKLCH 色阶仅是预览元数据，不是新增源码 token。

## Do's and Don'ts

### Do:

- Do 使用共享语义变量，并同时核对浅深色的文字、背景和焦点。
- Do 在手机保持输入、发送、模型和审批可达；长标题省略，保留工具入口。
- Do 首页保持标题与输入，移除用户明确不需要的建议和底部提示。
- Do 保留加载、错误、禁用和权限反馈，以及键盘焦点和减少动态效果。

### Don't:

- Don't 复制 Grok 标志或字体文件，也不把未观察的菜单动效写成参考事实。
- Don't 为视觉简洁隐藏真实状态、审批语义或私密输入边界。
- Don't 将聊天首页构图强加给所有设置和产物页面。
- Don't 将预览色阶当作新增产品 token；实际色值以源码和本文件 frontmatter 为准。


## Plugin center and settings

来源：web/plugins.css、CatalogNavigation.tsx、ExtensionsSettings.tsx、Settings.tsx；GCF-7 参考位于 .issue/2026-11-13/evidence-grok-plugin-system。插件中心桌面1000px宽/85dvh高、24px圆角；连接器/技能主分类与搜索、新建固定在顶部。目录为双列平行列表、32px中性图标底座、18px功能轮廓、14px名称/12px简介。技能采用实测文档轮廓，更多操作沿用ReferenceIcons，功能身份不由名称猜测。技能来源与专家组合共用一条紧凑分类选择，保留newbot产品能力。

详情、导入与编辑在同一个对话框中逐级导航。Escape返回当前步骤；列表挂载保留搜索与位置，返回恢复触发焦点；保存中阻止关闭与分类切换。卸载/删除仍使用确认对话框。配置来源、revision冲突、保存结果未知和私密字段保护由原业务组件维护。

手机≤700px采用顶部留96px的底部面板，顶部圆角24px，显示拖柄、插件标题与关闭；分类、搜索分行，列表单列。设置桌面1000px/70dvh，200px左分类、右侧内容标题；外观以三个主题预览选择，操作快捷键单独分类。对应外观/操作/存储的图标来自本轮设置几何采集。模型服务与安全保留newbot实际语义，不虚构Grok账号功能。

## 公共控件维护约定（2026-11-15）

本批保留上述全部视觉值与交互。`web/components/FormActions.tsx`集中表单操作区与提交状态：FormActions的editor/catalog/modal分别沿用原editor-actions/catalog-form-actions/modal-actions类，调用方保留动作顺序与取消/检查按钮；FormSubmit只呈现busy、disabled及原忙碌文案或16px旋转图标，不发请求、不拥有业务状态。连接器、模型服务、插件配置、专家、技能创建和商店添加共用此实现。领域回执、脏值、权限和保存策略仍由原业务组件维护。

`CatalogRefreshButton.tsx`统一连接器/技能/专家目录的刷新按钮，显式type=button、可访问名称和忙碌状态；保留技能17px及其ref，其余18px。新表单不得复制提交状态模板；需要特殊行为时先区分领域机制，不把删除/安装/OAuth强行变成表单提交。
