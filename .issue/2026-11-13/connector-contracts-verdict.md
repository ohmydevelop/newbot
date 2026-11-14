# GCF-10 独立收尾复核

复核范围：只读源码、原始反馈及本轮截图、测试脚本与保存日志；未启动浏览器、未操作实际服务、未重新执行原生测试。主代理另外负责真实浏览器和部署验收。本记录不将主代理口头汇报等同于已落盘证据。

## 当前结论

布局证据通过；本复核提出的代码缺口均已修正，第三轮增量复核见文末，未发现新的阻断性问题。实际实例发布、GitHub历史空快照恢复以及最终浏览器完成反馈尚需补证据。不能把本轮称为真实 Slack 工作区授权验收完成。

## 发现与处理要求

1. **P2，有代码证据：旧缓存迁移仍能发布空包。** `server/plugins.ts` 的 `versionLegacy`（复核时60–64行）直接将 `importTree(source).files` 交给 prepare/publish。`server/import-files.ts` 的 importTree 会先创建不存在的目录，因此遗失的 prior.path 或空缓存仍可产生空快照。安装路径的新非空检查没有覆盖迁移入口；版本根内的历史空快照也在42行直接早退。违反“已安装代表有真实可执行包”的不变量。主代理已确认，拟将源目录存在性和非空检查提升为共享 helper，并为历史损坏记录提供明确修复入口；本复核尚未检查修复后的代码。
2. **有代码证据，OAuth用户流程待验证：完成事件只释放锁。** `server/bridge.ts` 的 OAuth 完成处理仅清除 oauthUntil；`server/ag-ui.ts` 在 notification 缺少 threadId 时直接返回；插件界面的授权URL和needsOAuth状态由局部state保存。浏览器授权成功或令牌兑换失败后，当前实现需要用户手动再次检查连接才更新状态；原生完成通知成功不证明界面已完成反馈。应补专用完成反馈/刷新，或明确提示返回后检查，并覆盖失败与重试。
3. **P3，有代码证据：证书大小限制单位不一致。** `ConnectorEditor.tsx` 接受32KiB文件并base64编码；`mcp-config.ts` 的 caCertificate 字符串上限32768使实际上传上限约24KiB。建议统一按解码后字节数校验，保留编码输入的单独合理上限。一般单证书小于此阈值，不阻断常见证书路径。

## 原问题与同类机制检查

| 问题/机制 | 证据与结果 |
| --- | --- |
| 保存/检查错行，重复可选 | 已查看 feedback-configuration.jpg 与 configuration-dirty-mobile.png；新图同一动作组无溢出，“可选”一次；源码脏草稿禁用检查并使既有结果失效。 |
| 状态位置与未安装误称已添加 | ToolsSettings未安装声明工具改为“安装后可配置”；共享connection-state字典；PluginComponents源码结果位于标题下。slack-mobile.png仍为文案精简前画面，不能充当最终状态布局证据。 |
| 官方Slack安装/配置 | native-slack-isolation.txt证明原生隔离安装成功；安装目录解析不再直接将显示版本当缓存路径。主代理报告完整应用安装+详情+配置+needsOAuth已过，但应补对应应用证据。迁移缺口见发现1。 |
| 普通MCP证书手机布局 | certificate-mobile-390.png及320.png均完整，按钮、说明和底部动作无横向溢出。 |
| CA作用域 | 原生patch按精确origin选择显式CA客户端；其他origin用默认客户端，显式CA客户端停止自动重定向；未发现关闭证书验证的实现。URL origin变化时前后端均有清除路径，上传异步读取有generation防迟到结果。 |
| 原生TLS/OAuth | native-tls-oauth.json记录13项；脚本确实使用真实Codex与合成HTTPS/OAuth上游。覆盖工具发现/调用、未配CA不继承、主机名拒绝、state/PKCE、拒绝后重试、完成通知、凭证重启恢复。 |
| 测试边界 | JSON refreshes=0，未证明真实刷新令牌；脚本未覆盖实际过期服务证书、错误CA、跨origin重定向；动态注册不等于Slack固定Client ID/应用白名单兼容。无真实Slack账号授权和远端消息操作证据，不能标完成。 |
| 全测 | full-tests.log显示543通过、0失败、1跳过；这不替代最终浏览器、实际实例发布和外部服务授权证据。 |

## 收尾顺序

