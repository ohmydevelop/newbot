# NB-UI-12 / 001 · Grok 体验偏差与可执行质量约定

日期：2026-11-16。范围：深入分析、证据收集和实施计划；本轮不修改产品、不部署。不覆盖此前 NB-UI-11 结论。

## 用户目标与问题拆分

用户要保留已认可的旧版 Grok 式体验，在内部统一组件、状态和协议；字体颜色、信息密度、图标、动画、拖拽、滚动、焦点和往返上下文均属于产品行为。重构不能以“能用”“测试数量多”“公共组件变多”代替体验等价。

- 001：原文件 001.md 仅引用 image.png。用户本轮明确：问题是“顶部控件的大小、间距和对齐”，不是文字发虚/重影。原文件和截图不修改。
- UI-12-A：字体、颜色、动画、交互和整体感觉偏离已认可参考。尚未逐一实测归因，不能全部归因于最近提交。
- UI-12-B：长期纠错没有稳定成为可执行发布约束，导致局部修好、整体反复。
- UI-12-C：本轮横向发现分类往返丢失搜索条件，影响操作连续性。

## 被破坏或尚未落实的不变量

1. 未声明改变的视觉/交互应在重构前后等价；产品扩展不改变基础控件语法。
2. 同一顶部栏由一个布局所有者控制中心线、密度和响应式策略，关闭按钮不能另用无关联偏移凑齐。
3. 从目录切换分类、进入详情再返回，应按明确导航约定恢复查询、筛选、滚动和焦点；慢请求不能决定是否保留上下文。
4. 反馈、运行状态、取消、拖拽和滚动应遵循可测的状态转换，而非只有结束截图正确。
5. 发布的二进制必须是通过检查的同一构建；没有检查、未完成采样、模拟上游，均不能报告为真实路径通过。
6. Grok 参考版本及用户认可的适配应明确冻结。不能混合不同日期/路由/主题的参考，不能把当下所有 Grok 改版自动应用到 newbot。

## 已知证据与因果判断

### E1：顶部错位已在线上复现

公开入口 https://integration-love-angela-heated.trycloudflare.com/ ，1280×720 / DPR 1。evidence-ui-drift/toolbar-metrics.json：分类按钮高32、搜索高34、新建高34、刷新高30、关闭高36 CSS px。前六者中除关闭外中心 y=92，关闭中心 y=87，偏差5px。

代码路径：web/plugins.css 的 plugin-center-header 用 flex / align-items:center；plugins-modal > modal-header 使用 absolute、top:14px，与主栏分离。CatalogToolbar 里的搜索/新建/图标按钮各有自己的尺寸规则。不同高度并非一律错误，但当前没有统一的视觉尺寸与点击区域规范，关闭按钮偏离中心线是可验证故障。

关联：连接器/技能/专家使用相同 ExtensionsSettings、CatalogToolbar、Modal 外壳，应在三分类和各断点一起验收。不能只改 close 的 top 从14到19作为长期修复。

### E2：分类往返丢失搜索已复现，且与时序有关

输入 cloudwalker → 切到技能 → 等“搜索技能”实际可见 → 返回连接器，查询变为空。evidence-ui-drift/catalog-continuity.json。

第一次在技能 lazy 模块尚未挂载时快速返回，查询仍保留；等待实际挂载后才丢失。说明只走快速路径会产生假阳性验收。

代码解释：ExtensionsSettings 条件渲染 Plugins/Skills/Experts；ToolsSettings 将 query、marketplace 存在自身 useState，卸载时失去目录上下文。技能/专家查询使用类似页面局部状态；这些关联入口有代码证据，但本轮未全部逐个复现。应区分面板内导航状态与短寿命请求状态，不能简单永久挂载所有页面并让后台请求一直运行。

### E3：自动门槛与用户期待不匹配

