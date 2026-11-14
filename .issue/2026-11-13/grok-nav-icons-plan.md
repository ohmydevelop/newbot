# GCF-6 左侧栏参考图标精度

## 目标、触发与约定
用户在实际手机展开左侧栏，指出只有折叠图标与Grok一致。原图保存 evidence-grok-nav-icons/user-original.jpg。预期搜索、新建聊天、插件等已存在对应功能在形状、显示尺寸和线端处理上与当前Grok一致；本轮不重做聊天/模型协议。

## 当前证据与根因
- 已复现并有代码证据：ConversationNavigation 向搜索、NewChatIcon、PluginIcon传24px，而SidebarIcon为18px。
- Grok现场DOM：三种功能SVG viewBox 24，但外层实际宽高18px（包括手机展开导航）。前轮误把坐标网格/原始Lottie 24x24当成实际显示尺寸，造成约33%放大；用统一stroke-width并不能修复这个问题。
- 新建聊天、插件前轮仍是近似自绘路径，分别改变了笔尖/容器、分区/浮块几何；搜索仍为Lucide圆端实现。Grok Chat线端square、join miter；Plugins/Search为填充轮廓。证据reference-paths.json、grok-mobile.png。
- 品牌和账户不是同功能参考：newbot保留自己的产品名称与标识，不复制Grok商标或账户照片；运行/等待/失败状态为newbot保留能力，不能删除状态冒充对齐。

## 同类风险
|入口|共同机制|状态/证据|处置|
|桌面展开、收起栏、手机抽屉|ConversationNavigation尺寸参数|已复现，24px与参考18px不符|统一导航18px图标槽，44px手机点击目标不缩小|
|插件目录、选择、能力侧栏、执行过程|复用PluginIcon|有代码证据，共享同一近似路径|仅替换共享路径，保留各角色尺寸|
|搜索菜单/工具搜索图标|Search的重复导入|有代码证据|共享参考SearchIcon，相关语义入口同图形；不调整非导航布局|
|历史更多/分组箭头|Lucide近似轮廓|已验证：fidelity.json均14px、路径一致，mobile-candidate可见更多|共享静态符号，更多菜单实点可开|
|品牌、账户、已读/运行状态|newbot自身身份/能力|不适用完全复制；状态必须保留|明确边界，保留真实状态和可访问名称|
|点击、键盘、主题、窄屏|导航按钮布局|已验证：搜索/新建/插件点击；搜索Enter打开/Escape关闭；深浅色320/390及1280、触屏coarse。完整键盘遍历未测|证据见进度及候选截图；不宣称完整键盘审计|

## 实施步骤与范围
1. 固化本轮可见路径与测量，不执行Grok消息或更改账号。
2. 在共享图标模块采用采集到的静态几何，currentColor继承主题；不引入Lottie运行时。导航尺寸改18px，保持按钮触控面积和动作。
3. 类型/相关测试与预览真实浏览器；按实际18px与24px放大对照图核查轮廓，不以“风格统一”替代精度验收。
4. 用户拒收后的全新独立完整复核；备份实际构建后发布静态资源并验证原Cloudflare入口。若仅前端变更，优先不重启模型服务。
无数据库/配置修改、无数据迁移，不改思考独立折叠及A2UI。

## 验收和状态
实施、浏览器验证、独立复核修正与原入口静态部署均完成。原图→显示尺寸误判/近似路径→共享功能入口→路径与尺寸修复→DOM尺寸、对照截图、实际入口资源哈希闭环。进度文件 grok-nav-icons-progress.md。

完成证据：grok-nav-icons-progress.md、grok-nav-icons-review.md、grok-nav-icons-verdict.md，以及 evidence-grok-nav-icons/{fidelity.json,deployment.json,live-mobile.png}。保留初次候选失败测量fidelity-initial.json作为CSS覆盖根因证据。
