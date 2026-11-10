# Provider SQLite 配置与原生参数热更新

2026-11-10 更新。模型网关、地址、默认模型、推理默认值、网关默认及托管凭证引用保存到 Bridge SQLite（Schema v7 的 provider_configuration 表），启动时恢复不可变内存快照。固定 Codex 0.165.0，继续通过原生参数热更新，不写 Provider config.toml 或网关 Profile 文件。原有 SQLite 会话表继续保存每个会话所选 Provider、模型、推理、审批及修订号；任务只关联配置版本，不重复存储完整定义。Codex 原生历史仍持久化。

## 生效路径

Web 设置、凭证引用和配置下发使用同一版本校验与发布入口。先提交 SQLite，确认成功后再发布内存新版本；写入失败或版本冲突时，内存参数保持原值。创建线程和恢复空闲线程时，Bridge 将快照放入原生 thread/start.config 或 thread/resume.config。当前任务保持原配置，下一轮应用最新版本。切换保留同一线程 ID、历史和 App Server PID；只卸载目标空闲线程，其他活动线程不终止。模型、推理与审批使用原生线程设置及 Turn 参数。

请求准备阶段持有配置版本，执行中不改写已下发参数。相同 requestId 的重试只查询原结果，不因为配置变化重新执行。失败保留输入与原会话绑定；缺少 Provider 时拒绝续聊，历史仍可读。

原生线程覆盖会合并磁盘的同名 Provider 字段。为防止继承旧地址或认证，运行路径拒绝同名磁盘定义；必须先完成一次性迁移。不能仅判断本轮没写文件就声称不会继承旧认证。

## 重启与来源

Bridge 或容器重启后，自动从 SQLite 恢复 Provider 定义、全局默认、网关默认及凭证引用。保留 DATA_DIR 数据卷即可恢复，无需重新填写。已保存配置优先于外部来源及初始化种子，防止启动时覆盖 Web 中的新修改。已保存数据损坏或格式不支持时明确报错，不清空、不静默回退。

支持手动和可信配置来源下发：

- 登录 Web 后，通过模型网关页面添加/修改，或调用受鉴权、Origin 校验的 POST /api/runtime/config。成功修改都会保存到 SQLite。
- 已有会话引用的缺失网关会显示“等待恢复配置”；点击编辑可沿用原 Provider ID 填回名称和地址，恢复原会话。无需新建线程，也不要求手工修改数据库或记住完整 ID。
- 可选 NEWBOT_RUNTIME_CONFIG_URL：没有已保存配置时用于首次初始化；之后可点“重新下发”或调用 POST /api/runtime/config/reload，明确替换并保存目录。可选 NEWBOT_RUNTIME_CONFIG_TOKEN 只用于来源认证，不交给浏览器、Codex 或工具进程。

来源只接受 HTTPS（测试允许回环 HTTP），禁止 URL 凭证/查询/片段和重定向，超时 8 秒、响应最多 128 KiB。首次来源失败时使用空目录并显示不可用，历史可读，下次启动可重试。已有 SQLite 配置时不依赖来源在线；重新下发失败保留数据库和内存上一版。不隐式导入旧 config.toml、备份或浏览器 localStorage。

配置来源返回以下 JSON。这里不接受任何明文 API Key、任意 Codex 参数、命令或 Header：

```json
{
  "providers": [
    {
      "id": "gateway_a",
      "name": "测试网关",
      "baseUrl": "https://models.example.com/v1",
      "defaultModel": "your-model-id"
    }
  ],
  "defaults": {
    "provider": "gateway_a",
    "model": "your-model-id"
  }
}
```

POST /api/runtime/config 在此基础上增加 expectedRevision，取自 GET /api/runtime/config 返回的 configuration.revision。下发替换完整 Provider 目录；id 稳定，才能匹配旧会话。GET 只返回脱敏状态，不提供完整地址、环境引用或凭证。最多 64 个网关；envKey 可引用服务端明确允许的环境变量，不能引用工作台登录密码或来源 Token。

## 凭证

凭证仍走独立 Broker，普通配置行只存引用。网关编辑器在加密可用时默认“本机加密保存”，密文存于 managed_credentials，主密钥在实例私有文件，重启自动恢复。用户显式选择“仅本次运行”的临时凭证仍在 Bridge 重启后清空，配置继续保留并显示凭证缺失。相同 ID、地址、协议和认证约定可关联唯一匹配的密文绑定；改变接收方、损坏、歧义或锁定状态不领取旧密钥。

当前 Codex 使用环境变量载入托管凭证，新增、轮换、清除或首次重新关联凭证仍需空闲时受控重连。非敏感网关/模型参数热更新不重启进程；不把凭证明文塞入线程参数来换取表面的零重启。已有任务运行时不会为了载入新密钥终止共享进程。

## 从旧实例切换

先停止旧 newbot，保留数据库及实例卷备份。首次启动可临时设置：

```bash
NEWBOT_IMPORT_PROVIDER_CONFIG_ONCE=true npm start
```

已有 SQLite 配置时直接恢复，不重复导入。未迁移的原生文件实例中，此操作只读取独立实例配置，备份到 DATA_DIR/restart-backups/provider-memory-\*，先提交 SQLite，再清理活动文件的 Provider/default 和受管理 Profile。Skills、插件、MCP 和其他原生策略保留。另存迁移标记与源摘要。

迁移遇到内联认证、不支持的字段、版本冲突或不安全路径时拒绝继续，不覆盖个人 ~/.codex。清理文件失败时保存参数仍在，同名磁盘定义守卫阻止混合配置执行，需修复后继续。后续重启直接读 SQLite，不自动导入备份。旧备份留在服务端私有目录。

从纯内存旧实例升级时，须在停止旧 Bridge 前保留当前参数，并在切换时写入 SQLite；新代码无法恢复已丢失的 RAM。本机维护脚本对照受控备份、运行中目录与审计记录迁移，无法确认时拒绝猜测，不覆盖已有 SQLite 配置。

## 范围与验证

本模式管理 Provider/模型运行参数。MCP 配置、插件与 Skill 安装/启停、账户登录仍使用原生文件或认证缓存；不是承诺 Codex 不产生任何持久化文件，也不改变现有凭证或执行沙箱的安全边界。

原生诊断 SQLite 即使设置 RUST_LOG=off 也可能记录请求参数。内存模式将原生 log_dir 放入私有 tmpfs 目录，退出时清理；历史与状态数据库仍在实例卷。Linux 默认使用 /dev/shm，也可用 NEWBOT_RUNTIME_LOG_ROOT 指定其他可写 tmpfs；没有可用 tmpfs 时明确报告运行环境错误，不静默把诊断改写到磁盘。旧实例先前留下的日志和迁移备份继续保留，不作为配置恢复来源。

GET /api/runtime/config 返回 storage: "sqlite"、requiresResupplyAfterRestart: false。SQLite 只接受受支持的非敏感字段，拒绝内联 API Key、任意 Header、命令和含凭证的 URL。

验证入口：npm test、npm run test:provider-sqlite-native、npm run test:credential-sqlite-native、npm run test:provider-sqlite-ui。原生测试只请求本地合成网关，不调用付费模型。证据见 .issue/2026-11-10/evidence-sqlite/，计划见 sqlite-plan.md。