当前 package.json 的 check=tsc，test=tsx --test tests/*.test.ts。仓库 CI (.github/workflows/ci.yml)执行 check/test/test:official/build/container smoke，没有调用 UI 浏览器脚本，没有截图基线断言、拖动/动效性能门槛、设计规则 lint。

不是“没有测试”：scripts/test-ui-regression.mjs、test-interaction-ui.mjs 等有真实浏览器检查和截图；此前 issue 还留有局部改前/改后像素比较。但它们不是完整的必过发布门槛；package devDependencies 未声明 Playwright，脚本依赖外部模块环境。test-ui-regression 的截图禁用动画，test-interaction 创建 reduce-motion 环境；这能验证稳定布局/可访问性，不能证明普通动效丝滑。

上一轮563项单元测试通过是真的，但不能推导整体 Grok 体验等价。mechanical detector 的 [] 同样不能证明对齐。

### E4：参考混用和历史缺口

11月13日原始参考：../2026-11-13/evidence-grok-plugin-system/grok-connectors-desktop.png，独立插件面板、顶部两分类与搜索/新建。

本轮实际打开 grok.com，点击 Connect apps 得到 /?_s=connectors，呈现设置侧栏内的 Connect Apps 页面。见 evidence-ui-drift/grok-current-connect-apps.png。两次呈现显著不同；仅凭观察不能断言全体用户已升级或排除实验/账号分流。因此只能记录“本会话当前呈现不同”，不能立即把新版本当已授权设计目标。

旧 grok-ui-analysis.md 明确说字体采用本地替代、浅色未来自参考实测、菜单/工作区180ms是适配并非Grok实测。旧 DESIGN.md 的载入层说明也未列出现有最后加载的 plugins.css。字体/配色 token 从旧产品提交 d9f9d56 到当前7abc724未改，plugins.css 该区间只有 NB-UI-11 追加规则。这些事实不支持“本轮重构改坏了所有字体和动画”；应拆成原来未对齐、后来回归、参考变化三类再修。

当前 CSS共8842行（styles6308/plugins1311/shell687/pickers456/tokens80），具有逐层覆盖结构；这说明维护和追踪困难，不单凭行数判定运行性能或错误。

### E5：拖拽、性能仍需专项验证

WorkbenchRail 当前 pointermove 每次 setWidth，宽度260–520，pointerup/cancel保存；未见 lostpointercapture 对应收尾。本轮没有采集帧时间或复现卡顿，因此仅列为需验证的机制，不声称 setWidth 必然慢。检查拖动时跨过iframe、失焦、取消、到边缘、窄屏切换、键盘调整与宽度恢复。

当前 Grok 首页 AX 明确包含左侧 Resize sidebar；newbot ConversationNavigation 未实现对应拖动，只有右工作区 separator。是否补齐以冻结参考与用户确认的能力适配为准，不能用右栏可拖动当作两侧一致。

web/performance.ts 是可选的导航/资源/首屏观测，不覆盖拖拽每帧、输入响应、长聊天重绘。本轮不能给出新旧性能百分比。

### E6：源码与线上身份需要标准化

开发目录 /home/a/Documents/ChatGPT/newbot-systematize HEAD=7abc724；生产工作目录 /home/a/Documents/ChatGPT/newbot HEAD=a53c9d2，但运行dist来自systematize。公开HTML与dev/dist/web一致，本轮页面加载index-BSlEzZc1.js；上一轮发布记录标识web=d9d311e、server=8a3e0bf。

这不是本轮已证实部署错版本，但靠人工记忆判断版本有风险。证据 evidence-ui-drift/version-check.json。需要release manifest记录前端/后端/native/配置schema和构建哈希；以实际运行manifest审计，不读工作目录git HEAD猜测。

## 同类风险（按机制选择）

|优先级/入口|状态|关联机制与检查|
|---|---|---|
|P1 分类切换/目录返回|已复现|卸载丢局部状态；验证连接器/技能/专家、慢加载、失败、搜索/筛选/滚动/焦点|
|P1 交付质量门槛|有代码证据|CI不跑体验检查；需要证明坏改动能使CI失败，部署仅接受该构建|
|P2 三分类顶部栏|已复现/共同机制有代码证据|绝对定位关闭与flex主栏；桌面/窄屏、长文案、加载/忙碌态均检查|
|P2 字体/颜色/图标|参考差异有证据，具体回归待验证|冻结参考、记录加载字体/缩放/DPR；跨菜单/设置/目录/工作流程检查token和语义icon|
|P2 导航/弹层/工作流程动画|待验证|静态截图及reduce-motion不能证实普通动效；采完整出现/退出/打断/重开|
|P2 拖拽/滚动连续性|部分有代码证据，性能待验证|右栏pointer状态、嵌套滚动、iframes、边缘与失焦；保留聊天滚动锚点|
|P2 发布来源|当前构建匹配，机制有风险|源码checkout与运行dist不同；不可变构建和manifest|
|本轮不纳入：OAuth/证书/模型鉴权重构|不适用|本轮未发现与视觉偏差共同根因，保留现有契约，不借机升级框架|

## 实施计划：让纠正成为可执行约定

### 0. 冻结体验基线（依赖：确定参照）

从11月13日原始Grok证据与旧newbot产品提交建立参照清单；不能把当前有缺陷的截图直接全部批准成golden。记录来源日期/路由/主题/视口/缩放/DPR/字体/状态。将“Grok实测”“保留的newbot能力适配”“尚未测到”分开。当前Grok新设置布局只作为额外证据，不自动升级目标。

基线按核心流程而非单一首页覆盖：新聊天→选能力→发送→工具/思考→取消/完成→历史恢复；目录→搜索→筛选→详情→返回→分类往返；设置/模型/MCP证书；工作区开合/拖拽/滚动；桌面1440/1280、平板768、手机390/320，深浅色及正常/减少动画分开。

### 1. 先把001和连续性问题写成失败检查，再修共享所有者

- 001：三个分类的顶部控件均由共享Toolbar拥有布局，关闭通过同一栏slot布局，视觉尺寸和hit area分开定义；不是给每个入口加偏移。
- 建议几何验收：固定环境同栏视觉中心差≤1 CSS px，大小/gap等于冻结的密度token；长文案和断点无重叠/遮挡。不要求所有控件都画成同样高的粗按钮。
- 连续性：目录session拥有各分类query/filter/scroll/focus；页面短生命周期只管理本页操作和取消。等待不同分类真正加载之后往返仍恢复原查询与筛选；失败/迟到响应不能重置当前页面。若关闭整个目录需清空状态，将它作为显式导航策略。
- 先用当前代码跑失败测试，修复后同测试通过；做一个人为5px偏移/清空query的验证，证明检查确实会拦截，不只是生成漂亮截图。

### 2. 建立静态边界，减少错误写法可选择范围

采用成熟 ESLint/TypeScript/Stylelint 和现有Radix能力；不自研另一套框架。优先规则：

- 已迁移的展示组件只能使用统一语义Icon入口/Toolbar/菜单/弹层；通过静态导入边界和JSX检查限制另起一套。静态import限制不自动覆盖dynamic import，检查范围需明示。
- 展示层颜色、字体、圆角、动效只使用语义token；允许图表/第三方品牌/运行尺寸等必要例外，例外有明确作用域。
- 禁止新增全局补丁覆盖、无约束!important和transition:all；以CSS解析规则检查，不用简单grep误杀。
- 展示层不直接请求、写持久配置或自造并发状态；统一领域controller/operation scope。副作用集中到明确边界，不能立即全库禁用useEffect再机械替换。
- 不用注释或eslint-disable掩饰缺口；必要注释用于不变量、协议/安全原因，禁止规则豁免必须走可审计的例外入口。
- 先迁移选定组件并对新代码强制；旧债逐项消减且不得增加。不能一键全库格式化/自动fix制造新回归。

### 3. 视觉、流程、性能分别建立门槛

- 视觉：固定浏览器/字体/OS环境，稳定测试数据，组件级和完整流程关键帧截图差分，加DOM尺寸/颜色/字体断言。跨平台各自基线，不能用全图均值掩盖小区域错位。agent不得为了绿灯自动更新golden或扩大阈值。
- 流程：在真实浏览器等到状态实际完成后测试，覆盖冷/热加载、慢响应、连续操作、失败、取消、焦点、目录返回、流式更新滚动锚点、附件分开渲染、工作流程折叠/边缘滚动。
- 动效：正常motion录屏/trace与关键时序检查；reduce-motion单独运行。验证出现与退出、中途反向、重复开关，不以截图替代。
- 性能：固定硬件/浏览器和长聊天/多工具/多插件夹具，测发送本地回执延迟、输入响应、切换、拖动帧时间及长任务。先测合格旧版基准，提出并验证绝对预算与相对退化预算；不在未测量时编造“60fps通过”。模型网络耗时与本地响应分开。
- 模型化/性质测试优先用于一次发送一次执行、取消/迟到消息、权限与会话隔离。复杂并发再考虑TLA+有限状态模型；形式验证不能证明字体好看或整个应用无bug。

### 4. CI与发布真正联动

现有脚本接入可重复环境，固定浏览器依赖；在PR执行lint、契约测试、固定视觉/流程；更重的性能/真实上游验证按发布风险执行。产出reference/actual/diff、录屏、trace、版本manifest。

本地hook只能快速反馈，不能称为“提交不上去”的最终保证。required CI和分支规则阻止未过检查合并；发布命令独立检查验收manifest及同一artifact hash，防止绕过PR直接部署。本轮未读取远端分支保护，不能声称已有或完全没有；GitHub connector搜索该仓库返回权限/不可访问错误，现阶段以本地issue为准。后续按实际权限核实。

纯重构与体验变更分开提交；基线变更需具体差异和用户认可，而不是agent自行刷新截图。用户不必每次审代码，但看得见关键差异。先做到受控发布，再谈自动合并修复。

## 关于演讲总结的采用边界

采用“代码结构/接口消除错误选择 → 确定性检查 → 运行验证 → 最少必要说明”的方向。不是每次纠正都硬写lint：字体用视觉/字体断言，中心线用几何断言，导航连续性用行为测试，竞争用模型/性质测试，性能用trace。每条纠正选择能真正失败的验证层。

不机械照搬禁99%注释或全库禁useEffect。React官方说明Effect用于与外部系统同步，派生状态不应滥用；设计边界比统计数量重要。演讲的PR数量、回滚率只是用户提供的案例数字，不作为本项目目标或保证。本轮确认视频链接但未获得可核查完整原始字幕，不补写未经核实的原话或职务结论。

参考：
- https://www.youtube.com/watch?v=O_zcc6Xl12g
- https://react.dev/learn/you-might-not-need-an-effect
- https://react.dev/reference/react/useEffect
- https://eslint.org/docs/latest/rules/no-restricted-imports
- https://playwright.dev/docs/test-snapshots
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches

## 完成状态与未解决项

本轮调查/计划完成；001顶部错位、目录连续性有实际浏览器复现，尚未修复。未完成完整动效/拖拽性能采样、全平台字体对照、冷/热所有流程、远端branch rules核实。未更改产品、主题偏好、账号配置、数据、CI或部署；仅写本issue调查资料。后续从步骤0和1开始，不另起“更现代”的新UI，不升级整套框架。

兼容措施：优先只变共享布局和界面状态归属，不更改会话/插件/凭证schema；导航暂态仅在目录会话作用域保留。任何后续持久化版本变更另立迁移方案。上线前保留上一不可变前端构建，回滚前端不回滚或覆盖新业务数据。
