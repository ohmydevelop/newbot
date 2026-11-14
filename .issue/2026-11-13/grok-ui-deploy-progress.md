# UI-20261113-DEPLOY 进度

- 已确认实际入口为原Cloudflare分享；本机3100与旧隧道已停止，原数据存在。
- 用户已授权实际部署及真实模型调用。当前默认百智-MQ/deepseek-flash，优先沿用。
- 以当前数据库9会话/31请求/2附件为基线，未使用旧分享清单过时计数。
- 计划见grok-ui-deploy-plan.md。尚未执行发布和真实模型调用。

## 完成记录

- 部署前私有备份：`.data/restart-backups/grok-ui-20261113T113118Z`，包含SQLite一致性备份（integrity=ok）、原dist、Codex home、环境和凭证主密钥。没有复制模拟夹具数据或个人Codex配置。
- `npm run build` 完成（包含tsc）；现有静态发布脚本保留一代旧资源。公网JS/CSS SHA256与当前dist完全一致，见 `evidence-grok-ui-deploy/deployment-checks.json`。
- 实际服务由用户systemd临时单元 `newbot-test.service` 管理，Node26.12.0，回环3100；原生Codex二进制仍为原.env中的fe2f185-capabilities版本。两条隧道由 `newbot-share-web.service`、`newbot-share-apps.service` 管理；未操作其他应用隧道。
- 新主入口：https://wines-metric-switches-under.trycloudflare.com 。独立Apps origin：https://ordinary-tucson-offered-spiritual.trycloudflare.com 。已更新.env精确Origin及.data/public-share.json；旧Quick Tunnel域名无法复用。
- 公网匿名能力接口401，认证后200，Apps域主能力接口403；原密码登录成功。原9会话/31请求/2附件在部署时完整保留，Provider内容、密码摘要、主密钥、实例config及个人config摘要未变。
- 真实公网浏览器发出一次无工具合成请求，使用现有百智-MQ / deepseek-flash。收到“37 乘以 19 等于 703。NEWBOT-LIVE-1113”。后台确认1请求、1Turn、1用户消息，状态completed，无工具调用。详见 `real-model-result.json`、`real-model-reply.png`。
- 进入空闲维护状态成功后重启实际服务：PID135068→181703，readiness恢复；原登录Session有效，Provider从SQLite恢复，测试Turn/items完全一致，原会话行与密钥/密码均不变。当前10会话/32请求/2附件。见 `restart-checks.json`。
- 公网浏览器刷新并经历服务重启后仍展示同一测试回答和“Codex已连接”；1440px页面无横向溢出。截图 `real-model-restored.png`，DOM证据 `browser-restored.json`。临时浏览器尺寸已恢复。
- 验收完成，最终git diff --check通过。测试对话保留供用户核对。没有修改产品源码、默认模型或凭证；本轮是上一轮界面改动的实际实例发布。

## 明确边界

- 本次证明当前deepseek-flash真实文本路径、单次执行、刷新与重启恢复；未穷举其他模型、MCP、产物和审批流程。
- 原服务停止前有一项持久化running状态，启动后按既有恢复机制显示unknown/“状态待确认”；本轮没有继续执行或重新发送旧任务，不把它声明为已完成。
- 仍是Cloudflare Quick Tunnel临时分享与用户systemd临时单元，主机重启不保证自动恢复，隧道重建可能换域名；不是Named Tunnel固定域名或完整生产验收。
