# Minimal Agent / newbot

以 Codex App Server 为唯一 Agent 内核的私有 Web 客户端。React + Vite + Fastify；AG-UI 标准事件经 SSE 传送，用户操作使用 HTTP。没有自建 Agent Loop、模型网关或第二套 MCP 客户端。

当前交付为 **v2 架构的 0.2.0 开发功能冻结候选版**，不是白皮书全部验收项已完成的生产版本。实现范围与已知边界见 [实施记录](docs/architecture.md)，实测结果见 [验证记录](docs/validation.md)。生产部署、Named Tunnel、备份恢复与验收命令见 [稳定版手册](docs/production.md)。官方原版 App 与性能结果见 [第二轮记录](docs/round2.md)。

## 使用与当前范围

Provider 定义、默认模型及推理参数保存到 SQLite，启动自动恢复到内存，通过原生线程参数热更新；会话选择和历史保留。可选 NEWBOT_RUNTIME_CONFIG_URL 用于首次初始化或显式重新下发，成功后同样持久化。迁移与 API 用法见 [配置持久化与热更新](docs/provider-memory-config.md)。

D1–D7 功能开发已完成，保留 Codex 作为唯一 Agent 内核。支持聊天/历史/恢复、模型与 Provider/MCP 配置、Skills 显式选择、受控文件和 HTML/PDF 预览、MCP Apps、受限 A2UI、独立私密输入，以及桌面/手机的键盘和主题交互。

- [使用指南](docs/user-guide.md)：聊天、草稿、审批、文件、表单、私密输入与故障恢复。
- [能力与限制](docs/capability-matrix.md)：实例条件、开放范围与明确关闭项。
- [2026-11-09 用户反馈改进](.issue/2026-11-09/plan.md)：缩略图预览、模型网关、审批、插件与界面整理；[验证记录](.issue/2026-11-09/progress.md)。
- [第二轮设置体验改进](.issue/2026-11-09/plan-02.md)：直接填写 API Key、自动网关标识、统一工具/插件目录与技能条目；[验证记录](.issue/2026-11-09/progress-02.md)。
- [菜单与按钮打磨](.issue/2026-11-09/plan-03.md)：统一操作图标、危险分组、按钮与手机状态；[效果与证据](.issue/2026-11-09/progress-03.md)。
- [历史功能冻结记录](docs/feature-freeze.md)：302 项自动测试、150 项相关浏览器检查及发布前待办。
- [整体开发计划](docs/roadmap.md)：全部阶段和对应证据。

正式 Docker、固定双域名、两个真实 Provider、OAuth、24 小时并发及完整备份恢复统一留在 R1。生产依赖审计仍有 A2UI/旧 Zod 相关 2 项 high，现有资源限额为缓解措施；当前不是已完成生产验收的稳定发布。

## 本机运行

需要 Node.js 24+、Linux（可写 tmpfs 诊断目录），以及可用的 Codex 账号或 Provider。npm 安装固定的 Codex 0.165.0。

```bash
npm ci
npm run build
npm start
```

访问 <http://localhost:3100>。首次启动会生成随机登录密码，保存在 `.data/initial-password`，权限为 `0600`。也可以复制 `.env.example` 到 `.env`，设置至少 12 字符的 `ADMIN_PASSWORD`。不要提交 `.env`、`.data` 或 Codex 凭证。

开发模式：`npm run dev`，访问 <http://localhost:5173>。修改 `.env` 中的 `PUBLIC_ORIGIN` 为 `http://localhost:5173`；也可以不设此项，开发默认允许 3100/5173 的 localhost 和 127.0.0.1。

默认使用 `DATA_DIR/codex`（本地为 `.data/codex`），不继承启动者的 `CODEX_HOME`。子进程的用户目录、SQLite 状态与 XDG 目录也独立保存。需要登录时使用固定版本 Codex，并明确指定实例目录：

```bash
CODEX_HOME=/absolute/path/to/newbot/.data/codex npx codex -c 'cli_auth_credentials_store="file"' login
```

使用其他实例目录时设置 `NEWBOT_CODEX_HOME`。宿主的 `~/.codex`、`~/.agents` 及其子目录不可作为实例目录，也不会自动导入个人配置、账号或历史。已有共享 Home 的安装应先备份并选择性迁移应用会话，再切换；详见 [运行隔离与热更新](docs/runtime-isolation.md)。Provider 由 Bridge SQLite 管理并注入原生线程；MCP、Skills 继续使用实例原生配置。普通配置不回读凭证明文；Provider/HTTPS MCP 使用独立私密通道设置内存或加密凭证。

