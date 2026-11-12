# 生产部署与验收预案

当前是开发功能冻结候选版，本手册中的运维入口和命令留待 R1 在目标环境实际验收；不是已发布稳定版的验收证明。最新功能、测试及依赖风险见 [冻结记录](feature-freeze.md)。

本轮交付的是稳定版所需代码与运维入口，生产上线需完成下列真实环境验收。部署只面向可信项目；单账号可开多个浏览器会话，默认最多同时执行两个 Turn。一个 Node 服务管理一个 Codex 子进程，MCP 服务器可另起子进程。单容器不提供不可信代码的强隔离。

## 新建生产实例

准备专用 Linux 服务器、Docker Compose、两个自有域名、Cloudflare Named Tunnel 和实际 Provider 凭证。代码固定在 `/srv/newbot/source`；数据使用新的 `/srv/newbot/data`，不要复制测试 `.data`、个人 `~/.codex`、旧密码或旧登录会话。下面命令均在仓库根目录执行。

```bash
cp deploy/production.env.example deploy/production.env
chmod 600 deploy/production.env
# 编辑实际域名及 Provider 环境变量，不要把密码放入命令行。
node scripts/init-production.mjs /srv/newbot/data
cp deploy/codex.config.example.toml /srv/newbot/data/codex/config.toml
chmod 600 /srv/newbot/data/codex/config.toml
# 删除未配置的 secondary，或填入并验证它；容器 UID/GID 为 1000。
docker compose --env-file deploy/production.env -f deploy/compose.production.yaml up -d --build
```

首次随机密码在新数据目录的 `initial-password`，仅本机可读。也可在 `production.env` 指定新的 `ADMIN_PASSWORD`（至少 12 字符）；修改该值并重启会吊销所有旧登录。保持同一个密码重启不吊销会话。不要把测试环境密码当作生产密码。

Codex 使用 `/data/codex`。需要登录时，在专用容器中执行 `codex login --device-auth`，或配置服务端 Provider 凭证。Web 不接收、保存或下发 Provider API Key。镜像中的 Codex 固定为 0.166.0，生成类型与它一致。

```bash
docker compose --env-file deploy/production.env -f deploy/compose.production.yaml exec newbot codex login --device-auth
curl --fail http://127.0.0.1:3100/api/ready
```

`/api/health` 只检查 Web 存活；`/api/ready` 检查 Codex 就绪且未处于维护/切换状态，失败返回 503。Docker 健康状态不会自动修复错误配置，需要检查服务端。应用容器默认只读、非 root、无额外 capability；可信项目可使用 workspace-write sandbox，需要在目标内核上验证沙箱实际可运行。

## 固定 Cloudflare 域名

使用宿主机的 cloudflared 服务，应用保持单容器。按 [Cloudflare 配置文件文档](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/local-management/configuration-file/) 创建 Named Tunnel；复制 `deploy/cloudflared.example.yaml` 到 `/etc/cloudflared/config.yml`，替换 UUID、凭证文件及两个域名，然后添加 DNS 路由。凭证文件仅宿主服务账号可读，不进应用镜像或 Web 数据卷。

```bash
cloudflared tunnel route dns YOUR_TUNNEL agent.example.com
cloudflared tunnel route dns YOUR_TUNNEL apps.agent.example.com
cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate
sudo cloudflared --config /etc/cloudflared/config.yml service install
sudo systemctl enable --now cloudflared
```

主域名提供登录和 API；Apps 域名仅转发 `/sandbox/*`，其他路径返回 404。生产固定使用 SSE；现有 Quick Tunnel 继续使用轮询，不改动测试分享地址。检查流式消息无长时间缓冲，Cookie 含 Secure/HttpOnly/SameSite=Strict，未登录访问 API 返回 401。不要在 cloudflared 或前置代理打开请求 URL 的详细日志，以免 OAuth code/state 被记录。

## Provider 与会话规则

模型列表按当前 Codex Provider 动态发现并分页读取。设置页可切换已配置的 Provider；只有任务、审批、应用调用及 OAuth 均空闲时允许切换。切换通过 Codex 原生配置写入 `model_provider`，停止旧子进程后再启动唯一新子进程，然后重新发现模型。可连接的失败会尝试用原生 API 回滚；若进程无法启动，保留离线状态，由管理员修复 `/data/codex/config.toml` 再重新连接，不能承诺离线时配置自动回滚。

