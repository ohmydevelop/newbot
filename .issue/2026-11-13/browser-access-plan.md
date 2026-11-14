# BROWSER-ACCESS-20261113：Browser 已启用但浏览器工具拒绝访问

## 用户目标与触发
用户请求浏览器访问 https://grok.com/ 并截图，后续要求解决连接问题。用户说明使用 Chromium，并提供 Settings > Browser 的开关已开启截图。截图原件留在本聊天附件，不改写或替换。
实际：createBrowserTab、listBrowsers、getState 均返回 Local browser use is disabled in Work settings；重置工具会话后依旧如此。预期：在平台与权限允许时能够发现浏览器、打开网站并返回真实截图。约定：界面启用状态、持久化配置与有效权限应一致；若被另一层限制，诊断应区分限制来源。

## 已知证据与根因边界
- 截图确认内置 Browser 开启；config.toml 中 browser、chrome、unified-computer-use 均 enabled=true。
- Chromium 已安装 ChatGPT 扩展 1.26.1102.11740；NativeMessagingHosts 配置及其目标可执行文件存在。这不证明扩展当前已连接或所有策略均允许。
- 同安装版本 browser-service.mjs 的该报错位于 browser/access 响应校验：先验证签名，再比较响应是否与当前 executor/session/turn/nonce 的 allowed:true 完整载荷相符。说明该文案不等于 Browser 插件开关关闭。未直接读取或伪造受保护响应；不能把代码推断当作观察到 allowed:false。
- 当前日志有 Local Work executor 启动时复制文件 ENOENT，但随后 attempt=3 已 connected；无证据证明这是持续浏览器拒绝的原因。
- 官方 Linux 文档说明 Computer Use 尚不支持 Linux 预览版；浏览器扩展文档列举 Chrome/Edge/Brave/Opera/Vivaldi，未明确 Chromium。不能用这两点直接证明本次签名校验拒绝的唯一来源。
- 未确认：当前 Work 浏览器访问授权、账号/工作区策略、当前聊天的授权刷新状态；缺少可读取/修改这层权限的受支持工具。

## 同类风险
| 关联入口 | 共同机制 | 状态与依据 |
|---|---|---|
| 内置浏览器打开标签、列浏览器、状态查询 | 浏览器访问前授权校验 | 已复现；三种 API 都返回相同拒绝，重置不改善。 |
| Chromium 扩展控制 | 同一发现入口与权限门槛，后续还需扩展/native host | 有代码证据；安装链存在，实际连接待验证。 |
| 应用启动与 Work executor 重连 | executor 身份及能力同步 | 待验证；启动日志最终恢复，尚不能归因。 |
| 网站域名权限、登录、CAPTCHA | 只有通过连接才能进入 | 不适用当前故障；请求未到网站，不调整网站设置。 |
| 全局上传、下载、所有网站权限 | 与本次截图任务无必要关系 | 不适用；不扩大权限。 |

## 实施顺序与范围
1. 保存只读诊断证据（完成）。
2. 通过受支持的设置页面核对 Work 本地浏览器权限及当前工作区；当前无对应工具，需用户提供该页面或设置侧栏截图确认实际入口。不能猜测菜单或通过改代码绕过授权校验。
3. 按官方扩展排障流程，在用户新建的本地 Codex/Work 聊天验证浏览器，区分旧聊天状态和全局故障；新建用户聊天需用户明确操作/指示。
4. 只有发现具体可修复配置后才备份并调整必要项；保留登录状态、浏览器配置和正常任务。不盲目重装、升级整机、删除缓存，不修改签名校验或移除权限门槛。
5. 经正常授权后，用 cua_repl 发现浏览器并打开 Grok、截图；如网站另有登录/验证问题，单独记录。
依赖：有效平台支持、Work 授权和浏览器连接。数据兼容：无需迁移账号、cookies、会话或仓库数据。

## 验收与状态
- 原路径验收：实际打开 Grok 并输出真实截图。
- 关联入口验收：listBrowsers/getState 能返回有效浏览器；明确用户选定的 Chromium 是否连接。重建工具会话后可重复成功。
- 状态：调查完成一阶段，修复未完成；未修改系统/产品配置。阻塞为 Work 访问授权校验未通过且当前没有其受支持的管理接口。
- 证据：evidence-browser-access/；进度：browser-access-progress.md。

官方参考：
- https://learn.chatgpt.com/docs/linux/linux-app
- https://learn.chatgpt.com/docs/chrome-extension
- https://learn.chatgpt.com/docs/enterprise/cloud-local-access （仅企业工作区适用，不推定用户属于企业）

