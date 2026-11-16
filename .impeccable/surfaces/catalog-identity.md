# 目录身份与动作
Primary target: web/components/CatalogIcon.tsx
Related targets: web/catalog.css, web/plugins.css, web/components/ExpertsSettings.tsx, web/components/ProviderSettings.tsx
Mode: Operate

用户认可自动任务的身份色与目录比例，要求向其他业务延展。沿用DESIGN.md原有语义色：连接器/插件蓝色柔和底，技能与模型橙色轮廓，专家绿色轮廓。显式kind决定颜色，不按名称猜测品牌。名称14px/550、说明12px/muted单行省略；列表图标槽32px/图形18px，行尾+为32px/9px圆角，移动触摸目标沿用原控件规则。状态和更多保持整行居中，顶部工具栏/导航尺寸不改，详情保留既有尺寸。

共享实现：CatalogIcon用于所有设置目录；catalog.css只拥有身份配色，tokens.css提供目录比例；自动任务复用相同身份色规则但保留用户选定的颜色。没有新的图片或品牌资产。验证：AUTO-4计划/进度，浅深色320/390/768/1280截图、真实连续性/状态/弹层检查。

Finish outcome: 独立视觉复核未发现产品代码修正项；唯一文档修正已resolved，disposition ship。证据006-automations-controls-design-review.md。范围仅本轮工具栏及目录身份规范，非全功能Grok等同认证。
