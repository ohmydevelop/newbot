# Codex 运行隔离与热更新

newbot 是独立 Codex 客户端，不能共用开发者的个人 Codex Home。默认状态目录为 `DATA_DIR/codex`，可用 `NEWBOT_CODEX_HOME` 指向另一个实例目录；启动者的 `CODEX_HOME` 不作为默认值，开发客户端的 Codex 登录 Token 和工具管道也不继承。子进程 HOME、XDG、SQLite、登录文件与 MCP OAuth 文件也属于该实例。不会修改 Bridge 本身或当前开发客户端的 HOME。

启动时拒绝宿主 `~/.codex`、`~/.agents`、其子目录及链接别名；状态文件不能用符号链接或硬链接指向另一环境。原生配置、插件与技能配置写入前再次检查。技能卸载仅允许实例 `skills/` 和实例用户目录 `.agents/skills/`，宿主技能即使出现在发现结果中也不可卸载。工作区/系统来源继续只读。应用任务以工作区沙箱和既有审批执行；“完全访问权限”是用户显式授予的同用户文件权限，不属于 OS 级强隔离。

## 已有共享 Home 的迁移

停止旧 newbot 实例后，先查看只读报告，再显式应用：

```bash
node --import tsx scripts/migrate-codex-home.mjs --source-home /absolute/old/codex-home
node --import tsx scripts/migrate-codex-home.mjs --source-home /absolute/old/codex-home --apply
```

此一次性维护工具使用 Node SQLite 和 Python 标准库 TOML 解析器，产品运行不依赖 Python。仅迁移 Web 会话表记录且工作目录匹配的线程。分页历史同时复制对应原生 SQLite 行；不复制其他线程、个人登录、插件、技能、远程控制注册或项目分组。只导入 newbot 管理且使用 `NEWBOT_*` 环境引用的网关，以及受管理默认模型文件。密钥仍由原 Bridge 凭证库供应，不复制个人 auth.json。

源目录只读；目标必须不存在。先写私有临时目录，再原子发布；不覆盖已有实例。源保留作为回退。迁移的数据库和历史文件权限为 0600，实例目录 0700。迁移后必须通过固定版本原生协议核对线程 ID、分页历史数量和应用配置。

## 热更新能力

2026-11-10 更新：Provider/模型使用 SQLite 持久化快照，重启自动恢复，不写 Provider config.toml/Profile。线程通过原生参数热更新，会话选择与历史保留。当前用法及凭证边界见 [配置持久化与热更新](provider-memory-config.md)。普通扩展定义和启停也已迁入 SQLite，并在下一轮同步目标线程；安装缓存、技能文件和认证状态继续保留原生格式，见 [会话工作区与扩展](session-extensions.md)。

| 设置                 | 可用机制                                                     | 生效边界                                                 |
| -------------------- | ------------------------------------------------------------ | -------------------------------------------------------- |
| 模型、推理和审批     | 线程/Turn 参数及会话修订号                                   | 下一轮，保留正在执行的设置                               |
| 网关定义             | `thread/start.config`、空闲线程卸载后 `thread/resume.config` | 可从服务端内存传入，无需写个人或实例 config.toml         |
| 线程 MCP 定义        | 线程 `config.mcp_servers`                                    | 新建/恢复目标线程；不会自动改变其他线程                  |
| 新增或轮换凭证       | 私密 Broker 与线程派发参数                                   | SQLite 模式下供下一轮注入，不重启共享子进程；见 [私密字段](private-runtime-fields.md) |
| 全局 MCP 重载        | `config/mcpServer/reload`                                    | 原生接口从磁盘重读，不能把 Bridge 内存缓存当成已生效     |
| 全局配置热重载       | `config/batchWrite.reloadUserConfig`                         | 仍会写实例文件；部分线程静态默认值不重载                 |
| 插件、技能安装和登录 | 原生管理接口                                                 | 原生仍管理文件、缓存或认证状态                           |
| 对话与断线恢复       | Codex 原生状态                                               | 为重启恢复保留持久化，不能只放在 Bridge 内存             |

Provider 设置已统一为服务端不可变快照 `{ revision, values }`，浏览器经现有受鉴权接口提交允许字段，服务端校验后发布新版本。任务开始时绑定快照版本，后续更新不修改已经运行的任务；目标空闲线程通过原生恢复参数应用新快照。缓存刷新失败保留上一版。密钥单独走凭证 Broker，不混入快照、聊天或事件流。

Provider 参数保存在 Bridge SQLite，重启自动恢复；可信来源用于首次初始化或显式同步。网关参数不写实例 config.toml，插件/技能/MCP 继续使用原生文件或缓存。新增原生诊断放入私有 tmpfs，退出清理，没有 tmpfs 时明确报错。旧日志及迁移备份保留，历史保存必要元数据；这些不是配置恢复来源。只有 Bridge 的受控 SQLite 配置行参与恢复。

迁移后的历史读取使用原生 `thread/read` 元数据和分页消息，不为了浏览历史先恢复执行环境。旧会话缺失模型时从原生已保存值补齐，并保留已有审批和修订号；继续任务时再验证和恢复运行配置。独立实例尚未登录旧账号，也应能展示已迁移历史。

验证：`npm run test:runtime-isolation` 使用固定 Codex 和本地合成网关，证明无 config.toml 的线程配置、实际 A/B 路由、同一 Provider 的地址热更新、原线程历史、进程不重启，以及配置写入不会改变宿主个人配置。证据见 `.issue/2026-11-09/evidence-04/`。

官方依据：[环境变量](https://learn.chatgpt.com/docs/config-file/environment-variables)、[App Server](https://learn.chatgpt.com/docs/app-server)。以固定二进制生成的协议和实际验证为准。
