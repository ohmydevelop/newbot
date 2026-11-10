# 历史基础验证记录 · 2026-11-07

本页保留最初基线，不代表当前测试数量或依赖审计状态。最新开发结论见 [功能冻结记录](feature-freeze.md)，目标环境验收仍在 R1。

环境：本机 Linux，Node.js 26.12.0，固定 Codex CLI 0.166.0。容器目标使用 Node.js 24。

## 已完成

- TypeScript 编译和 Vite / 服务端生产构建通过。
- 7 项自动化契约与安全测试通过：认证/来源/接口边界、AG-UI 和恢复、原生待审批保留、MCP App 授权与重放、附件限制、独立 App origin/CSP、失败与中断终态。
- 依赖审计为 0 个漏洞。
- 真实 Codex 初始化、模型/配置/Skills/MCP 读取成功；发现 8 个模型、54 个 Skills、4 个 MCP Server。
- Bridge 与 Codex 重启后，真实测试线程仍可读取到已完成 Turn 和回复正文。
- `docker compose config --quiet` 通过；这只验证配置，不代表容器已经运行。
- 通过真实已配置 Provider 完成一条小型对话：收到文本增量、文本结束、`RUN_FINISHED`，从 Codex 重新读取到已保存的回复。
- 浏览器检查了 1440px 桌面、375px 手机、系统深色与浅色主题；375px 文档宽度等于视口宽度，无横向溢出。
- 浏览器确认 Markdown 表格、Shiki 代码着色、KaTeX、Mermaid 与 ECharts 实际显示。
- 由官方 MCP Apps SDK 构建的测试 View 完成独立 origin 加载、初始化、工具结果接收、刷新请求、宿主单次审批与工具结果回传。

浏览器富交互测试使用单独的临时数据和测试 Provider，界面明确标注测试数据。真实 Provider 的聊天验证与该夹具分开进行。

## 仍待验收

- Docker 镜像与 Compose 实际运行：当前账号无 Docker daemon 权限。
- 第二个真实 Provider、第三方官方完整 App 示例的兼容矩阵；当前 Provider 的图片理解已在下述稳定化测试验证。
- 固定域名 SSE、不同反向代理、长时间运行、1–5 会话、完整内存及首屏性能预算；Quick Tunnel HTTPS 已有下述实测。
- A2UI、A2A、ACP、私密 Credential Broker 等尚未实现的路线图项。

测试命令见 [README](../README.md)。可选 `node scripts/smoke.mjs` 会通过当前真实 Provider 发送一条测试消息；读取 `SMOKE_URL` / `SMOKE_PASSWORD`，默认使用本机地址及首次生成的密码文件。报告仅保存 threadId、事件类型和状态，不保存凭证或消息正文。

## Cloudflare 分享补充验证

- 新增轮询适配、缓冲缺口/重启恢复、混合本地 HTTP / 公网 HTTPS 的 Secure Cookie 测试，总计 10 项通过。
- 新生产构建通过，依赖审计仍为 0 个漏洞。
- 从公网 HTTPS 地址验证：未登录访问配置、会话列表及轮询均为 401，错误密码为 401，正确密码为 200。
- HTTPS 登录 Cookie 确认具有 Secure / HttpOnly 标志。
- 公网真实 Codex Turn 返回 `RUN_FINISHED`，轮询接收到文本增量，持久化历史确认完成。
- 分享与停止方法见 [Cloudflare 说明](cloudflare-sharing.md)。

## 内置 MCP Server / App 验证

- 新增 `examples/test-mcp`：官方 SDK 的真实 stdio Server，提供 `echo` / `show_metrics` 和独立 MCP App。
- 官方 MCP 客户端完成真实子进程的初始化、工具发现、参数校验、模拟数据读取与 UI 资源读取。总计 12 项自动化测试通过。
- 真实 Codex 在公网会话调用 `newbot_test.show_metrics`；聊天自动展示隔离 App。
- 修复真实 Codex 结果的顶层 `null` 可选字段与 MCP Apps SDK Schema 不兼容的问题，并加入官方 Schema 回归测试。
- 公网浏览器完成指标切换、授权刷新和切换 Node B。App 收到第 2 次工具结果，显示 Node B 的新指标，未再次请求模型。
- 375px 手机检查：主文档宽度 375px，iframe 内容宽度/滚动宽度均为 327px，无横向溢出。
- 当前测试服务器仅由 `ENABLE_TEST_MCP=true` 在本工作台的 Codex 进程启用，不修改用户全局 Codex 配置。所有指标均为模拟值。

