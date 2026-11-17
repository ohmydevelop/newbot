# 005：公网入口恢复结果

## 原因与处理

主站、应用域和事件中继的 cloudflared 日志均持续出现 `Unauthorized: Tunnel not found`。本机源站正常，原登录返回 200。systemd active 只说明进程仍在运行，不能说明远端隧道注册有效；之前提供旧地址时的核验不足。

重建三条临时隧道后均收到 Registered tunnel connection。同步源站 PUBLIC_ORIGIN、APP_ORIGIN，确认原生 OAuth 回调使用新主站。重启前检查 activeTurns、pendingApprovals、pendingForms、pendingPrivateInputs 全为 0，并取得维护锁。没有替换源站构建或修改登录密码。

新主站：https://reliance-inns-suggested-chicago.trycloudflare.com

新应用域：https://approve-palm-ing-clinton.trycloudflare.com

新事件中继：https://successful-way-cook-gamma.trycloudflare.com

配置备份保存在生产实例 `.data/public-recovery-20261117/`，不提交凭证。`.data/public-share.json` 原先仍保留更早一轮地址，也已更正当前地址、PID 和验证时间。

## 关联中继恢复

停止生产者后确认 outbox 为 0、checkpoint 无待确认 receipt、中继原消费者 cursor=3 与最新 seq=3 一致。保留 relay 数据库、密钥、route 和生产者 cursor，备份 checkpoint/outbox，再只迁移同通道新 origin 对应的绑定。通过正式账号保存 API 更新消费者；新订阅达到 ready 后才恢复生产者，随后完成一次真实 GitHub API 轮询（新增事件 0）。原消费者已追平后显式取消，避免遗留消费者阻止后续保留期清理。

任务仍使用会话 `01a1e82d-a351-75f1-9f02-227ee80befb0`，没有重跑历史任务。邮件配置没有旧 origin 引用。

## 验收

- 公网首页 200、/api/ready 200。
- 未登录主站 /api/threads 返回 401。
- 应用域 /api/login 返回 403，不暴露主站登录。
- 中继未授权 lease 返回 401。
- Playwright 真实公网 HTTPS，390px 视口输入原密码、登录成功、聊天输入框可用；截图已人工查看。
- 源站、两条网页隧道、中继、中继隧道、GitHub 出站桥 6 个服务均 active；该状态与上述 HTTP/浏览器验证分别记录。
- 原生 OAuth callback 参数确认使用新主站；未执行真实第三方 OAuth 登录。

机器可读证据：`evidence-public-entry-recovery/browser.json`、`http.json`。截图私有保存于生产实例 `.data/public-recovery-20261117/public-login.png`。

## 边界

本轮未触发额外模型调用，不能将事件来源 ready / 空轮询称为新的端到端模型验收。此前真实业务结果保持不变。远端为何删除临时注册尚未确定；恢复的是临时入口，仍没有固定域名或永久可用保证。

完成：当前入口恢复、配置同步、关联通道迁移与公网登录验收。未解决的长期条件：固定域名与命名 Tunnel；不在缺少账号/域名配置时擅自建立。
