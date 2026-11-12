# 清空实例数据（2026-11-12）

用户要求：清空数据。在此之前已完成 newbot 更名，并把数据库文件从 `minimal-agent.sqlite` 改名为 `newbot.sqlite`。

## 删除的内容

| 对象 | 位置 | 说明 |
| --- | --- | --- |
| 应用数据库 | `.data/newbot.sqlite`（含 `-wal`/`-shm`） | 会话、运行记录、Provider 配置、登录会话、Runner 节点与授权、审计 |
| 验收库 | `.data/official-acceptance/newbot.sqlite` | 独立验收环境数据 |
| 每会话工作区 | `.data/workspaces/*`（17 个目录，568K） | 对话中创建的文件 |
| 产物 | `.data/artifacts/*`（6 个，24K） | 上传/生成的产物 |
| Codex 会话与状态 | `.data/codex/{sessions,archived_sessions}`, `thread_history_1.sqlite*`, `session_index.jsonl`, `logs_2.sqlite*`, `memories_1.sqlite*`, `queue_1.sqlite*`, `state_5.sqlite*`, `goals_1.sqlite*` | Codex 自己的对话记录、历史索引、记忆、日志与队列；重启后自动重建空库 |

## 保留的内容

- `.data/native`（60G Codex 构建产物）、`.data/bin`、`.data/codex/{config.toml,plugins,skills,runtime-home,installation_id}`：运行前提与已安装扩展，不属于会话数据。
- `.data/initial-password`（登录密码不变）、`.data/private-credentials.key`（用于解密旧备份中的凭证）。
- `.data/restart-backups`（历史备份）、`.data/*-ui` 等测试证据与日志。
- `.data/imports`（约 20M，导入的插件/技能包）：当前数据库已无对应配置记录，按需可删。

## 过程中发现的问题与修正

删除数据库后，`runtimeLocations()` 的旧布局探测条件（`.data/newbot.sqlite` 是否存在）不再成立，实例**静默切换到新布局** `~/.newbot`（新建 server/codex 目录，约 95M）。这不是用户要求的效果，且会让备份、脚本、文档假设的 `.data` 路径失效。

修正（已落到代码，见 `init-state-bugs-plan.md` / `init-state-bugs-progress.md`）：

1. `runtimeLocations()` 改为按 `.data` 中的任一持久状态（数据库、`initial-password`、`codex/`、`workspaces/` 等）识别既有安装，删除数据库不再切换布局。
2. `auth()` 在空库时沿用已存在的 `initial-password`，清空数据库不再更换登录密码。
3. 停服并删除本次误建的 `~/.newbot`；`.env` 中的 `DATA_DIR=.data` 保留为显式保险。
4. 重新启动，确认使用 `.data/newbot.sqlite` 且未再创建 `~/.newbot`。

## 验证

- `/api/ready` = ready；公网首页 200；匿名 `/api/config` 401。
- 数据库：schema 17、`threads=0`、`runs=0`、`sessions=0`、`integrity_check=ok`。
- 浏览器实测（深色，1280×820）：侧栏“最近对话”为空并显示“新的想法，从这里开始。”，无任何历史会话；品牌与图标为 newbot；Codex 连接正常。
- 截图：`evidence-brand/cleared-dark.png`。
- 服务日志无 error 级记录。

## 现状与后续

- 所有浏览器需要重新登录（旧会话记录已删除），密码仍是 `.data/initial-password` 中的值。
- Provider 需要重新配置：数据库中没有自定义 Provider，只有 Codex 默认目录（9 个模型）。
- `.data/codex` 仍保留 `config.toml`（项目信任、插件开关）与已安装扩展；如要连 Codex 侧配置一起清空，可删除该目录后重新初始化。
