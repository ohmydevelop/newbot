# SHARE-20261114 分享地址恢复

用户反馈：地址失效了。目标：恢复真实 newbot 外网入口，保留登录、会话、模型与插件配置。

触发：访问此前交付的 wines-metric-switches-under.trycloudflare.com。实际：TLS EOF；预期：可加载当前工作台。

不变量：分享入口及 PUBLIC_ORIGIN、独立 APP_ORIGIN 必须指向当前有效隧道；进程运行不等于外网可用。

证据/根因：本地3100返回200、newbot PID1040784仍运行；两条cloudflared均持续边缘TLS重置/超时。web日志00:29:39Z失去连接。Google DNS与Cloudflare DoH检查旧主站/应用域名，前者明确NXDOMAIN(Status3)，后者无A记录。已证实临时域名不再存在；边缘断线与域名清理的具体上游因果待确认。

关联风险：
- 已复现：MCP Apps独立隧道同样断线、旧域名NXDOMAIN，共用临时隧道机制，必须一起恢复。
- 有代码证据：docs/cloudflare-sharing.md规定精确双origin与poll；更换URL须同步配置，否则登录/应用隔离失效。
- 待验证：新隧道能否连接当前网络；若仍失败需保留本地服务并报告网络阻塞。
- 待验证：服务重启活动请求与配置恢复；使用现有maintenance和SQLite备份。
- 不适用：UI/模型实现修改，此轮仅修复运行入口；不修改主机/路由器网络、安全与凭据。

实施：先重启已失效的两条分享隧道，获取已连接新URL；备份.env与分享元数据、SQLite；确认无活动请求，maintenance后同步两origin并重启应用；核验公开HTML/资源、登录保护、认证接口与Apps origin隔离；更新分享记录和交付URL。

验收：双隧道注册成功；公开页面/资源与部署内容相同；认证接口正常、未认证仍受保护；数据/配置保留。失败不宣称完成。固定域名需要现有域名/账户配置，本轮不创建新账户或购买域名。

状态：已恢复并验收新入口；进度与证据见同目录share-recovery-20261114-progress.md。原地址已NXDOMAIN，交付新地址；临时地址长期有效性不在已验证范围。