同 Provider 的模型/推理选择在下一 Turn 生效。切换到其他 Provider 默认新建对话；继续旧对话时，按 Web 索引中保存的 Provider 切换并恢复，忽略其他 Provider 遗留的模型选择。单实例不能让两个 Provider 同时运行。Provider 有配置或能列出模型不等于工具循环已验证。

## 请求与断线恢复

客户端在 sessionStorage 仅保存请求 UUID 与内容哈希，不保存 Prompt。网络失败、刷新页面后会显示“检查发送状态”。服务端在调用 Codex 前持久化请求记录，并用原生 `clientUserMessageId` / `userMessage.clientId` 关联实际 Turn。相同 UUID 不同内容会被拒绝；已接受请求直接返回原 Turn；结果不明返回 409，禁止自动重跑。

`GET /api/agent/runs/:requestId` 在可用时查询原生历史，只有匹配到 clientId 才确认已经提交。未匹配不代表没有执行；查询最多检查最近 300 个 Turn。浏览器断线不发中断。Codex/Bridge 崩溃后任务可能中断，不能宣称继续执行；先检查历史与文件结果，再决定新任务。

## 数据与缓存

当前开发版本 SQLite `user_version=3` 保存请求、附件、产物和技能引用关系及原有 Web 数据；v1/v2 升级与技能引用说明见 [D2 使用记录](skills-usage.md)。旧附件元数据自动迁移。旧版未关联附件保留为 legacy，不自动删除，避免误删历史文件。新上传但未关联请求的附件超过 24 小时清理；有关联的附件即使会话归档也保留。原生消息图片通过受鉴权的 `/api/files/:id` 恢复。附件总额 512 MiB，单个 8 MiB，文本 200 KB。

热缓存保留最多 32 个会话并以 16 MiB 为清理目标，活跃会话保护不淘汰；每个会话缓存最近 30 个 Turn、每 Turn 最多 256 项，文本/命令输出为 256 KiB 窗口。完整历史以 Codex 为准。App 记录最多 64 条、TTL 一小时；HTML 文档最多 32 条、TTL 15 分钟；App 授权两分钟、一次性消费；事件重放 4 MiB/512 条；SSE 总计 20 条、每登录会话 5 条，慢客户端会断开后重新读取状态。

## MCP OAuth