## 稳定化候选版补充验证（2026-11-07）

- 自动化测试增至 21 项，全通过；新增密码轮换/异步限速、未知提交重启与防重放、原生 clientId 正向对账、双任务限流与维护、附件清理/归档保留、Provider 空闲切换与旧线程恢复、固定 loopback OAuth 代理隔离、并发重连只启动一个子进程，以及提交前校验失败的附件释放。
- TypeScript 与生产构建通过；生产依赖审计为 0 个漏洞。Vite 仍提示部分按需渲染资源较大，不能据此宣称首屏一秒内验收。
- cloudflared 官方客户端校验 Named Tunnel ingress 模板通过。基础 Compose 与生产 Compose 语法均验证；本机仍无 Docker daemon 权限，未运行应用容器。
- 升级测试工作台前创建 Web SQLite 本机备份；确认没有任务/审批后重启，新数据库迁移成功，原分享地址、登录密码和历史保留。
- 公网新版 UI 实际发送并完成“稳定性验收已连接”，没有重复消息。
- 真实 Provider 读取合成的 128×128 红色 PNG，正确回答“红色”；历史中的图片经受鉴权文件地址恢复，桌面和 375px 浏览器均可见。375px 主文档 scrollWidth=375，无横向溢出。截图：`.data/stability-desktop.jpg`、`.data/stability-mobile.jpg`。
- 真实 Codex 产生 `item/commandExecution/requestApproval`；仅拒绝本测试请求，任务正常终结。未自动批准权限升级。
- 临时项目级 Skill 由原生 skills/list 发现，文字提及后遵循指令回复测试标记；结束后移除临时 Skill。结构化手动选择器仍未实现。
- 本地 restic 0.19.1 官方发行版经 SHA256SUMS 校验，在全新加密测试仓库备份合成数据。执行仓库 check、7 日/4 周保留命令及实际 `scripts/restore.mjs --verify` 路径，恢复的 SQLite 可查询，附件内容及 0600 权限一致。这不是远程仓库或正式 Codex Home 的整机恢复验收。
- Soak 脚本完成 36 秒/18 次采样，0 次失败；Bridge 峰值 RSS **155 MiB**、heap **44 MiB**。未达希望低于 100 MiB 的 Bridge 预算，且没有测量 Codex/MCP 子进程的容器总内存；没有完成 24 小时运行。
- 单容器运行、固定域名、第二个 Provider、实际 MCP OAuth、官方完整 App 示例、正式恢复演练和长时并发测试仍是发布门槛，见 [生产手册](production.md)。CI 文件已经加入，但当前目录无 Git 仓库，尚未在 GitHub 执行。

本机合成数据/真实服务的报告仅记录状态、计数与测试线程 ID：`.data/live-image-check.json`、`.data/live-approval-check.json`、`.data/live-skill-check.json`、`.data/restic-rehearsal.json` 和 `.data/soak-*.json`。不包含密码、Cookie 或 Provider Key。

最终服务检查发现交互命令会话中的测试 Web 进程已正常退出，未捕获应用异常；退出原因未确认。已改由用户级 systemd 临时单元管理测试 Web 服务（失败自动重启），重新检查本地/公网 ready=200、未登录配置=401、原密码登录=200；服务重启后真实图片会话及附件仍能恢复。生产仍使用 Docker restart 策略，不能把此测试单元当作正式部署。

## 第二轮补充（2026-11-08）

官方原版 Vanilla JS MCP App 2.0.4 已通过真实 Codex、初始化、授权刷新、消息/外链拒绝、深浅主题与 375px 手机检查。自动测试增至 26 项。完成遥测按需加载及内容隔离、静态路由和加载优化；真实工作台 90 秒探针峰值 123 MiB，未完成 24h，也未稳定达到 100 MiB。完整对照方法、缓存限制、证据和剩余门槛见 [第二轮记录](round2.md)。
