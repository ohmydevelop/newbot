---
version: 1
slug: "plugin-center"
primary_target: "web/components/ExtensionsSettings.tsx"
related_targets: ["web/components/Settings.tsx", "web/plugins.css", "web/components/CatalogNavigation.tsx"]
---
# 插件中心与设置
Mode: Operate.
THESIS: 用 Grok 用户熟悉的浏览、搜索、进入详情和返回过程管理 newbot 能力，减少后台配置感。
OWN-WORLD: 用户指定 Grok；暖黑 #131211、浅色同层级，32px 图标底座、18px 功能轮廓、紧凑胶囊分类与新建，目录双列无卡片外框。
STORY: 侧栏插件 → 连接器/技能/专家 → 搜索或新建 → 同面板详情 → 配置或在聊天中使用 → 返回聊天。专家独立管理提示词、插件、技能和连接器的组合。
FIRST VIEWPORT: 桌面1000px/85vh面板，顶部分类与搜索/新建；手机带标题和拖柄的底部面板，单列目录。设置在桌面用左分类/右内容。
FORM: seed: none (pinned)。用户要求“采用与grok完全一致的心智模型和布局，交互，配色等”“界面要尽可能的少那些可有可无的说明性的提示语”。代码优先，真实网页证据而非生成概念图。产品能力不同不虚构第三方市场、机器人托管或登录授权。
QUALITY BAR: evidence-grok-plugin-system 的 Grok 桌面连接器、手机插件、设置截图为参照；之前用户已拒绝仅替换近似图标的结果。尺寸/轮廓/层级/交互都需验收。
FINISH: 独立复核、真实浏览器验证、更新 DESIGN 与问题进度、发布实际实例。

GCF-8 deep operations: phone directory remains a sheet; a deep form occupies the viewport with one back/title/close row. Name/description/instructions and connection fields stay single-column; optional Codex fields expand on demand. Desktop deep forms keep the same modal/navigation stack and a 660px field measure. Store registration is distinct from plugin installation. Chat text bubble precedes independent media blocks, shared by optimistic and persisted rendering.
Deep mobile ground: current Grok New Skill reference uses #191919 for page and fields; use this local override only below 700px for deep steps. Keep directory/chat #131211 and existing light palette.

GCF-9: 三个独立分类；专家提示词随每次请求快照，旧记录默认为空。商店表单只收链接，后端推断版本/目录，原生 Codex 解析与安装；移除重复浏览插件入口。连接器、导入、商店分别为插头、导入箭头、店面，同一轮廓线宽。连接表单避免名称/方式/地址的重复标题，保留可访问名称。

GCF-10: 配置的保存/检查共用一个动作组，未保存草稿禁用检查。状态统一位于名称下，区分包启用、字段配置、连接及授权；未安装声明显示安装后可配置。可选标记仅一次。证书在添加/编辑远程HTTPS连接器中按需展开，选择PEM/DER，信任仅当前origin；不加入全局跳过TLS选项。OAuth完成按当前loginId消费并清理授权链接，失败可重试。
