# AUTO-7D 实施与验收结果

2026-11-17。工作树：`/home/a/Documents/ChatGPT/newbot-systematize`，分支 `codex/newbot-systematize`。本轮实现与本地验收完成；尚未提交、推送或部署。生产入口未切换。

## 已完成机制

已安装插件通过 `newbot-events.json` 贡献声明式事件来源，服务端按包摘要与启用状态校验，适配器仅来自宿主允许列表。新增 GitHub Issue/PR 事件拉取适配器与可导入示例；支持关闭、重开、标签和指派变更，不宣称覆盖完整 GitHub Webhook。首次拉取建立基线，不触发历史消息。

AUTO-7C 的 contracts/engine 提取至 server/event-subscriptions，实验引用同一核心。服务端按账号、资源共享出站拉取，沿用持久游标、收件箱、目标快照、租约和迟到响应隔离。事件进入现有任务队列；一个任务多次运行保留同一会话。

账号通过现有 vault 加密，单独授权，不复用 MCP 或模型令牌；主库升级至 v21，旧任务内容保留。账号 CAS 修订与凭证身份分离，改名保留游标。删除账号、插件停用/卸载/摘要变化会停止相关任务；恢复和重启都重新校验依赖。

UI 复用既有触发器菜单和就近 Popover，新增来源→账号→仓库→事件选择、订阅状态与重试。保持原字体、配色、控件和动效；补齐账号名称、访问令牌、仓库的短标签，窄屏来源摘要单行省略。

## 问题—机制—验收追踪

|编号|关联路径和结果|证据|
|---|---|---|
|D1|插件摘要、注册代际、卸载、重装、迟到响应均拒绝过期绑定；无声明的插件不贡献来源|tests.txt 中 service/engine 检查|
|D2|加密存储、CAS 冲突、未认证 API、摘要变化；账号改名不丢游标，凭证绑定变化隔离|tests.txt；未验证实际私有 GitHub 凭证|
|D3|保存、暂停、删除、修改、恢复、重启及同会话连续执行；修复 resume 缺少依赖校验|tests.txt、lab.json|
|D4|提取后共享核心回归；提交后 ack 前进程退出、丢失回执、重复事件、租约、目标 FIFO 和容量阻断|tests.txt、lab.json|
|D5|旧 Webhook 与时间任务回归；v20→v21 不重写旧任务；订阅不创建 Webhook secret|tests.txt、legacy-browser.txt|
|D6|320/390/1280 深浅色动态来源、账号、条件、状态、运行入口、焦点及无横向溢出；独立视觉复核通过|browser-final.txt、browser.json、设计评审记录、18 张截图|
|D7|模拟分页、权限、限流与缺口边界；真实公共 GitHub API 只读基线和增量请求成功|tests.txt、github-public.json|
|D8|原生 Codex 二进制/协议版本不匹配已复现，完整原生链路及发布受阻|runtime-compatibility.json|

## 验证汇总

证据目录：`evidence-subscriptions-integration/`。

- 41/41 针对性测试通过，含旧自动任务/事件回归、数据库迁移与重启恢复：`tests.txt`。
- 新订阅浏览器 6/6、旧事件浏览器 6/6 通过：`browser-final.txt`、`legacy-browser.txt`。浏览器使用本地 GitHub 替身和 FakeCodex，不代表真实模型执行。
- `npm run check`、`npm run lint:ui`、`npm run build` 通过：`typecheck.txt`、`lint.txt`、`build.txt`。构建保留现有大 chunk 警告。
- 提取后的出站实验再次通过：`lab.json`。真实 loopback HTTP 与子进程崩溃恢复，两个任务四次运行保持各自固定会话；消费者未监听端口。未配置物理防火墙。
- 真实公开 `microsoft/vscode` API 两次只读请求成功、游标有效，两次都未产生新增事件。没有向真实仓库写入或触发任务，不是 OAuth/私有仓库/真实端到端执行证据。
- 示例包：`github-events.zip`；源码：`examples/github-events/`。当前原生导入全流程未验证；临时匹配协议下扫描识别成功，但该诊断协议未保留。
- 独立设计评审范围内 verdict 为 ship，详见 `001-plugin-event-sources-design-review.md`。这是 UI 范围结论，不是部署批准或真实外部服务兼容性结论。

## 未完成与下一阶段条件

1. 运行时版本匹配：仓库生成协议标记 0.0.0，安装 CLI 0.165.0，当前启动失败。临时生成会改变约 90 个协议文件并删除现用接口，已完整撤回；不能只改版本常量绕过检查。需要找到与保留接口相配的 Codex 构建或规划有测试的协议迁移后，再做原生安装→真实任务→上线验收。
2. Gmail OAuth/watch、GitHub OAuth/私有仓库、GitHub Enterprise/私有 CA/代理、云端中继和任意第三方适配器未实现或未验证，不显示为可用能力。
3. 订阅存储上限每来源 100000 条，达到后明确阻断；长期回收策略未做。插件包完整摘要检查尚未做大型包性能基准；不宣称吞吐指标。分页交付不保证全局上游时间顺序。
4. 手机是浏览器尺寸模拟，无真机。截图和现有交互测试不等于软键盘、滚动手势、全部动效实机验收；账号表单错误/删除确认/重试状态未全部做视觉截图。

本轮完成的是第一正式事件来源的实现及上述受控验收。完整生产集成仍有明确外部与运行时条件，不标记整体自动任务生态完成。
