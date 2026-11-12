# 初始化状态缺陷：实施记录

对应计划：`init-state-bugs-plan.md`。日期：2026-11-12。

## 改动

### BUG-1 布局由持久状态而非单个文件决定（`server/runner/locations.ts`）

新增 `repositoryInstall(project)`：仓库 `.data` 中存在任一运行状态即视为既有安装——`newbot.sqlite`（含 `-wal`/`-shm`）、`initial-password`、`private-credentials.key`、`codex/`、`workspaces/`、`runner/`。旧布局判定与“不能静默迁移到空白 NEWBOT_HOME”的守卫共用这一判断。

效果：删除数据库（清空数据）后重启仍留在 `.data`；只有空 `.data` 目录时仍按新安装走标准布局。仍保持“只解析、不创建目录、不移动数据”。

### BUG-2 空库沿用本机密码（`server/auth.ts`）

`auth()` 在 `store.get("password")` 缺失且未提供 `ADMIN_PASSWORD` 时，先读 `initial-password`：内容长度 ≥12 则直接作为密码写入新哈希（文件保持不变，启动日志打印“沿用 … 中的登录密码”）；只有文件也缺失或过短才生成新密码并写文件。环境变量轮换、会话吊销与 `initial-password` 删除行为保持不变。

## 验证

- 回归与新增：`npx tsx --test tests/runner-locations.test.ts tests/stability.test.ts` 20 项通过，其中新增：
  - 删除数据库后仍为 legacy 且目录不变；
  - 空 `.data` 目录不锁定布局；
  - 空库沿用原密码、文件内容不变、旧密码可登录。
- `npx tsc --noEmit` 通过；`npm test` 495 项（494 通过 / 1 既有跳过 / 0 失败），日志 `evidence-brand/tests-init-fix.log`；`npm run build` 通过，日志 `evidence-brand/build-init-fix.log`。
- 端到端（真实实例，数据本身已为空）：停服 → `rm .data/newbot.sqlite*` → 用 `.env` 启动
  - 日志出现“沿用 /home/a/Documents/ChatGPT/newbot/.data/initial-password 中的登录密码。”
  - `.data/newbot.sqlite` 在 `.data` 重建，`~/.newbot` 未被创建；
  - `initial-password` 内容与 mtime（17:17:38）不变，旧密码登录返回 200；
  - 登录测试产生的会话已删除，`sessions=0`、`threads=0`。

## 文档

- `docs/runner-architecture.md`：说明布局判定改为持久状态集合。
- `docs/user-guide.md`、`README.md`：说明已存在的 `initial-password` 会被沿用，清空数据库不更换密码。
- `.issue/2026-11-12/clear-data.md`：把“`.env` 固定 DATA_DIR”的临时说明改为代码修复后的结论（`.env` 的 `DATA_DIR=.data` 保留为显式保险）。

## 边界与未处理

- 不做新旧布局自动迁移（设计上仍拒绝静默迁移）。
- `NEWBOT_HOME` 显式指定一个空白目录时，只要仓库 `.data` 有状态仍会报“请先完成目录迁移”，需要人工迁移。
- `initial-password` 少于 12 字符视为无效并重新生成，避免过短密码被沿用。
