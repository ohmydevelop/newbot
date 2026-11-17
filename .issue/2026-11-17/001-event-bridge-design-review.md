# Event Bridge 独立完成审查

## 1. Disposition

**fix**。默认信箱事件的八张必需截图有效，未发现布局级或视觉体系级问题；通用 schema 枚举字段存在一项有代码证据的语义缺失，修正后需要回传截图做 verdict pass。无需 rebuild 或重新设计。

## 2. Scope and evidence

审查范围是普通扩展的通用事件配置 UI，包括账号连接表单、事件参数、订阅状态；目标是保留 Newbot 既有 Grok-inspired 字体、主题、侧栏与就近浮层。独立读取了 `.impeccable/surfaces/automations.md`、`DESIGN.md`、`PRODUCT.md`、craft-floor，以及 `AutomationSubscriptionFields.tsx`、`EventConfigurationFields.tsx`、`AutomationChoice.tsx` 与相关 CSS。无 approved comp，未声称精确 Grok 像素一致。

已逐张打开 `.impeccable/review/event-bridge/{320,390,768,1280}-{light,dark}.png` 共八张，均是文件名所指宽度/主题的已加载事件条件浮层，无空白、黑屏、半载入或错误页面。另查看 `account-320-light.png`、`account-390-dark.png`、`account-768-light.png`、`account-1280-dark.png`、`status-320-dark.png`、`status-1280-light.png`。旧版对照为 `.impeccable/review/event-subscriptions/320-light.png` 和 `1280-dark.png`。机械检测结果 `/tmp/event-bridge-design.json` 为 `[]`，本审查未重跑 detector。

## 3. Material findings

| ID | 严重度 / 状态 | 证据与影响 | 必须修正与验收 |
| --- | --- | --- | --- |
| EB-UI-1 | P2 / 有代码证据 | `web/components/EventConfigurationFields.tsx:37` 的 enum 分支直接返回 `AutomationChoice`。其 `label` 只成为 aria-label；`AutomationChoice` 的可见文字在选值后只显示选项，title 也优先显示选项。任意插件提供“优先级 → 高”或“范围 → 全部”时，已选字段的含义从可见表单消失。新通用 schema 字段不一定像旧版“Issue 已关闭”那样自解释。这违反方向约定的持续字段标签，也与同组件 string/number/boolean/array/object 的持续语义不一致。八张默认截图只有 string 与 boolean，不能覆盖这个分支。 | 仅在通用 enum 字段入口增加持续可见的字段标题并保留原可访问名称、Picker 与主题，不改共享选择器所有入口。用一个有默认/已选枚举值且字段名与选项明显不同的真实 schema 配置验收；选值前后字段名都可见，长值不撑宽，嵌套 Picker 可关闭并恢复焦点。修正后更新原八张宽度/主题截图，并补充至少 320/1280 两宽度浅深色的已选 enum 状态供 verdict pass。 |

除此项外，本次已查看证据未发现需要修改的重大视觉问题。未把未捕获的 schema 类型当成已通过。

## 4. Craft floor and incumbent consistency

默认事件配置的文字/输入/checkbox 左轴清晰，checkbox 为紧凑方形且与标签同排；320px 浮层留有视口边距，768px 保留侧栏时条件仍可容纳，1280px 没有无谓拉宽字段。源码宽度 `min(360px, calc(100vw - 24px))`、16px padding、12px gap 与有限高度内部滚动解释了这些结果。账号表单较长时的底部裁切属于有界滚动容器，未据静态首屏误报为不可达。

浅色白/中性灰与深色温黑继续使用既有 token；标题/正文/辅助字、边线、共享圆角、带偏移软阴影及反相保存动作与旧版截图一致。输入保留焦点环，checkbox accent 使用正文主题色，没有新增展示字体、渐变、装饰图形、卡片墙或 eyebrow。仅有 provider 标题是在明确当前编辑对象，属于内容标题。沿用既有 popover 与 Lucide/共享图标。无新增 shipping raster 资产需要 provenance。

状态文案“监听中”、连接/编辑/保存账号动作明确。可见截图内未发现文字重叠、横向越界、按钮遮挡或主题错配。静态截图不提供逐像素对比度测量；本轮未实测每一个浏览器默认表面或动画。界面扩展应保留 `DESIGN.md` 与既有设计文件，无需覆盖或新建视觉体系。

## 5. Limitations and handoff

审查人未运行浏览器交互。传入的 matrix8、无水平溢出、Escape 焦点恢复、账号创建→真实 stdio mailbox 插件→任务运行证据属于实施方报告，不能表述为审查人独立执行。实际物理手机、软键盘、完整动效、hover/loading/error/disabled/OAuth 全状态及任意第三方插件 schema 没有由本组静态截图独立证明。mailbox 的运行结果不等于外部服务兼容性证据。

下一步仅修正 EB-UI-1、进行上述验收并回传同一审查人；verdict pass 只评分该问题是否 resolved/partial/unresolved。当前 **fix** 不可表述为全表面 ship。未修改产品实现。

## 修正后独立 verdict pass（2026-11-17）

### 1. Disposition

**ship**，限定为本轮 EB-UI-1 修正评分；已列出的唯一 material finding 为 **resolved**。此结论替代初审针对该条目的 fix，不扩展为全产品或所有事件插件能力的审计。

### 2. Scope and evidence

本轮仅复核 EB-UI-1。独立重新逐张打开替换后的 `.impeccable/review/event-bridge/{320,390,768,1280}-{light,dark}.png` 全部八张，均为相应宽度/主题、已选择“重要”的条件浮层，有效且加载完成。复核 `EventConfigurationFields.tsx` 的 enum 分支、`web/automations.css` 的 `.automation-event-field`、浏览器测试第 69–73 行、最新 `.issue/2026-11-17/evidence-event-bridge/browser.json` 及 `/tmp/bridge-browser-release.txt`。

### 3. Finding score

| ID | 评分 | 修正证据 |
| --- | --- | --- |
| EB-UI-1 | resolved | enum 入口现在用独立 `span` 持续显示 schema 标题，控件继续保留原 `label` 和共享 AutomationChoice；字段名与值不再互相替代。八张截图均清楚显示“优先级”及下方已选“重要”，没有标题消失、遮挡或该字段撑宽。测试在默认状态和选值后断言标题可见，嵌套 Picker Escape 后断言触发器获得焦点；报告记录八种宽度/主题全部 passed、无 skipped/unexpected/flaky。 |

### 4. Craft floor and consistency

字段采用既有正文与 Picker 外观，8px 标题到控件间距、grid 和 min-width:0 只组织该通用字段，不重设共享选择器或全局主题。八张图中修正与既有“信箱”标签层级一致，320px 仍保留浮层边距。该项修正达到初审要求，未引入另一套颜色、字号、圆角或菜单模式。保留既有 DESIGN.md。

### 5. Limitations

本轮为指定修正评分，未扩大缺陷调查；审查人读取了执行报告与测试断言，没有独立重跑浏览器。当前截图中的选项为短文案“重要”，不是任意长度枚举值的视觉覆盖证明；控件继续复用既有截断机制且此次只增加标题。首轮关于物理手机、软键盘、完整动效、第三方 schema/外部服务及未展示状态的限制继续成立。
