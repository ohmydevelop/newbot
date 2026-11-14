# GCF-4 进度与证据

- 已保存原始截图，已读取主要状态与持久化链路，计划先于本轮产品修改。
- Grok 当前可读取已有 hello 对话：Worked for 1s 折叠按钮，展开直接出现 Thought/回复用户的问候。工具执行/运行中/异常参考尚未可观察，未向 Grok 发送任何消息。
- 当前缺口：历史技能名称兼容、提交即时反馈、统一能力行、侧栏完整管理、过程二次折叠、手机验证及部署待完成。

- 发送状态浏览器证据：接口延迟 4.5 秒，点击后 177ms 的快照已有气泡/提交态；服务确认后只有一条真实消息。运行中停止按钮可用，停止后显示“你已停止本次回答”。
- 同机制补充（有代码证据）：停止的轮次可能保留尚未收到结束事件的工具项；按轮次已结束边界停止其动画并标“未完成”，避免停止后仍看似执行。等待审批的活动轮次独立保留真实状态。
- 同机制补充：刷新后 pending 预览恢复；明确拒绝/放弃后恢复预览的消息和文件，仅写入未触碰草稿，不覆盖后续编辑。
- 4.5秒后原生调用抛错属于结果未知而非已拒绝；浏览器准确保留待确认、不重复执行，刷新后仍保留，切新聊天不会串入。该截图标注 unknown，不作为确定失败证据。
- 手机添加选择器关闭问题已复现并修复：Dialog 的焦点恢复完成后才打开下一选择器；手机已成功新增并移除技能，名称与计数同步。

## 候选验证
- 全量528项：527通过、1跳过、0失败（full-tests.txt）；随后增加停止边界用例，16项针对性恢复/过程测试全通过（final-boundary-tests.txt）。类型检查通过。
- 390×844手机、1280×720及1440×900桌面：无document横向溢出；已发送聊天内能力标签数=0；输入框高度106px。首轮一行显示并可“+N”展开；侧栏完整显示专家/插件/技能，添加和移除成功；手机Dialog与选择器交接成功。
- 未知请求刷新后保留占位；切换新聊天不串线。隔离fixture数据库将已知未执行的模拟unknown设为rejected，页面状态轮询后移除占位，回到原会话恢复“测试发送失败”原文。此为模拟拒绝边界证据，不是真实上游拒绝。
- 停止按钮实际点击后显示“你已停止本次回答”。最初fixture定时器随后仍产出合成回复，已给fixture补终态检查；该次只作为即时停止反馈证据，持久停止由既有native测试覆盖，不将fixture计时器表现归为真实服务。
- 已核对最终截图有效：final-desktop.png（1440×900）、final-mobile-chat.png和final-mobile-rail.png（390×844）。Grok实拍完整参考grok-process-expanded.png；早期未显式clip的desktop-draft/desktop-submitting/desktop-process截图被宿主裁切，不作为视觉验收。
- UI沿用DESIGN.md与.impeccable/design.json的既定Grok方向、字体/色值/间距token，未改变系统级设计承诺，因此本轮保留这两个设计文件。

## 独立审查修正
- fresh full reviewer disposition=fix，唯一material finding为P2：跨会话待确认入口fixed定位覆盖手机标题。
- 已把当前请求提示、跨会话恢复入口放入main/header下正常流，并将错误/后台通知同样改为正常流，避免它们在恢复提示上再次叠盖；限制最大高度，保留横向滚动及全部恢复操作。
- 复验安排：320px、390px、1440px，两个未知请求与长标题当前运行同时存在；另检查当前未知提示。证据 review-fix-*.png。
- 审查修正复验：320与390的header.bottom=60，notice.top=60，无document横向溢出。review-fix-running-320.png为真实运行中的模拟轮次（停止方块可见）；390与desktop抓图时模拟轮次已完成，正确记录完成态，仍保留两个跨会话未知入口及长标题；不把文件名当成运行证据。review-fix-current-320.png为当前未知+另一未知入口，完整可读。

## 部署与真实验收完成
- 最终自动化529项：528通过、1跳过、0失败（full-tests-final.txt），类型检查与生产完整构建通过（final-typecheck.txt / production-build.txt）；git diff --check通过。
- 独立fresh full review后唯一P2修正评分resolved，disposition=ship；初次完整审查及修正评分均保留。设计文档保留既有系统，无新设计文件覆盖。
- 备份 `.data/restart-backups/grok-chat-flow-20261113T124542Z`：原dist、初始SQLite，以及维护门禁成功后的quiescent.sqlite，integrity=ok。维护前14个会话、49个请求全部保留；Provider配置摘要不变。未打断活动任务。
- 服务 newbot-test.service 已重启，PID368171，ready=true。原分享地址 https://wines-metric-switches-under.trycloudflare.com 。HTML、入口JS及CSS公网哈希与dist一致（deployment.json）。没有变更现有分享权限。
- 实际旧数据2个技能缺名引用，经真实线程读取API恢复name/displayName，id/hash保持不变；原图根因不只是UI显示修补。新发送存完整引用，历史兼容不改变原技能版本或启用状态。
- 真实 deepseek-flash：独立测试thread `01a1d4f9-dc27-72e0-8a3f-7c7d8dfd1986`，一个主Turn、一个用户消息、无工具调用；点击289ms时已观察到本地气泡。最终completed，placeholder=0，inline capability labels=0，390px无页面溢出，composer108px。
- 本次真实主回答没有suggestions块；补充模型路径实际生成并缓存“推荐几款适合新手的合作桌游？ / 猜词破冰具体用什么玩法或词库？ / 新手跟不上节奏时该怎么调整？”。页面刷新后仍显示相同本轮追问，没有增加主Turn。证据real-model.json、live-mobile-complete.png；该部分是真实服务，和fixture明确分开。
- 浏览器先前tab4在临时视口下截图接口失败，未冒称截图成功；创建同服务结果页tab7后完成390×844完整截图并打开确认。没有把裁切失效的图用作交付。
- 测试服务3149已停止；实际3100继续运行。未提交git，保留既有未提交改动。

## 验收结论与限制
GCF-4计划中的实现完成，已部署实际入口。能力保存/展示、即时提交、恢复与切换、过程披露、工具终态及相关追问不变量都有相应代码/测试/浏览器证据。
参考Grok已有对话的布局、单入口思考披露与图标已直接观察；其运行工具、异常和完整A2UI状态未获可观察样本，因此不声称所有状态像素级1:1。A2UI/MCP现有交互输出边界保留、既有相关测试通过，本轮没有用真实工具执行高影响操作；凭据输入/真实工具停止/软键盘设备行为未做新的真实服务端到端验收。手机采用真实浏览器的响应式视口，不是实体手机录屏。
