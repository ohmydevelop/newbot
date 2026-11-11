# MCP 凭证内存传递与更新流程分析

日期：2026-11-10。问题编号：MCP-CREDENTIAL-FLOW-ANALYSIS-01。授权范围：分析当前实现，不修改产品代码、实际凭证或共享服务运行状态。

## 用户目标与判定约定

用户问题：当前 MCP 凭证如何通过内存传递，是热更新，还是写文件后重启 Agent？触发入口为 HTTPS MCP 的“设置/更新私密凭证”、重新应用及清除；普通 MCP 定义更新和 OAuth 分开判定。

实际行为以源码、当前构建产物和针对性验证为依据。预期输出需区分：凭证原值与变量引用、Bridge 与 Codex 子进程、默认 SQLite 模式与兼容原生文件模式、保存成功与载入成功。当前没有用户报告的可复现故障，不预设某个约定已被破坏。

需要核对的不变量：

1. 普通配置和线程 RPC 只携带凭证引用，不携带托管 Token 原值。
2. 只有配置引用、接收方绑定及唯一使用位置有效的凭证才能进入原生认证环境。
3. 更新/清除不打断已有任务；凭证保存与原生载入结果分别报告。
4. 只存内存的凭证可跨 Codex 子进程重连保留，但 Bridge 重启后丢失；加密凭证可恢复。

## 已知证据与因果解释

- `server/credential-management.ts:57-145`：校验配置/凭证版本和绑定 → `vault.stage` → `core.mutate` 写入随机引用 → 读回确认 → 清理旧值 → `reloadPrivateRuntime`；重连失败返回 `succeeded, applied:false`。
- `server/credential-vault.ts:317-370`：memory 存于 Bridge 的 Map/Buffer；encrypted 使用 AES-256-GCM 写入 SQLite `managed_credentials`，主密钥文件为实例数据目录的 `private-credentials.key`。
- `server/configuration.ts:244-273`、`server/extension-runtime.ts:95-118,195-207`：有 ExtensionRuntime 时，`mcp_servers.*` 写入 `extension_configuration` 并发布内存快照；没有该运行时才通过原生 `config/batchWrite` 写用户配置文件。
- `server/index.ts:94-143`：默认建立 ProviderRuntime 与 ExtensionRuntime；启动前用不含托管凭证的短时 Codex 读取配置，合并快照并校验绑定，再由 vault 提供环境变量映射。
- `server/codex.ts:104-179,521-550`：`spawn(... env: {...credentials})` 注入环境；`restart` 实际停止旧子进程并重新启动。
- `server/bridge.ts:496-530,1145-1165`：私密更新要求空闲，重载委托到 `codex.restart`；重启清理 App 运行授权，随后重新读取设置。
- `server/bridge.ts:239-265,640-667`：普通扩展定义在当前默认模式走 SQLite 快照/发现线程刷新；不能把普通定义的热更新等同于凭证轮换。

上述为源码事实；真实第三方 MCP 的认证/轮换兼容性不从代码推定。

## 同类风险清单

| 优先级 | 关联功能及共同机制 | 状态 | 检查结果与纳入理由 |
| --- | --- | --- | --- |
| 1 | MCP 新增、轮换、清除、重新应用；共享子进程环境 | 有代码证据 | 保存与清除均受控重启；`/api/credentials/apply` 亦重连。需要新进程领取环境，不是原进程变量热替换。 |
| 1 | 活动任务、审批、工具调用、OAuth；共享 App Server | 有代码证据 | `requireIdle` 检查这些占用，私密操作维护期排斥新操作，避免更新中途杀死任务。 |
| 1 | 接收 URL/Header 改变或引用复用；绑定校验 | 有代码证据 | `current` 校验 binding 与引用唯一性；运行前 `ensurePrivateBindings` 可停止失配的旧进程。 |
| 2 | Provider 凭证；共用 vault 和 reloadPrivateRuntime | 有代码证据 | 同样通过受控重连领取；非敏感 Provider 参数的线程热更新是另一条路径。 |
| 2 | MCP 定义/启停；共用 ExtensionRuntime | 有代码证据 | 默认写 SQLite，通过发现线程和目标线程快照应用；兼容模式使用原生文件及 MCP reload。 |
| 2 | Codex 子进程重启与 Bridge 重启；凭证状态所有者 | 有代码证据 | memory Map 属于 Bridge，重启子进程保留，重建 Bridge 丢失；encrypted 从持久化库恢复。 |
| 2 | 保存成功但重连失败；分阶段提交 | 有代码证据 | 值和引用保留，返回 applied:false，不能据此宣称上游认证成功。 |
| 3 | stdio 私密环境；不同消费机制 | 不适用 | 托管 MCP Bearer 入口只接受 HTTPS 且排除 command，不提供通用 stdio 私密注入。 |
| 3 | MCP OAuth；原生认证缓存 | 有代码证据 | 原生 `mcpServer/oauth/login`，启动强制 `mcp_oauth_credentials_store="file"`，不等同于本次 Bearer vault 路径。 |
| 3 | 第三方服务认证是否实际成功 | 待验证 | 不使用用户真实 Token 或请求第三方服务，本次不把载入标志当作真实认证证明。 |

## 范围、顺序与后续计划

本次仅建立流程解释和证据记录，不实施修复，不改配置，不重启共享实例，不扩展为零重启认证改造，无数据迁移。

1. 完整读取关键源码、当前文档及相关历史线索，区分新默认和旧兼容路径。
2. 核对运行入口和构建产物包含的实际分支；只输出路径/布尔值等非敏感元数据。
3. 运行既有凭证专项测试，验证内存/加密保留、保存与清除、冲突与失败边界。测试替身与真实原生证据分别说明。
4. 更新同目录进度文件与结论，用源码定位回答用户。

若后续明确要求零重启轮换，先验证固定原生协议是否支持进程内凭证替换、连接重建和删除撤权；不以把 Token 写入线程配置作为当前分析的隐式实施方案。

## 可观察验收与完成状态

- 能逐步指出私密输入 → vault → 引用持久化 → 进程启动环境 → MCP Bearer 消费的路径。
- 明确当前默认是否写 config.toml、究竟重启哪个进程，以及两种保存方式的重启恢复差异。
- 给出普通定义、凭证、OAuth 的机制差异，保存与应用失败的可观察结果。
- 既有专项测试结果和运行入口核对记录写入 `mcp-credential-flow-analysis-progress.md`，不引用历史通过记录代替当前验证。

状态：分析完成。已核对当前运行入口与构建分支，既有专项测试 45/45 通过，具体证据和验证边界见同目录进度文件。尚未进行真实第三方认证测试或在共享实例上更新凭证；不属于本次分析的阻塞。未实施产品修复。
