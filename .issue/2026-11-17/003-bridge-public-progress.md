# AUTO-7G 进度

完成证据核对、真实模型/插件/服务清单及只读GitHub查询，计划已落盘。生产默认模型凭证存在；开始实现通用出站桥及GitHub工作流来源。尚未宣称真实公网链路通过。

已实现并构建通用MCP出站桥，以及独立GitHub插件workflow.completed来源，38项相关回归与类型检查通过。两个不同MCP插件（信箱故障恢复、GitHub真实接入）复用同一forwarder，无平台供应商分支。

真实公网relay已启动，单独systemd服务/隧道，HTTPS未授权及producer/consumer越权请求均401。生产正式导入github-events1.1.0，建立relay账号及“Newbot CI 结果”任务，绑定原有百智-MQ/deepseek-flash，通知仅站内。通用forwarder使用实际安装包并按当前分支只读轮询GitHub。等待基线与本轮正常提交引发的真实完成事件，尚未记录模型验收成功。

第一条真实结果：产品提交0ec55cf触发GitHub Actions运行44030912421（真实结论failure）。插件通过公网中继传递，生产任务run bc047707-585d-4589-9dfb-7565d97bb57f succeeded，固定会话01a1e82d-a351-75f1-9f02-227ee80befb0。deepseek-flash返回真实运行链接、提交及失败结论，并正确说明为首次记录（first-result.json）。没有使用模型夹具。

公网重放原始已收到CloudEvent返回duplicate:true（replay.json）。随后重启relay与出站桥，保留数据库/密钥/游标。运行审查发现断线客户端重连缺口并修复为临时失败重建MCP进程，close幂等；相关2项测试再次通过，第一次failed forwarder记录是误将未过期租约二次领取预期为重复事件，已更正为ack后无新增事件，并以最终通过结果覆盖。原38项回归通过记录保留。

## 完成结果

两条基线之后、本轮正常代码推送产生的真实GitHub完成事件均经公网relay触发生产自动任务：

|GitHub运行|提交|任务run|结果|
|---|---|---|---|
|44030912421|0ec55cf5|bc047707-585d-4589-9dfb-7565d97bb57f|succeeded|
|44031453555|02da5709|c55d9fb3-2fa5-4108-a2cf-13cc0c74b8aa|succeeded|

两次threadId均为 `01a1e82d-a351-75f1-9f02-227ee80befb0`。真实模型deepseek-flash第一次返回“首次记录”，第二次正确返回“对比本会话上一条记录：仍为失败”。业务CI的真实结论均为failure；链路的任务状态均为succeeded，不能混淆为CI测试通过。完整真实文本、上游URL、任务/会话关联见result.json。

G4故障验证：重放第一条原始事件返回duplicate:true，无第三次任务；relay和出站桥服务重启后第二条事件正常执行；随后只终止当前MCP子进程，主进程PID保持不变，下一次错误自动重连为新PID，继续poll events:0；没有重复任务，outbox已排空。见replay.json、reconnect.json。

G1/G2/G3/G4/G5通过。生产三个systemd服务active，持续监控当前分支，不依赖浏览器；任务和账号均保留供用户实际使用。G6明确限制：独立公网隧道确实可用，但仍是Quick Tunnel临时域名，非固定域名高可用部署。未配置固定域名/命名Tunnel凭证，因此不宣称该部分已完成。

公网浏览器390/1280已实际登录、进入“Newbot CI 结果”、查看2条完成记录并打开同一会话，确认真实GitHub链接和模型结果，无横向溢出（browser.json）。截图包含用户实例侧栏信息，保留在gitignored `.data/bridge-live/`，不提交到公共仓库。

操作与恢复文档已补到docs/event-bridge.md。凭证、路由密钥、Cookie、完整配置均未写入证据或Git；repo只保留公开业务事件和脱敏结果。此次无主应用Server重启、无WebUI样式改动、无生产数据库版本迁移。没有创建外发邮件、GitHub评论或虚构上游事件。后续正常推送也会继续触发这一任务。