共享安装源检查及损坏记录修复入口 → 针对迁移/安装边界验证 → 最终状态布局截图 → 更新计划、进度与DESIGN → 备份部署实际实例 → 同版本恢复GitHub并记录前后包内容/详情证据。OAuth用户流程和证书大小按上述发现处理或明确记录未解决范围。真实Slack授权须保持待用户工作区实测边界。

## 第二轮增量复核

初次三项的修正已只读核对：

- `installedPluginTree` 在importTree前检查存在性、目录及链接，随后拒绝空树；安装与versionLegacy共同调用。历史已生成空快照通过空树digest识别，目录显示“需要修复”，更多菜单提供“重新安装”，详情错误指向恢复入口。原P2的共享检查缺口已关闭；实际GitHub恢复仍待发布后的证据。
- `mcpCertificate`与mcpSave编码输入上限为43692；解码和规范化仍保持32KiB限制。新增超过24KiB、未超过32KiB的PEM填充样例验证通过。原P3关闭。
- `AgentEvents` 在threadId过滤前发布仅含name/loginId/success的全局安全事件；store转发并刷新MCP，两个入口使用共享hook精确匹配连接器和loginId，清除已消费URL，插件成功时重新检查，失败时显示重试文案。原“完成事件未达界面”代码缺口已关闭；真实浏览器完成反馈尚待主代理测试。`oauth-completion-tests.log` 为18通过，覆盖安全转发和旧/不同attempt不匹配，但不等于完整浏览器验证。

本轮新增一项**有代码证据的OAuth维护锁时序边界**：bridge在新登录请求设置oauthUntil后，需等待native response才覆盖oauthLoginId。旧尝试超时后开始新尝试，旧loginId仍保留；旧completion在此await窗口到达，会匹配旧ID并清除新请求的锁。首个请求pending时`!oauthLoginId`同样接受未知completion。应给新请求建立pending状态，未知ID期间不释放锁，必要时暂存completion并在response返回loginId后精确匹配；offline时同时清ID。本复核未运行并发复现，不把此时序判断写为已复现。已向主代理反馈，等待后续修正或明确保留。

## 第三轮最终代码复核

- **OAuth待响应窗口修正通过。** 新尝试先清旧ID、设pending并递增generation；pending阶段有ID的完成只缓冲，不释放锁；response返回后以该loginId检查早到事件。offline清锁、ID、pending、缓冲并递增generation，旧response无法覆盖新状态。`tests/mcp-config.test.ts` 延迟native响应的回归在pending期间和response之后分别注入旧completion，均证明配置仍被锁定；仅当前completion释放。第二轮时序缺口关闭。
- **实际事件入口修正通过。** `server/index.ts` 在会话ownership过滤之前仅将两种OAuth完成通知交由AgentEvents安全投影，其他事件仍保持原过滤。createServer级回归覆盖null和内部discovery thread，并证明上游原始诊断不外泄；比仅测试AgentEvents更完整。oauth-completion-tests.log现为19通过。
- **早到结果与旧结果覆盖修正通过。** store按loginId保留最多32项，hook按当前attempt取结果并再检查连接器名与ID；旧completion不再覆盖先到的当前结果。此结论来自代码追踪，未在本复核单独执行浏览器并发实验。
- **目录文件名兼容修正通过。** 生成目录恢复原生要求的`.agents/plugins/marketplace.json`，内容使用非保留的快照商店身份；临时文件+rename只替换包外生成描述，未改不可变package内容。只有插件只读详情调用此catalog入口。主代理报告隔离Slack read已恢复，应保留其原生验收记录。
- final-targeted.log显示35通过、0失败。本复核未重复运行已有测试，也未操作浏览器和生产实例。

最终代码意见：本次已发现问题可以关闭，未发现新增阻断性缺陷；允许继续主代理既定的最终浏览器、备份部署及GitHub恢复验收。FINISH整体仍须以实际发布、恢复前后证据和最终UI结果收尾。测试模拟OAuth事件只证明界面事件处理；真实Slack账号授权、刷新令牌和未覆盖TLS失败条件的边界仍按上文保留。

## 主代理交付证据补记（不是新增独立复核）
2026-11-14：部署与数据保留见deployment.json；实际GitHub同版本空包恢复和Slack安装见live-plugin-recovery.json；线上390px配置见live-cloudwalker-mobile.png、live-slack-mobile.png；真实模型验收见live-model.json。全测最终545通过/1跳过。浏览器OAuth拒绝与native受控OAuth协议证据已补，真实Slack账号授权仍未完成。部署过程中transient单元失效及持久单元恢复见进度，不隐去失败过程。
