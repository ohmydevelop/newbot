# AUTO-7D 正式订阅接入第一阶段

用户授权继续 AUTO-7C。目标：已安装的事件插件在自动任务中贡献来源，配置账号/资源后由服务端主动拉取，继续原任务会话；不要求公网回调。现有时间与四类 Webhook 保持兼容。本阶段先支持 GitHub 仓库 Issue/PR 事件，Gmail OAuth/watch 与其他适配器留后续，不显示假可用入口。

## 证据、原因与边界
- C 阶段 33 项检查与进程中断实验通过，但代码仍在 examples，生产 source enum、eventRoutes.sync、UI AddSchedule 固定来源。
- pluginPackageDeclarations/importTree 与 extension_packages 已提供导入及摘要校验；extensionRuntime.pluginEnabled 提供启停。不能仅按插件名称猜测能力；读取明确的 newbot-events.json，适配器由宿主允许列表决定。
- MCP 凭证用途不同。新事件账号采用现有 vault 加密，按插件包摘要与来源绑定，不从 MCP/模型配置窃取令牌。
- GitHub 官方 GET /repos/{owner}/{repo}/issues/events 支持公共仓库匿名与私有仓库 Issues read；只承诺已实现的 closed/reopened/labeled/unlabeled/assigned/unassigned，不能宣称等于完整 Webhook。来源：https://docs.github.com/en/rest/issues/events 。

## 约定与同类检查
|编号|约定|状态与关联|
|---|---|---|
|D1|未安装/禁用/摘要改变的插件不得继续拉取或派发|有代码证据：当前缺注册机制；创建/更新/卸载/在途响应均纳入|
|D2|密钥与连接保存采用 CAS、加密和用途绑定|待验证：复用 vault；API/日志/任务内容不得包含令牌|
|D3|任务保存、暂停、修改、删除、恢复、重启有一致订阅目标|有代码证据：receiveEvent 有任务 revision；新 manager reconcile 及最终派发校验|
|D4|来源去重/持久游标与目标快照可靠|C 已验证；抽取共同模块而非复制；继续跑 C 回归|
|D5|旧 Webhook 密钥/URL/任务历史不变|待验证：subscription 类型不生成回调 secret；原协议测试必须通过|
|D6|插件→连接→资源→事件的界面复用现有控件|待验证：AutomationChoice/PickerContent；320/390/1280、深浅色、焦点返回与无溢出|
|D7|分页、限流、权限撤回与历史缺口不伪装成功|待验证：固定 API origin、不跟任意 Link URL；游标保留明确窗口，缺口阻断；模拟与真实 API 分开|

## 实施
1. 将 C 核心提取到 server/event-subscriptions，examples 继续引用；生产独立订阅存储避免更改旧来源 inbox 的主键，账号表做主 DB 版本迁移。持久去重容量明确阻断，不自动删记录重放。
2. installed package 摘要校验注册表、vault 账号 CRUD 与认证 API；manager 汇总同账号资源的任务目标，最终派发重新核对任务/账号/插件。服务关闭先终止订阅再关闭队列。
3. GitHub Issues Events 宿主适配器 + 可导入示例插件；公共 API 只读实测，私有账号授权待用户实际配置。初次建立基线，不回放历史。跨多页事件可先保存再派发，处理顺序不宣称与上游时间完全一致。
4. 新增 subscription 来源、动态来源选择、就近连接和条件 Popover。沿用 Grok 既有字体、间距、颜色、icon 与菜单，不新建通用设置大面板。
5. 针对性测试、原回归、类型/构建/lint、浏览器验收、进度和证据。具备证据后再决定发布；本阶段未实测的 OAuth 不标完成。

## 验收
导入插件→动态发现→加密保存账号→创建/更新任务→共享来源→收事件→固定会话；暂停/删账号/卸载与请求迟到无执行；重开数据恢复、重复事件不重复 run；旧时间/Webhook 回归；真实公开 GitHub baseline/delta 只读验证与模拟新事件分别记录。客户端不可选择任意网络地址或可执行适配器代码。私有 CA/代理、自托管 GitHub、Gmail、长期记录回收、云中继明确不在本阶段。

当前：实现及本地验收完成，未部署。实际 Codex 启动存在既有协议版本不匹配，完整原生运行链路仍待验证。逐项状态与证据见同目录 001-plugin-event-sources-integration-progress.md。

## 实施中补充的因果证据
- D3：resume 原路径不重新 validate，账号删除后恢复任务可能错误地重新启用。恢复入口现在重用保存入口的依赖校验；启动重整也检查账号与包绑定。
- D2/D3：账号显示名称修订不应改变授权身份。CAS revision 与凭证 generation 分离；改名保留游标，凭证或包绑定变化切换身份并建立新基线，旧目标最终派发校验拒绝迟到事件。
- D8（有代码与运行证据）：当前 generated/version.ts 为 codex-cli 0.0.0，安装 CLI 为 0.165.0，原生启动版本检查失败。临时重新生成协议会删除当前接口，不能仅绕过检查或直接降级；诊断生成内容已完整还原。此项阻断上线，单独解决运行时/协议配套，不扩大本次插件事件功能变更。
