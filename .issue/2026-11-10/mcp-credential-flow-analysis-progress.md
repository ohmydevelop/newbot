# MCP 凭证流程分析进度与证据

对应计划：`mcp-credential-flow-analysis-plan.md`。2026-11-10，分析任务，无产品代码修改。

## 当前结论

当前默认是“SQLite 保存定义/引用 + Bridge vault 持有原值 + 重启 Codex App Server 子进程后以环境变量注入”。不属于进程内凭证热替换，也不是把 Token 明文写入 config.toml 后重启。

旧兼容模式（`providerRuntime:null`、无 ExtensionRuntime）仍会通过 `config/batchWrite` 把 MCP 的 `bearer_token_env_var` 引用写入独立实例的原生用户配置。凭证原值的存储与注入机制相同。

## 追踪关系

| 问题 | 原因/所有者 | 关联功能 | 实施步骤 | 验收证据 |
| --- | --- | --- | --- | --- |
| 是否热更新 | 环境映射仅在 Codex.start/spawn 时注入 | 保存、轮换、清除、apply | 无；分析调用链 | management.prepare → reloadPrivateRuntime → reloadProviderConfiguration → Codex.restart → stopAndWait/start |
| 是否写文件 | 引用走 configuration.mutate 的 ExtensionRuntime 分支；秘密走独立 vault | 默认 SQLite/兼容原生文件 | 无；核对配置分支 | configuration.ts:244-273；extension-runtime.ts:95-118 |
| 内存凭证能否重启恢复 | memory Map 属于 Bridge，不属于 Codex 子进程 | 浏览器刷新、Codex 重连、Bridge 重启 | 无；专项测试 | 本次专项 45/45 通过，含 encrypted entries restore after restart / Bridge restart requires memory credentials to be entered again |
| 影响其他会话吗 | 所有线程共享 App Server；维护前 requireIdle | 活动任务、审批、MCP App/OAuth | 无；静态检查 | bridge.ts:requireIdle、privateConfiguration；codex.offline 清空加载状态 |
| 保存是否等于认证成功 | applied 只检查 credentialRefs 和有效绑定 | 重连失败、缺失/锁定凭证 | 无；专项测试 | vault.info:273-276；management.prepare:104-120 |

## 运行版本核对

已观察运行入口为仓库 `dist/server/index.js`（PID 1204031），它的 Codex 子进程使用本仓库 `node_modules/.bin/codex`。构建时间 2026-11-10 18:25:27 +08:00，相关源码修改时间早于构建。构建中可找到 ExtensionRuntime/extension_configuration、私密重启和 credentialSource 分支；这支持当前构建包含所分析机制，不替代一次真实凭证更新的动态追踪。

没有读取或记录用户凭证原值，没有操作共享实例的私密写入、重连或清除接口。工作区原有大量未提交变更保持原样。

## 验证与限制

本次运行：

```bash
node --import tsx --test tests/credential-storage.test.ts tests/credentials.test.ts tests/mcp-config.test.ts
```

结果 **45/45 通过，0 失败/跳过**。证据：[测试日志](evidence-mcp-credential-flow/targeted-tests.log)。覆盖凭证内存/加密恢复、HTTPS MCP 引用保存、Provider 共用消费路径、清除、版本冲突、重复输入拒绝、迟到结果、重连失败、绑定变化、引用复用及 MCP 活动任务/OAuth 守卫。

这些专项测试的配置与生命周期路径主要使用 `ProviderCodex` 等原生替身（凭证 fixture 显式设置 `providerRuntime:null`，无 ExtensionRuntime）；其中有真实本地 TLS 消费者，但没有在本次重新运行真实 Codex 的 MCP 握手。默认 SQLite/ExtensionRuntime 路径以源码与当前构建分支核对为证，不将兼容模式替身测试标为当前默认原生端到端验证。

[运行入口证据](evidence-mcp-credential-flow/runtime-entry.json) 记录当前入口、数据目录、构建时间、关键分支存在性和 `http://127.0.0.1:3100/api/health` 返回 200。该检查未读取凭证原值，未触发服务配置变更。

真实第三方 MCP、OAuth 登录和共享实例凭证更新均未执行。历史文档 `docs/credential-storage.md` 及部分 Provider 文档仍描述早期文件路径，当前默认 MCP 定义存储以 `ExtensionRuntime` 实现和较新的 `docs/session-extensions.md` 为准；本次只记录差异，没有改写这些历史文档。

## 可交付的完整流程

1. `ManagedCredential` 创建仅含目标、版本和保留方式的 `credential.save` 票据；`CredentialProbe.tsx:135-164` 将值以独立 `application/octet-stream` 提交 `/api/credentials/:id/input`，清空输入及可控字节缓冲区，不通过聊天消息传值。
2. Broker 先消费单次票据，再在空闲维护区复核配置版本、vault 版本和接收方绑定。`vault.stage` 保存新值并生成 `NEWBOT_CREDENTIAL_KEY_<随机值>` 引用。
3. 当前默认将 `mcp_servers.<id>.bearer_token_env_var` 引用保存至 SQLite `extension_configuration`，更新内存快照；旧兼容模式将该引用写入实例 config.toml。memory 原值只在 Map，encrypted 原值只以密文写 `managed_credentials`。
4. 读回确认引用后清理旧保存值，调用 `reloadPrivateRuntime → reloadProviderConfiguration → codex.restart`，停止旧共享 App Server 子进程。Bridge Web 进程不因此重启。
5. `credentialSource` 在启动前读取真实原生配置，合并受控快照并校验引用/绑定；`vault.nativeEnv` 返回 `{引用名: 原值}`，新 Codex `spawn.env` 取得这份映射。没有把它写入 Bridge 的 `process.env`。
6. MCP 定义通过线程配置包含 bearer 引用；原生 MCP 客户端从认证环境取值用于请求。普通定义与启停可经线程快照更新，但不能把新 Token 注入已经启动的进程环境，因此托管凭证的新增/轮换/清除仍采用重连。
7. `applied:true` 表示有效引用已被原生进程载入，不是上游接受鉴权的证明。重连失败可以是 `succeeded, applied:false`；保存值保留，可重新应用。

`requireIdle` 对活动任务、审批、工具请求、App 授权和未完成 OAuth 等占用直接拒绝本次更新，并非自动排队等待。重启作用于所有会话共用的 Codex App Server；线程持久历史保留，运行中的加载状态和 App 授权需重新建立。

OAuth 独立使用 `mcpServer/oauth/login` 和原生 file 存储，不套用此处 Bearer vault 的存储结论。stdio 不属于该托管私密入口。

完成状态：本次分析与落盘已完成；无产品代码改动，无待处理阻塞。后续若要求零重启轮换，需要单独授权并验证原生协议能力。