`MCP_OAUTH_CALLBACK_PORT=1456` 与 `MCP_OAUTH_CALLBACK_URL=https://agent.example.com/oauth/mcp/callback` 同时配置。Bridge 将设置传给原生 Codex，并仅将该路径及服务端 callback ID 路径代理到固定 loopback 端口；不开放此端口到公网、不另建 OAuth 客户端，不转发 Cookie 或上游响应内容。回调不要求登录 Cookie，state/PKCE/issuer 由 Codex 校验。注册精确的回调地址；Server 单独配置的端口覆盖必须与代理一致。依据 [Codex MCP OAuth 文档](https://learn.chatgpt.com/docs/extend/mcp)。

该入口有本地回环代理测试，真实 OAuth Provider 仍需部署后验收。它不提供对模型不可见的私密密码输入；Credential Broker/sudo 私密通道仍属后续阶段。

## 日志、备份和恢复

结构化 HTTP 日志只含路由模板、方法、请求 ID、状态码和耗时；不记录原始 URL、query、body、Cookie、凭证或工具内容。运行时日志只记录状态。OTLP 未配置时不开启外部 Trace 导出。`GET /api/runtime/metrics` 需要登录，仅返回 Node 内存、缓存和任务计数。

宿主安装 restic，配置独立、加密的远程备份仓库并先 `restic init`。将仓库密码放在宿主 `/etc/newbot/restic-password`，权限 0600；备份环境文件 `/etc/newbot/backup.env` 示例：

```ini
RESTIC_REPOSITORY=sftp:backup-host:/backups/newbot
RESTIC_PASSWORD_FILE=/etc/newbot/restic-password
NEWBOT_DATA_DIR=/srv/newbot/data
NEWBOT_ENV_FILE=/srv/newbot/source/deploy/production.env
PUBLIC_ORIGIN=https://agent.example.com
# 改过 ADMIN_PASSWORD 且 initial-password 已移除时，另提供受保护的登录密码文件：
# OPS_PASSWORD_FILE=/etc/newbot/ops-password
```

安装 `deploy/systemd/newbot-backup.*` 到 `/etc/systemd/system/` 并启用 timer。备份先进入维护；有运行任务/授权时失败并告警，不擅自中断任务。空闲后短暂停止容器，备份整个专用数据目录（包含 SQLite、Codex Home、工作目录、附件）及受保护的 production.env（含部署配置与服务端凭证），保留 7 个每日及 4 个每周快照，最后启动容器。必须监控 timer 失败状态，并在可用窗口重试；该方案不保证每天都能打断忙碌任务取得快照。

```bash
node --env-file=/etc/newbot/backup.env scripts/backup.mjs
node --env-file=/etc/newbot/backup.env scripts/restore.mjs EXPLICIT_SNAPSHOT_ID /srv/newbot/rehearsal
```

恢复会包含敏感的 production.env，恢复后仍保持 0600；演练时改成新端口、本地 origin 与独立数据路径。恢复只允许空的新目录，先 `restic check`，再 `restore --verify`，不覆盖线上数据。restic 在目标下恢复原绝对路径的层级；找到其中的 `srv/newbot/data`，使用新端口和无公网 Tunnel 的独立实例启动。演练确认登录、会话、附件、MCP 配置及权限，再切换正式数据目录。不要只验证备份命令成功。

## CI、升级与回滚

仓库工作流检查 TypeScript、测试、构建、Docker 镜像及无模型凭证的原生 Codex 就绪。当前工作目录未初始化 Git，需推入 GitHub 仓库后才会运行 CI。

每次发布使用不可变镜像 tag/digest，保留上一个镜像与升级前的完整 restic 快照。升级前停止新任务、等待空闲并备份；修改 Codex 版本时运行 `npm run generate:codex`，提交生成类型，跑契约测试与 Provider 矩阵，再切镜像。新版本出现问题时停止容器，选择旧镜像并把匹配快照恢复到新数据目录再启动，禁止直接让旧代码写新 schema。容器离线重启不会自动续跑旧 Turn。

## 必须在真实环境完成的发布门槛

```bash
# 脚本从环境读取密码/密码文件，不把它们打印出来。
PUBLIC_ORIGIN=https://agent.example.com OPS_PASSWORD_FILE=/secure/password npm run test:provider -- openai secondary
SOAK_HOURS=24 OPS_PASSWORD_FILE=/secure/password npm run test:soak
# 独立采集整个容器（包含 Codex/MCP 子进程），不要只用 Node 指标。
docker stats --no-stream
```

Provider 脚本会发送真实 Prompt、执行只读 pwd，并检查工具结果、文本增量、推理参数、恢复历史和请求幂等性。它产出 `.data/provider-matrix.json`；至少两个 Provider 全部通过，人工项也完成后才算兼容矩阵验收。出现审批时在可信 Web 界面处理，脚本不会自动批准。

Soak 默认只采集运行状态，不额外消耗模型 Token；运行期间要进行真实聊天、关页重连、并行两个任务、MCP App 刷新以及新旧对话切换，记录时间与结果。产出 JSONL 和汇总 JSON。提前停止标记未完成，不冒充 24 小时结果。资源目标仍需全容器数据验证。

| 验收项                             | 当前状态                                            |
| ---------------------------------- | --------------------------------------------------- |
| 认证、幂等、附件、审批、并发边界   | 开发测试通过，当前数量见冻结记录                    |
| Provider 切换和旧会话恢复          | 契约测试通过；第二个真实 Provider 待验收            |
| Docker 与内核 sandbox              | 配置/CI 脚本已有；目标环境待运行                    |
| 固定双域名与 SSE                   | 模板已有；Quick Tunnel 已实测，固定域名待提供       |
| 原生审批、Skill 文字调用、图片理解 | 当前真实 Provider 已通过                            |
| 官方 MCP App                       | Vanilla JS 2.0.4 原版真实交互、主题、手机检查已通过 |
| MCP OAuth                          | 固定 loopback 代理契约通过；真实授权待账号/服务端   |
| 7+4 备份与恢复                     | 本地加密合成数据恢复通过；远程整机待验收            |
| 性能与长时运行                     | 本轮 90 秒峰值 123 MiB；24h/全容器/完整并发仍待验收 |

本轮官方 App、性能与升级资源处理的详细记录见 [第二轮记录](round2.md)。Linux/glibc 容器使用 MALLOC_ARENA_MAX=2；该调优未改变密码派生成本，实际内存仍需目标环境测量。