## 单容器

```bash
docker compose up -d --build
docker compose exec minimal-agent cat /data/initial-password
docker compose exec minimal-agent codex login --device-auth
```

访问 <http://localhost:3100>。`agent-data` 卷保存独立 Codex Home、工作目录、Provider SQLite 配置、Web 会话和附件。自定义 Provider 在 Web 网关设置中添加，密钥通过私密入口加密保存；保留卷重启后配置自动恢复。正式容器验收仍在 R1。

HTML 运行预览与 MCP Apps 共用独立的 `APP_ORIGIN`。本机仅开放一个主站地址时可在 localhost/127.0.0.1 之间选择另一个地址作为应用域；主站同时允许两者时，应显式配置独立应用地址，未配置时 HTML 保持源码/下载模式。应用域只提供隔离文档，禁止访问登录、API 和主站页面。

公网部署时，将 `PUBLIC_ORIGIN` 设置为主站精确 HTTPS origin，将 `APP_ORIGIN` 设置为不同 origin，例如 `https://apps.agent.example.com`；两个域名反向代理到同一个 Fastify 服务。主站和应用站不能使用同一 origin。转发 SSE 时关闭代理缓冲，保留 Host。仅在反向代理可信且直接对外入口受控时设置 `TRUST_PROXY=true`。

```caddyfile
agent.example.com, apps.agent.example.com {
  reverse_proxy 127.0.0.1:3100 {
    flush_interval -1
  }
}
```

**容器与 Compose 的目标环境运行尚未纳入本轮验收，将在 R1 实际验证。** 不要通过 `privileged` 或关闭 Codex sandbox 来绕过执行失败。

## Cloudflare 临时分享

分享模式保留密码登录，使用两个独立 origin 承载工作台与 MCP Apps。当前临时分享使用 poll，分享时设置 `AGENT_TRANSPORT=poll`，继续传递相同的 AG-UI 事件。当前分享地址与停止方法见 [分享说明](docs/cloudflare-sharing.md)。

## API 与协议

- `POST /api/agent/run`：新建/继续 Turn，接受 `requestId`、`threadId?`、`text`、`model?`、`effort?`、`provider?`、`attachments?`、`skills?`。
- `GET /api/agent/runs/:requestId`：核对发送回执；`POST /api/agent/runs/:requestId/abandon` 只放弃尚未登记的发送，并阻止迟到请求执行。
- `GET /api/agent/events`：AG-UI SSE；可用 `threadId` 筛选，重连后同步状态快照。
- `POST /api/agent/action`：白名单内的中断、审批、重命名、归档、恢复与 MCP OAuth 操作。
- `GET /api/runtime/capabilities`：报告实际实现与协议基线，未知的 MCP 协商版本为 `null`。
- `GET/POST /api/config`：已脱离凭证的配置视图及有限修改。
- `GET /api/threads`、`GET /api/threads/:id`：产品会话映射和 Codex 历史分页。
- `POST /api/mcp-apps/open`、`close`、`status`、`call-request`、`call-approve`、`call-cancel`：App 独立 View、资源与一次性工具授权。生命周期与恢复见 [D4.1 记录](docs/mcp-app-lifecycle.md)。
- `POST /api/attachments`、`GET /api/files/:id`：受认证的附件上传/读取。

登录依赖 HttpOnly / SameSite=Strict Cookie。所有写请求需要合法 Origin。API 需要登录，`/api/health`、`/api/session`、`/api/login` 除外。`/sandbox/:token` 是受限应用 HTML 的短期能力 URL，在应用 origin 提供；不能作为普通文件接口使用。

完整的 AG-UI 客户端可消费标准文本、工具及生命周期事件。产品视图使用 `STATE_SNAPSHOT`、`ACTIVITY_SNAPSHOT`，审批与运行状态使用带 `newbot.*` 名称的 `CUSTOM` 扩展事件。前端不接收原始 Codex 通知。

## 开发验证

```bash
npm run generate:codex  # 使用固定版本二进制重新导出协议
npm run check
npm test
npm run build
npm audit
```