## 更正：当前界面为 Codex

用户明确纠正当前操作的是 Codex。不得根据报错中的 Work settings 推定用户正在 Work 模式，或要求用户寻找未经确认存在的 Work 设置页。

新增运行证据：当前工具命令父链为桌面 ChatGPT 进程 → 打包 codex 进程 → shell；该 codex 进程确实带有三项 BROWSER_USE_ACCESS_* 授权上下文变量（仅记录存在性，不保存值）。unified-computer-use 插件的 .mcp.json 明确将这些变量传入 cua_repl，并加载 require-browser-access.mjs。浏览器授权检查适用于当前实际加载的工具，固定报错措辞不能用于判定产品模式。尚不能认定变量被错误注入、工具错接 Work 或存在可安全修复的本地配置错误。

撤回“需提供 Work 设置页”作为必经操作。后续应核对当前 Codex 的浏览器授权状态/官方工具集成，若需要界面证据，使用用户实际 Codex 设置入口。授权响应拒绝的具体原因仍未确定；不修改或删除授权上下文来规避检查。Grok 访问与截图仍未完成。

## 第三轮：Codex 会话授权调用链定位（只读分析）

### 已确认链路
当前 Codex 工具子进程携带 `native-browser-plugin` 类型标记，界面截图和持久化插件开关均已开启。实际生产运行库为 `/usr/lib/chatgpt/resources/cua_node/lib/node_modules/@oai/browser-desktop/scripts/browser-service.mjs`，其 service 导出已核对。

调用链：cua 浏览器入口 → runtime `browser/access` 请求（当前 executor/session/turn/nonce）→ 桌面主进程 `cK` → `readLocalWorkBrowserAccess` → `nativeBrowserThreadAccess.getExecutorId(sessionId)` → `sz` 的主体身份/有效模式检查，必要时才进入 executor 的 Work 授权 → 签名返回 → 客户端通用报错。

安装包 app.asar SHA256：`1588e6a0e1dcfc615060152ef264d4adf2c3ff6bb7496986c72163b5853e2a2e`。Craft Anything CLI 静态恢复证据 `ev_1b167aab984f2cacd773ac7b02dcb1cca7925bdad7008895e129fc01e48f1ed3`；只格式化，没有执行应用代码。

### 定位到的判断与缺口
1. `readLocalWorkBrowserAccess`（恢复文件 439，166489 行）：通用 native 标记先查会话映射，查不到立即 false，尚未读取 Work 设置。
2. `sz`（439，5780 行）：当前主体匹配且有效模式不是 Work 时直接放行；不是所有 Codex 请求都读 Work 开关。因此此前“再开 Work 设置”的指引不成立。
3. `AE`（439，54555 行）：仅监听 thread/start、thread/resume、thread/fork，仅从 config["mcp_servers.node_repl"].env 获取身份；响应后按 sessionId/id 保存，已有键不覆盖。存在“未登记”和“首次登记身份陈旧”的代码风险。
4. `connectionClosed` 只清 pending，不清 executors；工具 js_reset 也不重建桌面主进程中的这张表。解释了为什么只重置工具不一定改善，但不证明当前表一定异常。
5. `thread/startAeon` 不在上述监听集合，turn/addUserMessage 在发送观察中被跳过，是共享机制的覆盖缺口。当前聊天元数据只有 paginated、Codex Desktop；不足以证明当前走 Aeon，因此不作为当前根因。
6. 通用报错把未登记、身份不匹配、有效 Work 权限拒绝、executor 未就绪/身份不匹配等情况折叠成同一句话。GPU、网络、Grok、Chromium 页面均不在已触发的失败层。

### 同类风险与优先级
| 顺序 | 机制/关联入口 | 状态 | 证据与边界 |
|---|---|---|---|
| 1 | 当前聊天 native 会话映射缺失 | 待验证（优先假设） | 使用 native 标记已观察；缺失即拒绝有代码证据；当前 Map 内容未读取。 |
| 2 | 旧会话/登录主体变化后首次登记被保留 | 有代码证据、现场待验证 | AE 的 first-write-wins 与重连只清 pending；没有用户切换账号的证据。 |
| 3 | 创建/恢复/分叉的配置入口 | 有代码证据 | 只读取 node_repl 一处配置；遗漏该配置时不登记，新入口依赖相同机制。 |
| 4 | Aeon 创建与 addUserMessage | 有代码证据、当前适用性待验证 | 新方法不在登记监听范围；不能因模型名或 paginated 推定 Aeon。 |
| 5 | 有效模式与界面 Codex 不一致 | 待验证 | 判定读取 settings.getEffective(conversationDetailMode)，存在策略来源；没有当前值的受支持读取接口。 |
| 6 | Work executor 短暂复制失败 | 已观察恢复、排除为已证实持续原因 | 日志 attempt=3 已 connected，不足以解释 native 登记失败。 |

