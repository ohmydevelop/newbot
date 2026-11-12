# 品牌更名 newbot 与标识

日期：2026-11-12。用户要求：把产品名从 Minimal Agent 改为 newbot，并设计一个 logo。

## 更名范围

| 位置 | 改动 |
| --- | --- |
| 浏览器标题 / 描述 | `newbot`、`newbot — 以 Codex 为内核的私有 AI 工作台` |
| 登录页品牌 | 标识 + `newbot` |
| 侧栏品牌按钮 | `newbot`，无障碍名称 `newbot，新对话` |
| 顶栏标题、加载页、免责声明、设置页页脚 | `newbot` |
| 个人工作台头像字母 | `M` → `n` |
| MCP App 宿主信息（握手 `clientInfo`） | `newbot` |
| Codex App Server `clientInfo` | `name/title` → `newbot` |
| 启动日志、遥测 `serviceName` / tracer | `newbot` |
| `package.json` / `package-lock.json` 包名 | `newbot` |
| README 标题、A2UI 实验室页标题、冒烟与两个 UI 脚本中的名称选择器 | `newbot` |

**内部标识也一并更名**（用户确认数据可删除，但本轮选择保留：数据库文件重命名即可，不需要内容迁移）：

| 位置 | 改动 |
| --- | --- |
| 数据库文件 | `minimal-agent.sqlite` → `newbot.sqlite`（`server/db.ts`、`server/runner/locations.ts` 的旧实例探测、`server/runner/workspace-migration.ts`） |
| Compose 服务名 | `compose.yaml`、`deploy/compose.production.yaml`、`scripts/backup.mjs`、`docs/production.md`、`README.md` |
| 测试与脚本 | `tests/*`、`scripts/restart-*.mjs`、`smoke-isolated-runtime`、`migrate-codex-home` 内的库文件名 |
| 遥测 | `serviceName` / tracer → `newbot` |

**未改动**：`.issue/**` 里的历史证据脚本与旧备份（历史记录，不是运行代码）、`.data/restart-backups/*` 中的旧名备份文件、`tests/` 夹具正文里的旧称呼。

## 数据

按“数据可删除”处理，但选择了无损方式：停服后把 `.data/minimal-agent.sqlite`（含 `-wal`/`-shm`）重命名为 `.data/newbot.sqlite`，`.data/official-acceptance/minimal-agent.sqlite` 同样重命名。没有做内容迁移、没有新建空库。

若确实要从零开始：`rm -f .data/newbot.sqlite*` 后重启服务即可（会重建空库并重新生成登录密码文件 `.data/initial-password`）。本机旧名备份仍在 `.data/restart-backups/`。

## 标识

- 形态：**对话气泡 + 四角星**（留白负形），气泡带左下尾角，寓意“对话里接入了智能/工具”。
- 内嵌 `Mark`（`web/components/ui.tsx`）：`currentColor` 描边气泡 + 实心星，随主题自动黑/白，无彩色依赖。
- 站点图标 `public/favicon.svg`：`#1a1a1a` 圆角底 + 白色气泡，星形用背景色镂空；16/24/32/64 px 均可辨识。
- 参考实现要点：`viewBox 0 0 32 32`，气泡描边 2.2、`strokeLinejoin=round`；星形为四条三次贝塞尔，中心 (16,15.6)。

## 验证

- `npm run build` 通过（类型检查 + Web 构建）；`dist/web/favicon.svg` 已生成，`index.html` 含 `rel="icon"`。
- `npm test`：495 项，494 通过、1 跳过（既有）、0 失败，日志 `evidence-brand/tests.log`。
- Chromium 实测（浅色/深色两种 `prefers-color-scheme`，公网入口）：
  - `document.title` = `newbot`；侧栏品牌文本 = `newbot`；品牌按钮 aria = `newbot，新对话`；头像字母 = `n`；`link[rel=icon]` = `/favicon.svg`；控制台 0 错误。
  - `/favicon.svg` 返回 200、`image/svg+xml`。
- 截图：`evidence-brand/login-{light,dark}.png`、`app-{light,dark}.png`、`brand-{light,dark}.png`、`favicon-sizes.png`。

## 未处理 / 边界

- 既有浏览器标签页需要刷新才能看到新标题与图标（HTML 为 `no-cache`，图标已换）。
- 未改名：数据库文件、Runner 探测路径、历史证据目录（`.data/`、`.issue/` 旧截图）中的旧名字。
- 未做：macOS/Windows 桌面图标、PWA manifest、GitHub 仓库名与 README 内正文的产品称呼统一。
