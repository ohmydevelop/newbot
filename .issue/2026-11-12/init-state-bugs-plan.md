# 初始化状态缺陷：清空数据后换目录、换密码

日期：2026-11-12。来源是今天清空实例数据的实际操作中暴露的两个问题。

## BUG-1 删除数据库后静默切换到另一个运行目录

**触发**：清空数据（删除 `.data/newbot.sqlite`）后重启服务。

**实际**：`runtimeLocations()` 判定“旧布局”的唯一依据是该数据库文件是否存在，于是实例静默切到标准布局 `~/.newbot`，新建 `server/`、`codex/`（约 95M）、把工作区改到 `~/Newbot/workspaces`。备份脚本、`restart-*.mjs`、文档与 `.data` 假设全部失效，用户还会在两个目录之间出现“数据分裂”。

**预期**：清空数据库只应清空数据，不应改变实例所在目录。

**被破坏的不变量**：运行目录由部署配置决定，不能由某个数据文件的偶然存在与否推断，更不能在启动时静默改变。

**证据**：`server/runner/locations.ts:52-76`；实测 `17:16` 重启后出现 `~/.newbot`，`ls .data/newbot.sqlite` 不存在。

**根因**：布局选择依赖 `existsSync(project/.data/newbot.sqlite)`，把“数据是否存在”和“安装位置”绑在一起。

## BUG-2 清空数据库后登录密码被无提示重置

**触发**：同上（空库首次启动，未设置 `ADMIN_PASSWORD`）。

**实际**：`auth()` 在库中没有密码记录时直接生成新的随机密码并覆盖 `.data/initial-password`，旧密码立即失效；此前给出的密码变成 401，用户以为服务坏了。

**预期**：库中没有密码记录但本机已有 `initial-password` 时，应以该文件为准重新写入哈希，保持密码不变；只有“库与文件都没有”才生成新密码。

**被破坏的不变量**：清空业务数据不等于重置访问凭证；本机已有的登录密码是操作者预期事实，不能静默更换。

**证据**：`server/auth.ts:20-38`；实测 `.data/initial-password` 在 `17:17:38` 被改写，旧密码登录返回 401，新值返回 200。

**根因**：空库分支没有把已存在的密码文件当作来源。

## 同类风险清单

| 检查项 | 共同机制 | 结果 | 处置 |
| --- | --- | --- | --- |
| 其它按“文件存在”推断布局的入口 | 布局探测 | 有代码证据：`locations.ts` 仅此一处 | 纳入：改为标记集合 |
| 显式 `NEWBOT_HOME` 迁移保护 | 同上守卫 | 有代码证据 | 纳入：守卫改用同一标记集合 |
| 空 `.data` 目录误判为旧实例 | 标记集合 | 待验证 | 纳入：单测（空目录 → standard） |
| 手工把 `initial-password` 改成过短值 | 密码来源 | 待验证 | 纳入：短于 12 字符视为无效并生成新密码 |
| `ADMIN_PASSWORD` 与环境变量优先级 | 密码轮换 | 有代码证据：env 仍优先并可轮换 | 保持现状，不纳入 |
| 并发启动/端口占用 | 实例租约 | 非本次缺陷（`EADDRINUSE` 映射为“实例仍在运行”） | 排除 |
| 统一 prettier 格式 | 工具链 | 与本缺陷无关 | 排除 |

## 修复范围

1. `server/runner/locations.ts`：新增标记集合（数据库、`initial-password`、`private-credentials.key`、`codex/`、`workspaces/`、`runner/`）判断仓库内既有安装；迁移守卫复用同一判断。保持“只解析、不创建目录、不移动数据”的既有约束。
2. `server/auth.ts`：空库且无 `ADMIN_PASSWORD` 时，优先沿用 `initial-password`；仅当两者都缺失才生成并写文件，并区分“沿用/生成”的启动提示。
3. 测试：`tests/runner-locations.test.ts` 增加“只删数据库仍是旧布局”“空 `.data` 不锁定布局”；`tests/stability.test.ts` 增加“空库沿用文件密码、文件不被覆盖”。
4. 文档：更新 `.issue/2026-11-12/clear-data.md` 与 `rebrand-newbot.md` 的过时结论；`docs/runner-architecture.md` 若描述布局判定则同步。

## 不处理

- 已写入 `.env` 的 `DATA_DIR=.data` 保留为显式保险，不作为唯一依靠。
- 不做新旧布局的自动迁移（现有设计明确拒绝静默迁移）。
- 不改端口占用与实例租约行为。

## 验收标准

- 单测：仅删除数据库后 `runtimeLocations()` 仍返回 legacy 且目录不变；只有空 `.data` 目录时返回 standard。
- 单测：删除数据库后 `auth()` 沿用原 `initial-password`，旧密码可用、文件内容不变、会话被正确保留/吊销符合轮换规则。
- `npx tsc --noEmit`、`npm test`、`npm run build` 通过。
- 现场验证：删除 `.data/newbot.sqlite` → 重启后仍在 `.data` 下重建，且原密码可登录（本次不重复执行删除，用临时目录做等价验证）。

## 完成状态

见 `init-state-bugs-progress.md`。
