# AUTO-7G 进度

完成证据核对、真实模型/插件/服务清单及只读GitHub查询，计划已落盘。生产默认模型凭证存在；开始实现通用出站桥及GitHub工作流来源。尚未宣称真实公网链路通过。

已实现并构建通用MCP出站桥，以及独立GitHub插件workflow.completed来源，38项相关回归与类型检查通过。两个不同MCP插件（信箱故障恢复、GitHub真实接入）复用同一forwarder，无平台供应商分支。

真实公网relay已启动，单独systemd服务/隧道，HTTPS未授权及producer/consumer越权请求均401。生产正式导入github-events1.1.0，建立relay账号及“Newbot CI 结果”任务，绑定原有百智-MQ/deepseek-flash，通知仅站内。通用forwarder使用实际安装包并按当前分支只读轮询GitHub。等待基线与本轮正常提交引发的真实完成事件，尚未记录模型验收成功。

第一条真实结果：产品提交0ec55cf触发GitHub Actions运行44030912421（真实结论failure）。插件通过公网中继传递，生产任务run bc047707-585d-4589-9dfb-7565d97bb57f succeeded，固定会话01a1e82d-a351-75f1-9f02-227ee80befb0。deepseek-flash返回真实运行链接、提交及失败结论，并正确说明为首次记录（first-result.json）。没有使用模型夹具。

公网重放原始已收到CloudEvent返回duplicate:true（replay.json）。随后重启relay与出站桥，保留数据库/密钥/游标。运行审查发现断线客户端重连缺口并修复为临时失败重建MCP进程，close幂等；相关2项测试再次通过，第一次failed forwarder记录是误将未过期租约二次领取预期为重复事件，已更正为ack后无新增事件，并以最终通过结果覆盖。原38项回归通过记录保留。
