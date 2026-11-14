disposition: ship

本轮为修正截图后的完整独立审查；没有批准的效果图或独立 QUALITY BAR 卡，依据用户明确指定的 Grok 方向、实测参考、产品约束和代码优先契约评审。

## persistence

通过。`PRODUCT.md`、`.impeccable/surfaces/web-app-tsx.md`、`grok-ui-plan.md`、`grok-ui-analysis.md` 和 `grok-ui-progress.md` 均存在。FORM 的 `seed: none (pinned)` 有明确用户确认支持：日常聊天优先，工具与设置按需展开，并高度接近 Grok 布局、配色与交互。这是 Operate 代码优先构建，无效果图审批或 comp-led gate 义务。最终 DESIGN.md / design.json 属于本次审查之后的文档交付，不能把本审查替代该步骤。

证据有效性复核通过：原先裁切的桌面深浅色、设置深浅色、网关和桌面工作区已替换成完整1440×900 PNG，平板为900×900；390×844手机及320×720窄屏画面完整。上一轮 `recapture` 已解除，不能再沿用当时的裁切截图判断产品缺陷。

实际打开的16张交付截图：`desktop-dark.png`、`mobile-dark.png`、`user-320.png`、`tablet-900.png`、`desktop-light.png`、`settings-dark.png`、`settings-light.png`、`providers-light.png`、`plugins-mobile.png`、`settings-mobile.png`、`chat-mobile.png`、`workbench-mobile.png`、`workbench-desktop.png`、`files-mobile.png`、`model-mobile.png`、`skills-mobile.png`；参考为 `grok-desktop-main.jpg`、`grok-mobile.png`。文件均位于 `evidence-grok-ui/`。

源码审查涵盖 `web/App.tsx`、`web/styles.css`、`web/shell.css`、`web/tokens.css`、`ConversationNavigation.tsx`、`ChatStarters.tsx`、`WorkbenchRail.tsx` 和样式加载入口。核对了类型检查、构建及单测日志：511通过、1跳过、0失败。没有运行额外浏览器或测试。

## fidelity

|要素/契约|结论|证据及适配依据|
|---|---|---|
|GROUND：温黑画布与输入容器|match|候选图采样为(19,18,17)/(32,31,29)；参考JPEG为(19,18,16)/(32,31,29)，1级蓝通道差异符合JPEG误差，源码使用实测#131211/#201f1d。|
|TYPE：中性无衬线、清楚的标题/正文层级|adaptation|中文标题25–28px与正文15.5px符合方向契约；没有复制Grok字体资产。中文长度、newbot内容及保留能力构成适配依据。|
|MATERIAL：平面数字界面、低对比边界、细线图标|match|没有伪造材质或装饰性插画；圆角输入框和Lucide描边统一，深浅色组件共享语义层级。|
|FIRST VIEWPORT：桌面标题与输入区成组|match|完整桌面和平板图中标题在上三分之一附近，752px输入区紧随。收起导航为合法现有状态，展开导航由桌面工作区图覆盖。|
|STORY：先聊天，按需打开工具|match|空首页以输入为主；会话状态输入落到底部。设置、模型、扩展和工作区按现有入口打开；手机重复工具收入“+”菜单符合明确产品选择。|
|手机/320px响应式|match|完整首页保留标题、附件、模型、审批和发送控件；新版chat-mobile头部长标题省略，工作区按钮完整可见。|
|原有模型/审批/插件等能力保留|adaptation|输入区比Grok多出newbot模型与审批语义、桌面建议按钮；用户明确要求保留现有能力，新增密度集中在输入附近，没有改变主阅读顺序。|
|设置、插件、网关、文件工作区|adaptation|无对应Grok菜单内部实测，不能称逐项复刻；以统一token和newbot既有功能继承方向。完整浅色设置图消除了上一轮过渡中间态。|
|SIGNATURE INTERACTION|match（实现与有限行为证据）|建议改填草稿；CSS为导航/工作区定向短进入，减少动态效果分支存在。文件弹窗焦点返回的browser-checks记录显示仍在开放工作区内。静态图不能证明动效体感。|

没有发现需要重建的构图、颜色或材质背离，也未发现本次变更造成且仍有证据未修复的材料级功能回归。

## ceiling

达到已确认方向在当前证据范围内的完成度。Grok参考本身以留白、低对比边界、克制字体和输入容器为主要手法；不需要额外纹理、品牌图片、装饰动效或强视觉标识来补足页面。

范围限制：模型和技能面板图保留了较早轮次的旧头部状态，面板本身可评审；最终头部适配以更新的 `chat-mobile.png`、当前共享CSS和DOM边界记录为准。没有由静态截图推断真实流式动画、真实模型服务兼容性、全部审批/私密输入路径、浏览器软键盘行为或所有长代码/产物类型已覆盖。`browser-checks.json`直接支持320/900宽度、工作区键盘切换/宽度调整、手机头部边界及文件弹窗焦点返回；其他交互结论来自实施进度记录与现有测试日志，不能扩展为本审查亲自执行。

Craft的`consent_required`仍限制独立Grok采集。未观察的Grok菜单、设置、付费流程及动效不在保真认证范围。候选构建使用模拟Codex上游；ship是对本次所交视觉与源码变更的审查结论，不是生产部署或真实服务兼容认证。

## material_fixes

无。唯一检测器项 `web/styles.css:802` 是Markdown引用的3px中性边线，承担引用语义，既非彩色卡片侧条，也不是本次加入的装饰；不要求删除。没有运行第二遍检测器。

## keep

保留温黑/中性浅色语义、桌面成组与手机底部输入的响应式差异、可编辑建议、真实审批/状态入口，以及工作区嵌套弹窗的焦点归属；后续文档与进度收尾应如实保留模拟上游和未实测路径的边界。