`generated/codex` 是 Codex 自动生成的类型，禁止手工编辑。`server/protocol.ts` 只关联请求和生成的响应类型。升级二进制必须重新生成并通过契约和实际连接测试；启动时拒绝协议版本不匹配。

生成脚本现在包含 `--experimental`，用于固定版本 App Server 的动态工具字段。新对话原生注册 `newbot_ui`；旧线程不自动迁移或分叉。

浏览器验证夹具：`npx tsx tests/preview.ts`，访问 <http://127.0.0.1:3101>，测试密码 `browser-test-password-only`。该实例使用临时目录和测试数据，**没有真实模型或监控数据**，不被产品入口或 Docker 使用。MCP App 夹具由官方 SDK 构建，用于验证初始化、工具结果和经审批的反向工具调用。

## 内置 MCP 可视化测试

已提供一个使用官方 SDK 的真实测试 Server 和 App，见 [测试 MCP 示例](examples/test-mcp/README.md)。设置 `ENABLE_TEST_MCP=true` 后，只在本工作台的 Codex 进程启用 `newbot_test`。聊天中调用 `show_metrics` 即可显示 CPU、内存、磁盘图表；服务器选择、时间范围和刷新继续走宿主授权。数据全部为模拟值，不读取真实系统指标。

每个 App 的“权限与能力”展示实际工具范围及宿主限制。未开放的外链、下载、聊天写入、额外资源和模型请求会明确失败；工具调用仍逐次批准。标准握手、结果与测试边界见 [Host 能力记录](docs/mcp-app-host.md)。

MCP 的普通 Elicitation 请求支持有限表单、提交、拒绝、取消和服务端超时，见 [普通输入记录](docs/mcp-elicitation.md)及[独立测试 MCP](examples/test-elicitation/README.md)。这是可能进入模型上下文的普通信息输入；私密输入使用独立的 [受信通道](docs/trusted-input.md)，不复用此表单。

`npm run test:official-ui` 使用真实 Codex/MCP 与原版官方 App 验证并发、拒绝、取消和恢复，不调用模型；测试历史的重放边界和结果见 [D4.4 记录](docs/mcp-app-regression.md)。

A2UI 已完成 D5.1 官方样例和协议基线验证：`npm run dev:a2ui` 启动回环地址实验室，`npm run test:a2ui-ui` 运行浏览器检查。见 [样例说明](examples/a2ui/README.md) 和 [版本与依赖决策](docs/a2ui-foundation.md)。D5.2 组件目录与资源限额已完成，可通过 `npm run dev:a2ui-catalog` 查看，见 [组件记录](docs/a2ui-catalog.md)。D5.3 已接入真实 Agent，能力范围见下文。

D5.3 已启用新对话中的真实 Agent 表单：直接请求可填写的表单，填入普通信息后提交，Codex 在同一个 Turn 中继续。增量更新、原消息关联、服务端字段重建、单次消费、取消和重试均已接通。见 [真实 Agent 接入记录](docs/a2ui-agent.md)。`npm run test:a2ui-chat-ui` 使用模拟 Agent 做浏览器矩阵；`npm run test:a2ui-live` 使用已配置模型执行真实流程。D5.4 已支持表单快照、服务端草稿、冲突提示、到期禁用和重启只读恢复；旧表单不会重新获得提交权限。见 [恢复记录](docs/a2ui-recovery.md)。临时 Provider 检查及 Provider/HTTPS MCP 的独立私密保存均已开放，原值不可回读；内存为默认、加密保存需明确选择，见 [受信输入记录](docs/trusted-input.md) 和 [保存记录](docs/credential-storage.md)。可显式启用单次 sudo 身份检查，见 [受控 sudo 记录](docs/sudo-input.md)。stdio 私密环境、Agent 任意私密请求及任意 sudo 命令尚未开放。

## 遥测

默认不启动导出器。配置 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` 或 `OTEL_EXPORTER_OTLP_ENDPOINT` 后启用固定版本的 OpenTelemetry SDK。仅记录显式请求和 Turn 的限定元数据、摘要标识、状态与耗时；不安装自动采集，不记录 Prompt、输出、工具参数、环境变量、请求头或凭证。目前不具备模型推理内部 Span，也不宣称完整实现尚在演进的 GenAI 语义约定。
