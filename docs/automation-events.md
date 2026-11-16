# 自动任务：持续会话与事件接入

同一任务默认续用专属会话，保留前次上下文。每次运行仍有独立请求、轮次、状态、取消和通知记录。旧任务在下一次读取时选取最近一个未归档的历史会话；原有历史记录保持原地址，不合并或删除。归档任务会话会暂停任务，恢复任务重新启用同一会话。任务配置决定模型、模式、专家、技能及权限；在任务会话追问时，下一次自动运行会重新应用任务配置。需要完全独立的上下文时，请建立不同任务。

## 添加事件

新建或编辑任务 → 添加触发器 → Webhook / GitHub / Hermes / OpenClaw → 条件 → 保存。概览中的“连接设置”提供独立接收地址与密钥。保存任务并不自动配置外部服务。事件可以与时间触发组合；同一任务最多排队32次，逐次执行。Cookie登录只用于管理，事件入口使用自己的认证。

|来源|认证与事件标识|支持范围|
|---|---|---|
|Webhook|Standard Webhooks：`webhook-id`、`webhook-timestamp`、`webhook-signature`；签名内容`id.timestamp.rawBody`，`v1,<base64 HMAC-SHA256>`；UI密钥是base64编码的随机字节|通用JSON事件，时间窗口±5分钟，稳定ID重试去重|
|GitHub|`X-Hub-Signature-256: sha256=<HMAC-SHA256(rawBody)>`、`X-GitHub-Delivery`、`X-GitHub-Event`|仓库/事件/动作过滤；ping仅校验，不运行；issue、PR、push基础正文|
|Hermes|`X-Webhook-Timestamp`、`X-Webhook-Signature-V2: <HMAC-SHA256(timestamp.rawBody)>`；密钥按UI字符串使用|Hermes V2发送格式；时间窗口±5分钟，同一签名正文去重；不是完整Hermes路由服务|
|OpenClaw|`Authorization: Bearer <token>`或`x-openclaw-token`；必须有`Idempotency-Key`|`message`、`name`、`event_type`、`deliver:false`；目的会话、权限与模型只能在Newbot任务中配置|

GitHub与Hermes的密钥按显示字符串使用；Standard Webhooks将base64密钥解码后使用。路径与响应为Newbot约定，不伪装成对方完整Gateway API。Hermes V1不接受。OpenClaw路由、模型、外发渠道等额外字段明确拒绝，避免静默丢弃行为。

`202`表示可靠接收并排队；重复投递`200`返回同一runId；不匹配条件`200 ignored`；暂停返回409；队列/速率满返回429。请求体上限64KB，进入模型的正文上限20000字符，单入口每分钟60请求。密钥轮换后旧密钥失效。外部内容只作为数据，不改变工具与主机权限。

接收地址需要稳定HTTPS域名；临时Cloudflare入口变化后，要更新发送端URL。Gmail/Outlook可通过已部署的中转器投递，但本版尚未自动建立邮箱订阅/续期或提供完整的Hermes/OpenClaw渠道运行时。

## 可复用发送适配器

`scripts/send-automation-event.mjs`既可CLI使用，也可从插件导入`eventHeaders`生成协议请求头。密钥仅从环境变量读取，脚本不打印。创建JSON文件后：

```bash
read -rs NEWBOT_EVENT_SECRET
export NEWBOT_EVENT_SECRET
node scripts/send-automation-event.mjs 'https://newbot.example/api/automation-hooks/TASK/TRIGGER' openclaw event.json delivery-001
unset NEWBOT_EVENT_SECRET
```

OpenClaw示例正文：`{"message":"CI 构建完成，请检查结果","name":"CI","deliver":false}`。Hermes/通用来源可使用`{"event_type":"build.finished","message":"CI 构建完成"}`。

适配现有插件时，只在外部事件到达后调用投递端，稳定事件ID透传；不要复制Newbot登录密码，不从事件中派生权限，不把收件密钥放入模型提示词。使用Hermes V2时，重试复用同一时间戳/正文；若业务需要超过5分钟重投，请使用Standard Webhooks并保持同一事件ID、重新签时间戳。

## OpenClaw / Hermes 生态迁移

沿用设置中的技能导入，支持目录、ZIP及GitHub链接。标准SKILL.md已有兼容路径；新增识别`openclaw.plugin.json`与`plugin.yaml`/`plugin.yml`，按生态包显示可移植技能和限制。OpenClaw只选其声明的skills路径；Hermes发现包内SKILL.md。资源文件与技能一并保留，导入前逐项选择。

这是技能与事件协议层兼容，不是对方运行时代码的仿真。JS/Python原生tools、hooks、provider、channels及依赖安装不会执行；只有代码、没有SKILL.md的插件会阻止导入并说明原因。技能依赖的外部工具、操作系统、API及配置仍需核对。若要移植原生工具，应由插件作者通过MCP暴露能力，然后使用现有连接器配置/OAuth/证书/权限机制；不要把代码入口重命名冒充Codex插件。

## 调研版本与官方来源

- [OpenClaw会话目标](https://docs.openclaw.ai/automation/cron-jobs/payloads)、[入站Webhook](https://docs.openclaw.ai/automation/cron-jobs/webhooks)、[插件清单](https://docs.openclaw.ai/plugins/manifest)：源码48cd549b1c48653061ec312e35fef62d13df62cf。
- [Hermes定时任务](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron)、[Webhook](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/webhooks)、[插件开发](https://hermes-agent.nousresearch.com/docs/developer-guide/plugins)：源码081e8d9b75b2bedae297a89232b04ef9be7b26a0。

官方格式与本版支持范围分别列出；静态调研、协议发送器测试不能代表完整外部服务运行时认证。