### 后续验证及修复设计
- 先为授权处理增加受支持的原因诊断，区分 missing_session_mapping、principal_mismatch、effective_work_denied、executor_not_ready，不记录账号/令牌；当前只提出方案，不修改已安装应用。
- 原聊天与用户明确新建的本地 Codex 聊天对照，使用正常工具 getState/listBrowsers；不改变权限门槛。如果仅旧聊天失败，优先验证恢复登记；两者均失败，再核对主体及有效模式。对照本身不等于最终根因证明。
- 修正方向应是同一会话授权登记机制覆盖创建/恢复/分叉及实际使用的新入口，在重新认证时刷新合法身份，保持跨账号/迟到响应的拒绝约束；不要把所有拒绝改成允许。
- 验收需覆盖原聊天、正常新聊天、恢复、账号变化、迟到响应；权限允许时可访问 Grok 截图，不允许时继续拒绝且给出准确原因。没有数据迁移需求。

本轮状态：实现定位分析完成；具体现场分支仍待验证，修复未实施。限制是当前支持接口没有暴露主进程登记表、有效模式及拒绝理由；日志也未记录这些值。不得把优先假设写成唯一根因。

## 第四轮：恢复路径反证与现场边界

本轮继续只读分析，不扩大为安装包修改。应用受支持的 `mcp__codex_app__read_thread` 返回当前聊天 `kind=codex`、`hostId=local`、状态 active。这是应用元数据证据；不等同于授权处理器实时读取的 effective mode。

新增静态证据：`static-round4/manifest.json` 和 `readable-round4/`，Craft 证据 `ev_84a8d868abb1003866892ba725b3b069fcaf72d640a57f5fe2f8ab5a26ec98e6`。只读取并格式化安装包 `.vite/build/early-bootstrap.js`，未执行目标代码。

1. 主文件 11249 模块（恢复后 11154 行）会逐项保留 `fetchCodexConfig` 返回的配置；没有过滤 `mcp_servers.node_repl`。
2. 主文件 16109 模块的 `u_`（4363 行附近）对应 transport 的 `q.u_h`，仅按版本移除 `features.multi_agent_v2.wait_agent_enabled`；不会移除浏览器身份配置。
3. 439 文件 34304 行的恢复优化：只有没有有效非 feature 配置等条件全部满足，才可能省略 config。若 node_repl 身份配置存在，`eD=true`，该优化不能省略它。因此不能将“普通旧聊天恢复自动丢掉身份”定为根因。
4. 普通恢复流程在 439:33942 调用 `thread/resume`，属于 AE 监听范围。`paginated` 不意味着跳过恢复或必走 Aeon。
5. 独立 daemon 的 loaded-threads 快照不含当前聊天，但当前工具父链指向桌面启动的 codex 进程，故该清单不能作为当前授权登记缺失的证据。daemon 的单条 HTTP 会话删除错误也不能建立本次授权拒绝的因果关系；不保存其他聊天标识。

同类风险补充：普通恢复的参数合并与版本兼容过滤已检查，有代码证据表明上述两个转换保留身份；现场实际请求是否带身份仍待验证。Aeon 不在 AE 监听范围仅说明该监听器的覆盖边界，尚未证明对应入口一定需要这张表，不宣称所有 Aeon 聊天有故障。

下一步最小验证：同应用新建本地 Codex 聊天，通过正常浏览器工具访问 Grok，对比当前聊天的拒绝。已向用户请求这个结果。若新聊天正常，缩小到当前会话登记/恢复状态；若同样失败，扩大到应用主体/有效模式/共享授权。两种结果都不能单独证明具体分支，仍需受支持的拒绝原因诊断才能闭合根因。

本轮完成：恢复配置链分析和诊断证据落盘。未完成：现场拒绝分支、新旧聊天对照、浏览器实际连接及 Grok 截图。未改配置、未重启、未修补权限校验。

## 第五轮：用户反馈新聊天同样拒绝

