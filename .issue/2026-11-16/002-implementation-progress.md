# NB-UI-12 实施进度

2026-11-16：用户授权实施。开发树codex/newbot-systematize，起点7abc724，初始工作树干净。原始反馈、调查、用户最终决定均已落盘。使用Impeccable已加载的旧版设计上下文及craft floor，不更换视觉风格。先建立检查，然后改共同机制。

## 第一轮实施与真实浏览器检查
- 设置改为八个平行分类；移除单独插件入口及二级tab；共享标题栏包含关闭/搜索/添加/刷新。删除三份旧CSS中重复的设置布局规则，统一由settings.css维护。
- 搜索及筛选改用应用内CatalogViewState；既有表单、operation scope与后端接口不动。旧入口plugins/mcp映射connectors。
- 两侧共享PanelResizer与尺寸预算；键盘10px/Home/End、RAF更新、capture丢失/blur收尾、持久化，旧右栏localStorage键兼容。
- 浏览器：1280桌面所有标题栏控件中心y=93（原5px差消失）；390/320无横溢出，搜索/添加/刷新均44px；跨技能实际挂载后返回保留搜索；Escape从详情返回且焦点回原条目。
- 新发现并已修正代码：异步目录加载前误判滚动已恢复，320px实测625px→0。恢复必须等待列表容纳目标位置；用户滚轮/指针/键盘介入则取消待恢复，防止晚到数据抢滚动。待复测。
- 新状态契约测试先因共享状态模块不存在失败，再实现后通过；原版浏览器失败证据沿用001。5px错位/查询丢失故障注入检查已添加，不能将仅模块缺失的red称为原版视觉自动复现。
- ESLint/Stylelint限定本轮共享组件与样式；浏览器检查脚本及固定Playwright依赖正在接入CI。尚未部署，尚未宣布所有验收完成。
- 响应式关联风险已复现：桌面同时开设置与右栏，再缩为手机，右栏改成Dialog会抢焦点覆盖设置。修正共享覆盖层边界：设置/搜索/重命名/附件预览/工作区/专家详情/私密授权打开时，不挂载右栏覆盖层；保留railOpen偏好，退出当前任务后恢复。

## 第二轮浏览器证据
- 1440/1280/768/390/320 × 浅/深 × 连接器/技能/专家共30组几何检查通过；见evidence-ui12/matrix.json及对应截图。桌面关闭、搜索、添加、刷新中心误差≤1px；手机操作行44px；无横溢出。
- 滚动缺陷复测通过：320px连接器滚动625px→技能实际挂载→连接器异步列表完成后625px；关闭重开保留当前分类、查询及搜索焦点。详情Escape返回条目焦点通过。
- 两侧鼠标拖拽通过：左400→320，右520→420；结束无残留shield和dragging属性，刷新后仍320/420。设置打开时缩为390px只保留settings-dialog，没有右栏覆盖层。
- motion.json：正常catalog-step为0.18s、导航0.3s；reduce均0s。截图不能替代实际录屏；完整时序视频尚未获得。
- 性能探针已加入。后台IAB的rAF出现约270ms节流，本轮后台样本不能当作前台p95≤100ms达标证据；需要固定前台/CI环境验证，保留这一边界，不改阈值冒充达标。
- 单元570通过，类型/限定设计lint通过；本地浏览器由CUA操作。Playwright测试将在CI执行，不把编写完脚本当运行通过。

## 发布前状态
- 前台真实采样：24次反馈p95=38.3ms；16个拖动样本p95=22.6ms；屏幕帧间隔p95=16.8ms。证据performance.json。后台节流样本排除并保留前述原因，不混算。
- 十张明确审阅的设置视觉基线已纳入tests/browser/__screenshots__，CI截图比较不自动更新。CI固定Ubuntu24.04、Playwright1.65.1及Noto字体依赖；跨环境像素容差仍须CI首次实际运行验证。
- CI运行43823799634未启动任何step：GitHub账户付款失败或额度不足（ci-blocked.json）。不改账户计费，不宣称CI通过。现有私有仓库套餐也不支持rulesets；不能保证有仓库/主机写权限的人不能绕过检查。
- 标准发布入口scripts/deploy-verified-web.py要求验证receipt，核对源码/当前资产，维护排空、备份SQLite及旧web、保留旧资产、失败恢复，最终核对原公网入口和配置表。
- 未完成外部/扩展验收：CI实际执行及跨环境像素基线；完整工作流程录屏；真实iframe跨越、操作系统级pointercancel/blur故障注入（有capture/blur共享代码约束及已有基本拖动证据）。本轮不将这些标为已测试。

## 上线及收尾（2026-11-16）
- 产品提交5bb4872cccb643b01e7955169306de88b39f11ca已推送并发布；原地址https://integration-love-angela-heated.trycloudflare.com/保持不变。公网release-manifest.json与当前入口JS/CSS哈希核对通过，ready=true。
- 标准发布脚本实际执行成功。备份位于生产.data/backups/2026-11-16-ui12-5bb4872cccb6；七张会话/配置表在发布前后完全一致，服务端文件哈希未变，未重启Cloudflare隧道。deployment.json保存结果。
- 线上浏览器：Sentry/Slack/GitHub/cloudwalker以及newbot_test/hids均在连接器目录，技能、专家仍为平行设置项。cloudwalker详情及“获取服务器证书”按钮可见；本轮未重跑真实CloudWalker工具/OAuth，不以仅可见入口声称其上游兼容性重新验收。
- 线上cloudwalker搜索→技能实际加载→连接器保留查询；原异步目录服务响应约数秒，本地UI输入反馈与上游时延分开看待。
- 新建UI12验收会话，真实模型回答“设置与聊天连接正常”；发送立即显示提交消息，随后完成并生成与验收上下文相关的追问。截图live-chat.png、live-settings.png，摘要live-browser.json。该会话是发布后有意新建，不能与部署时“表未变化”混为一谈。
- 已尝试完整交互录屏：CUA的Page.screencastFrame捕获被IAB宿主裁为437×570，尽管DOM及Page.captureScreenshot为1280×844。setVisibleSize也不能纠正，不能把裁切录屏作为完整流程证据；原帧暂存/tmp/newbot-ui12-clipped-screencast，没有提交失真的视频。完整截图已经归档。
- 发布验收采用有证据的本地CUA结果，receipt明确标注localBrowserVerification=CUA及CI阻塞。未假装GitHub Actions已执行、未修改计费或仓库保护限制。完整CI、跨环境像素比较、完整录屏和系统级取消/真实iframe交叉仍是明确待验收项。

问题→共同原因→修复→证据：
1. 顶栏不齐→分散绝对定位/尺寸→单一settings.css与共享header→matrix.json、live-settings.png。
2. 往返丢状态→组件生命周期和异步列表容量→应用内目录状态/等待容量恢复/用户介入取消→状态测试、625px实测、live-browser.json。
3. 插件入口混淆→与历史同层并重复分类→移入设置八个平行分类，删除独立入口→截图及ESLint/布局所有权检查。
4. 两侧调宽不一致→只有右栏独立处理且缺收尾→共享PanelResizer/尺寸预算/capture+RAF+blur→尺寸测试、拖拽及重载实测、performance.json。
5. 跨断点焦点抢占→右栏响应式Dialog越过当前任务→任务覆盖层优先→本地只剩settings-dialog实测、浏览器回归用例。
6. 修复无法约束后续→检查不进入构建发布→限定lint、故障注入、浏览器/像素CI、receipt+manifest与标准部署入口→设计/发布拒绝测试、CI阻塞记录、真实部署manifest。
