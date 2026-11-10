# Provider 内存配置改造进度

## 启动与范围

已核对目前仍写文件的路径：Provider CRUD、网关默认模型、全局默认及托管凭证引用；目录、启动凭证校验和线程恢复也依赖原生 config/read。当前固定 Codex 0.165.0，个人目录隔离保留。

本轮先验证原生线程覆盖能否完整替换旧文件 Provider 定义，再接入统一内存快照。已有文件暂不删除，个人 Codex 不重启。证据将保存到 `evidence/`。

## H1：原生语义与内存快照——完成

- 固定 Codex 0.165.0。原生线程 `config` 覆盖会合并同名磁盘 Provider，不能靠传入部分字段清除旧认证。运行前新增同名磁盘定义检查，发现冲突时拒绝执行；旧配置通过显式一次性维护迁移。
- 新增 `ProviderRuntime`：不可变快照、版本比较、活动任务版本租约及旧版本回收。Web Provider、默认模型与推理设置在 RAM 中发布，原生 MCP 等文件配置保持原管理路径；禁止混合存储编辑。
- 原生诊断 SQLite 即使 `RUST_LOG=off` 也会记录请求地址，已将新模式的诊断目录移到私有 tmpfs，退出清理；没有可用 tmpfs 时明确报错。
- 早期探索失败保留于 `evidence/native-overlay/runtime-isolation-failure.json`，用于记录发现覆盖合并问题的过程；最终产品路径通过后述完整测试，不以该探针代替验收。

## H2：所有 Provider 入口与任务参数——完成

- Provider CRUD、目录探测、网关默认、全局默认、会话创建/恢复/切换统一读取内存快照；不写 `config.toml` 或网关 Profile。
- 每轮请求在准备前绑定配置版本；活动任务保留原参数，下一轮获取新快照。相同请求 ID 重试不因配置变化再次运行，保存的运行上下文只有版本及会话选择，没有 Provider 定义。
- 空闲线程使用原生卸载/恢复应用新地址或 Provider，保持同一线程 ID、历史和 App Server PID；其他活动会话不中断。
- 修复保存的会话推理强度未带到下一轮的问题，以及“恢复模型默认”仍沿用旧强度的问题；真实请求已验证重置生效。

## H3：重启恢复与凭证边界——完成

- 可从 `NEWBOT_RUNTIME_CONFIG_URL` 获取可信配置，支持认证 Token、响应限制、超时及显式重新下发。启动获取失败使用空目录并保留历史；运行中刷新失败保留上一版。
- Bridge 重启不从旧文件/备份/SQLite 重建 Provider。恢复来源须重新下发；缺失配置的历史会话仍可读，继续执行时明确提示恢复原网关。
- 加密凭证与配置独立。相同 Provider ID、地址、协议和认证约定重新下发后，可恢复唯一匹配的密文绑定；改变接收方、歧义或失效状态不自动领取旧密钥。
- 新增、轮换、清除及重新载入环境变量凭证仍需要空闲时受控重连。这是凭证载入边界，不将明文放进线程参数来声称零重启。

## H4：Web、下发 API 与现有实例切换——完成

- 新增受登录、Origin 与字段白名单保护的配置查看、完整下发与来源刷新 API；浏览器只收到脱敏目录、可用状态和版本。
- 页面显示内存/来源状态；历史会话引用的缺失网关可直接编辑，沿用原 Provider ID 恢复。修复 `gateway/save` 误走控制接口的问题。
- 桌面/移动端及深浅主题截图见 [桌面网关](evidence/ui/memory-gateway-desktop.png)、[移动端缺失配置](evidence/ui/memory-empty-mobile.png)、[浅色设置](evidence/ui/settings-1440-light.png)。已人工检查截图，无溢出。
- 实际测试服务已备份、空闲检查并切换到新构建：[切换结果](evidence/service-result.json)。服务可在 `http://127.0.0.1:3100` 使用；2 个旧网关只导入本次 RAM，活动实例配置中无 Provider/default。后续重启不会再次导入备份，需页面或来源重新下发。
- 17 个原生历史线程逐个可读，18 条 Web 会话索引和 45 条任务记录未改变，现有登录密码未变；切换前后个人 Codex 配置摘要相同，个人客户端未重启。备份仍在实例私有目录。
- 用真实浏览器登录实际服务，确认 Cookie/本地 Origin、内存设置页和 2 个网关可用：[浏览器结果](evidence/live-browser.json)。未发送模型任务，未改变公共隧道。

## H5：验证与回归——完成

| 验证                   | 结果与证据                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型检查、完整构建     | 通过，见 [构建日志](evidence/build.log)                                                                                                                                            |
| 自动测试               | 337/337 通过，见 [测试日志](evidence/tests.log)；13 项新增内存模式测试，既有原生文件适配器契约测试显式保留                                                                         |
| 固定版真实原生产品路径 | 12 组通过，见 [原生结果](evidence/provider-memory-native.json)：实际 A/B/C/D/E 路由、模型/推理/重置、同线程历史、PID、活动快照、原生 MCP/Skill、重启恢复、磁盘冲突拒绝、一次性迁移 |
| 私密凭证原生路径       | 通过，见 [凭证结果](evidence/credential-memory-native.json)：真实 TLS 合成 Provider/MCP、加密绑定重启恢复、环境隔离、清除；明文未进入模型上下文                                    |
| 内存模式浏览器         | 16 组通过，见 [UI 结果](evidence/ui/ui-regression-result.json)：网关编辑刷新保留、零 Provider 写入/重启、缺失网关原 ID 恢复、重新下发、移动端、现有交互                            |
| 兼容浏览器回归         | App Host 14、对话恢复 15、凭证隐私 5 组通过，共 34 组；日志分别为 [App Host](evidence/app-host-ui.log)、[恢复](evidence/recovery-ui.log)、[凭证](evidence/credential-ui.log)       |
| 实例隔离               | [进程证据](evidence/live-processes.json)：独立 HOME/CODEX_HOME/SQLite，原生诊断在 tmpfs，开发客户端进程保留                                                                        |