2026-11-13，用户对第四轮对照问题明确回复：“新聊天也报同样错误”。证据来源为本聊天异步问答；属于用户报告，尚未直接读取新聊天的工具输出、请求配置或主进程登记表。

对判断的影响：故障范围至少涉及用户测试的新旧两个聊天，不再优先采用“仅原聊天登记陈旧”解释。共享登记机制对所有新会话漏登、主体不匹配或全局有效模式/访问策略仍待验证。同一通用提示可能来自不同分支，因此不能证明两个聊天根因完全相同，更不能证明全部账号或全部聊天均受影响。

同类风险状态更新：新建聊天入口为“用户报告复现”；普通恢复身份配置保留仍为“有代码证据”；共享主体/有效模式/会话映射均为“待验证”。新旧聊天对照已完成用户反馈环节，不再要求用户重复新建聊天。

后续步骤：通过受支持诊断取得 native 会话映射是否存在、主体是否匹配、有效模式及最终拒绝类别（只记录布尔值/类别，不记录身份或凭据）。现有接口和日志没有这些现场值；这是剩余定位阻塞。Craft MCP 注册及独立握手已完成，但当前聊天工具清单仍未加载它，且其安装本身不能修复浏览器权限或证明能读取受支持的授权诊断。

状态：本轮反馈已纳入，浏览器根因未闭合、未修复、未完成 Grok 截图。后续验收仍须新旧聊天在合法授权条件下实际成功，且拒绝路径能准确解释原因。

## 第六轮：持续测试与修复授权

用户明确要求“持续测试并解决这个浏览器访问问题”，授权针对该问题的必要测试与具体配置修复。流程：复测正常 CUA → 核对配置、运行时和本地策略 → 运行打包 Codex 的受支持 doctor 诊断 → 只针对证据明确的配置问题备份修复 → 正常 CUA 回归并访问 Grok 截图。若需要应用重启，先保存记录并检查是否会中断其他运行任务。不得以删授权变量、修改签名/策略判定或另起无门禁自动化方式替代修复。

新增事实：正常 cua.getState 再次返回同一拒绝；桌面主进程仍为 PID 3191，未经历此前建议的重启。用户 config 的 desktop 表未设置 conversationDetailMode；安装代码默认 STEPS_COMMANDS，运行时仍可能受到策略覆盖，因此这不能证明有效模式。/etc/codex/requirements.toml、~/.codex/requirements.toml 和项目 .codex/config.toml 均不存在；未发现这些路径下的浏览器禁用策略。启动环境未设置本地 daemon 或桌面能力覆盖变量。

检查范围：共同授权层、正常插件配置、启动/恢复一致性。原有配置及账号数据保留；没有需要迁移的数据。本轮新增诊断结果和实施状态写入同目录进度与证据文件。

## 第七轮：重启后的验收与阻塞

完整重启已执行成功，restart-result-round6.json 记录 supervisor PID 3099 → 46356，退出码 0；桌面主进程 3191 → 46392，服务 active/running。重启后正常 cua.getState 仍返回 Work settings 授权拒绝，故“单纯完整重启可修复”验证不通过。Craft Anything MCP 的 core_investigation_show 与 core_session_show 已通过真实连接调用；该 MCP 连接任务已完成，但浏览器未恢复。

新增检查：新桌面日志针对当前聊天记录 Conversation state not found；代码位于 439:28113 的 updateConversationState，操作的是 conversations Map，未证明它与 nativeBrowserThreadAccess Map 相同或有因果关系。读取 logs_2.sqlite 时只筛当前聊天；WARN 为技能图标路径、一次 attestation 超时，未找到该聊天的 browser/mcp 授权原因日志。检查范围明确限于此日志数据库，不声称所有日志均无原因。

升级可行性检查：对官方 Linux 文档链接的 latest/chatgpt_amd64.deb 作 HEAD 请求返回 HTTP 403；未取得新版版本信息，未下载、安装或尝试绕过限制。不将旧仓库缓存版本视为最新版本，不将升级宣称为已验证修复。

剩余阻塞：用户已启用 Browser、新旧聊天均失败、完整重启无效、本地文件和基础配置/登录连接正常，但现有受支持接口未给出 browser/access 的具体拒绝类别。下一步需要产品侧诊断 missing session mapping / principal mismatch / effective Work permission denied / executor mismatch，或供应商明确修复该版本问题的正式版本。不能通过反复同条件重试、清空用户数据或放宽授权校验来补齐证据。

状态：浏览器故障未修复，Grok 截图未完成。后续需新证据再继续针对性测试；保留现有权限和配置。
