# SHARE-20261114 恢复记录

2026-11-14 09:40 CST：恢复完成。

问题 → 原主站与MCP Apps临时域名均NXDOMAIN，本地服务200。
根因边界 → cloudflared进程存活但自00:29:39Z后失去边缘连接，持续TLS EOF/重置/超时；临时域名随后已无DNS记录。无法证明具体上游撤销原因，未改路由器/系统网络。
修复 → 对两条失效隧道执行重启；SIGTERM等待时未退出，结束旧隧道进程后新隧道自动启动，两者01:39:20Z/21Z注册成功。确认maintenance无活动请求后同步PUBLIC_ORIGIN/APP_ORIGIN并重启newbot，解除maintenance。

- 新主站：https://renewal-disciplines-fabric-mortality.trycloudflare.com
- 新MCP Apps：https://transit-catering-bay-willow.trycloudflare.com
- .data/public-share.json已同步URL、进程与验证时间。
- 备份：.data/restart-backups/share-recovery-20261114T013926Z，包含.env、旧分享记录和SQLite。

验收：公开HTML及两个JS/CSS资源与部署逐字节一致；公开ready=200且runtime ready；配置接口未登录401、已登录200；独立Apps根路径403保持隔离；threads/runs/provider_configuration/extension_configuration/plugin_connection_settings/experts/session_extensions与备份完全相同。浏览器已加载新的登录页。证据share-recovery-20261114-evidence.json。

浏览器补充验收：使用原密码登录新地址成功，工作台及历史聊天已显示；截图share-recovery-20261114.png。没有发送新聊天或调用模型。

限制：Quick Tunnel仍是临时地址，无法保证永久有效；旧地址不能通过本地修改恢复。固定地址需用户的域名/Cloudflare配置，未擅自创建账户或购买服务。MCP Apps此轮验证隧道与隔离边界，未执行新的插件工具调用。