浏览器曾在缓存条目可见而目录刷新未完成时提前按 Enter，造成一次偶发等待超时。测试已改为等待条目可选择；加载中忽略选择并阻止误发送的产品行为保留。最终浏览器结果无页面错误。

原生合成测试扫描新的持久化 Home/业务数据，没有 Provider 请求地址副本；诊断在 tmpfs。旧日志、迁移备份、原生历史与独立凭证密文仍保留，这些不是配置恢复来源。

本轮范围已完成，无开发阻塞。正式部署、真实第三方 Provider 的兼容性矩阵和上线资源验收按原约定后置；不把本地合成模型验证称为付费 Provider 端到端验证。

## SQLite 持久化与热更新：后续用户确认的当前模式

用户明确将 Provider 参数保存到 SQLite，替代上文纯内存阶段的重启清空行为。[当前计划](sqlite-plan.md) S1–S4 已完成。Provider 定义、全局默认模型/推理、网关默认及托管凭证引用统一保存；会话所选模型、推理、审批及修订号继续使用既有表。

- Schema v7 新增单行版本化配置及安全字段校验。先提交 SQLite，再发布内存快照；写入失败不改变内存、旧版本租约或活动任务参数，旧进程不能覆盖数据库新版本。损坏配置明确报错，不清空或回退。
- Web CRUD、默认参数、外部完整下发、来源重载和私密凭证引用统一持久化。启动优先读 SQLite；外部来源用于首次初始化或显式同步，不在启动时覆盖 Web 新值。
- 同线程跨 Provider、地址/模型/推理热更新、审批、活动任务快照和幂等控制保留。不写 Provider config.toml/Profile，个人 Codex 隔离不变。
- 密钥不进普通配置 JSON。加密凭证随启动恢复；用户显式选择的临时内存凭证只在本次运行有效。网关编辑器在加密可用时已默认选择加密保存。
- 修复重启检查发现的默认值清空表示差异，确保保存和恢复的快照一致；持久化校验不裁剪已有名称。SQLite 写入失败、竞争、秘密字段拒绝、损坏数据、旧库升级和重启优先级已有针对性用例。

本轮证据在 `evidence-sqlite/`：

| 检查                     | 结果                                                                                                                                                                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型检查、构建、自动测试 | 通过，343/343；[自动测试](evidence-sqlite/tests.log)、[构建](evidence-sqlite/build.log)、[最终类型检查](evidence-sqlite/final-check.log)、[持久化专项](evidence-sqlite/final-state-tests.log)                                                             |
| 真实固定版 Codex         | 12 组通过：实际合成网关路由，模型/推理重置，活动快照，同线程/PID，MCP/Skill；连续两次重启无需重新下发即可续聊；[结果](evidence-sqlite/provider-memory-native.json)                                                                                        |
| 加密凭证                 | 原生 Provider、HTTPS MCP 和环境隔离验证通过；SQLite 自动恢复定义和密文绑定，普通配置及模型上下文无明文；[结果](evidence-sqlite/credential-sqlite-native.json)                                                                                             |
| 设置浏览器               | 16 组通过，保存提示、刷新保留、空目录/原 ID 恢复、来源下发、桌面/手机/深浅主题及既有交互；[结果](evidence-sqlite/ui/ui-regression-result.json)、[桌面](evidence-sqlite/ui/sqlite-gateway-desktop.png)、[手机](evidence-sqlite/ui/sqlite-empty-mobile.png) |
| 兼容浏览器               | App Host 14、对话恢复 15、凭证隐私 5 组通过；[App Host](evidence-sqlite/app-host-ui.log)、[恢复](evidence-sqlite/recovery-ui.log)、[凭证](evidence-sqlite/credential-ui.log)                                                                              |
| 实际实例重启             | 2 个网关迁入 SQLite，连续重启两次均自动恢复；17 个原生线程可读且历史结构一致，18 条会话索引、45 条任务、密码、凭证主密钥和个人 Codex 配置未变；[结果](evidence-sqlite/service-result.json)                                                                |
| 实际实例浏览器           | 正常登录；保存提示、2 个恢复的网关、无需重新下发状态正确，无页面错误；[结果](evidence-sqlite/live-browser.json)                                                                                                                                           |

当前测试服务仍为 `http://127.0.0.1:3100`，能力为 `storage: sqlite`、`requiresResupplyAfterRestart: false`。迁移先核对实例受控备份、运行目录、默认值和审计无网关修改，再提交 SQLite 后停止旧纯内存服务；未导入个人目录或任意旧备份。备份留在实例私有目录，未改变公共隧道。

以上原生推理使用本地合成网关，实际实例验证未发送模型任务。正式部署与真实第三方 Provider 兼容性验证继续后置。
