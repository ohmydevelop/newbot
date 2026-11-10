# 测试服务更新记录

日期：2026-11-08。用户要求先重启服务确保运行最新版本，再继续 D3.3。此记录属于现有测试实例更新，正式部署与上线统一验收仍留到 R1。

## 数据与服务更新

现有 `newbot-test.service` 使用专用 Node 26.12.0 和当前 `dist/server/index.js`，工作目录保持项目根目录。先重新构建，再确认没有活动任务、审批、App 待授权或 OAuth，进入维护状态，执行 SQLite 一致性备份并复制服务端环境和 Codex 配置备份，随后通过 systemd 重启。

首次更新将数据库从 Schema v1 升级到 v3。12 个会话、2 个附件、19 条请求记录的数量保留，SQLite `integrity_check` 为 `ok`。密码摘要未变，重启前创建的 Session 在重启后仍有效，未吊销其他有效登录。未执行模型任务，也未更改现有 Provider/MCP 定义。

最初 v1 数据备份位于 `.data/restart-backups/2026-11-08T05-54-59.675Z/`。后续更新前继续保存独立备份。备份目录 0700，数据库、环境与凭证文件 0600；备份内容不经 Web 下发。验证结果在 `.data/restart-latest-result.json`、`.data/restart-latest.log`、`.data/restart-build.log`。

运行时确认包含 Provider Web 管理、版本化默认模型编辑、PDF 预览和已保存会话；D3.3 完成后已将 MCP 管理同步到同一服务，最新进程也已确认 `mcpManagement.configuration = true`。重启后核对新进程 PID、readiness、版本能力、数据库完整性、会话有效性及首页资源加载。

## 分享入口恢复

检查发现旧的两个 Cloudflare Quick Tunnel 进程均已退出，原临时 URL 不再可用。保留本地服务和密码，重新建立主页面与 App 的独立入口，并更新 `.env` 的 Origin 配置：

- 主页面：<https://backing-watch-yields-ranks.trycloudflare.com>
- App 沙箱：<https://recreation-sum-loose-tried.trycloudflare.com>

主页面未登录访问配置 API 为 401，使用原密码可以登录并读取最新能力；App 域访问主配置 API 为 403。服务端有效 Session 保留，但新域名的浏览器需要重新登录。没有取消密码验证或允许 App 域访问主站 API。

临时隧道由独立后台进程运行，日志为 `.data/cloudflare-web-current.log`、`.data/cloudflare-apps-current.log`，PID 文件沿用原路径。临时 URL 的生命周期与后台隧道一致，固定域名、长期发布和完整 Cloudflare 验收仍留到 R1。公网验证记录为 `.data/restart-public-result.json`。实际共享服务的浏览器也已验证 MCP 管理入口、懒加载资源及 CLI 测试连接的只读状态，见 `.data/service-latest-ui-result.json` 与 `.data/service-latest-mcp.png`。

## D3.4 同步

D3.4 统一配置恢复也已构建并更新到同一测试服务，能力 `configuration.recovery = true`。本次更新前再次备份，仍为 Schema v3，12 个会话、2 个附件、19 条请求记录、密码与有效 Session 均保留，数据库完整性检查通过。公网已验证恢复读取、密码保护，以及 App 域无法调用恢复控制接口。实际页面的恢复区、草稿保留与明确采用当前配置也已复核，测试使用主动构造的冲突 revision，没有改动原生配置；证据为 `.data/service-latest-recovery-result.json` 与 `.data/service-latest-recovery.png`。

## D4.1 同步

App 生命周期已构建并同步到同一测试服务，能力 `mcpAppLifecycle.leases = true`。更新前确认任务和审批空闲、进入维护并执行一致性备份；备份为 `.data/restart-backups/2026-11-08T07-58-06.283Z/`。更新后进程 PID 为 1579020，readiness 和首页资源加载通过。Schema 仍为 v3，12 个会话、2 个附件、19 条请求记录、密码及重启前的有效 Session 均保留，SQLite 完整性为 `ok`。

使用已有 `newbot_test / show_metrics` 的真实 Codex 历史，仅执行历史读取、工具目录发现与 UI 资源读取，验证原始参数/结果关联、独立 App origin、View 的 Session 归属、关闭后旧 HTML 和工具授权入口失效、重新打开生成新 token 且原始结果一致，以及登出撤销资源。没有创建模型 Turn 或执行 MCP 工具。主站公网仍要求密码，App 域不能访问生命周期控制接口；记录为 `.data/mcp-lifecycle-live-result.json`。

通过现有 Cloudflare 主页面加载同一历史，实际官方 SDK App 完成初始化并显示模拟监控结果，关闭/重开恢复原始指标；该浏览器检查同样不调用模型或 MCP 工具。证据为 `.data/service-latest-app-lifecycle-result.json` 与 `.data/service-latest-app-lifecycle.png`。本次没有改变原有 Provider/MCP 定义或分享域名；完整发布验收仍留到 R1。

## D4.2 同步

Host 能力声明与受限请求处理已构建并更新到现有测试服务。重启前完成空闲/审批检查、维护锁与一致性备份，备份为 `.data/restart-backups/2026-11-08T08-18-07.569Z/`。更新后进程 PID 为 1585285，readiness、首页资源与 `mcpAppHost.version = 1` 均通过；日志、消息等未实现能力明确为关闭。Schema 仍为 v3，12 个会话、2 个附件、19 条请求记录的数量、密码及重启前有效 Session 保留，SQLite 完整性为 `ok`。

真实 Codex 历史读取确认每个 View 返回的新策略、工具单次批准及关闭/重开边界。Cloudflare 浏览器实测捕获实际 `ui/initialize` 响应，确认标准能力与服务端策略一致；“权限与能力”可展开并显示本次打开的 `show_metrics` 范围。由该 View 发出的外链请求返回明确失败，宿主显示固定原因，连接保持可用，随后关闭/重开仍恢复同一原始结果。该流程未创建模型 Turn 或执行 MCP 工具，也未更改 Provider/MCP 定义。

开发验证为 137 项自动测试、14 项新增 Host 浏览器检查、19 项生命周期回归和既有 SDK 交互；共享实例证据为 `.data/service-latest-app-host-result.json`、`.data/service-latest-app-host.png`、`.data/mcp-lifecycle-live-result.json` 与 `.data/d4-2-native.log`。两个 Cloudflare 临时域名沿用原值；正式部署与上线统一验收仍留到 R1。

## D4.3 同步

普通 MCP Elicitation 表单已完成构建并同步到同一测试服务。最终修正包含响应通道断开时的未确认处理，避免把未送达的超时响应显示成已确认取消。重启前完成空闲/审批检查、维护锁和一致性备份；最终备份为 `.data/restart-backups/2026-11-08T08-48-18.386Z/`，新进程 PID 为 1595839。

本次维护前数据库已包含 12 个会话、2 个附件、22 条请求记录，重启后这些数量保留；Schema 仍为 v3，密码及重启前有效 Session 保留，SQLite 完整性为 `ok`。没有更改 Provider/MCP 定义，也没有把新的表单测试 MCP 自动加入分享实例。

Cloudflare 主站已确认 `elicitation.forms = true`，最长等待 300 秒，私密输入与 URL 模式保持关闭。有效登录发送已失效输入请求得到 410；未登录读取能力为 401；App 域读取能力或调用输入响应入口为 403。本次公网验证未执行模型或 MCP 工具，证据为 `.data/elicitation-service-result.json` 与 `.data/d4-3-public.log`。

开发验证共 152 项自动测试、15 项新增输入浏览器检查、14 项 Host 回归及既有 SDK 交互通过。独立 Codex Home 中真实 stdio MCP 的接受、取消、拒绝和超时四条路径均完成原始工具调用，没有模型请求，证据为 `.data/elicitation-native-result.json`。输入界面和恢复证据在 `.data/elicitation-ui/`；普通输入范围见 [D4.3 记录](mcp-elicitation.md)。私密输入继续留在 D6，正式上线统一验收继续留在 R1。

## D4.4 同步与 D4 完成

并发授权位置、协议取消及授权框焦点恢复已构建并同步到同一测试服务。等待授权的 App 请求不再叠加确认框，取消后清理未消费 grant；批准后的调用仍可能继续。明确重试时清除上一次操作的提示。

更新前完成空闲/审批检查、维护与一致性备份。备份为 `.data/restart-backups/2026-11-08T11-40-08.492Z/`，更新后 PID 为 1623997，readiness、首页资源和能力检查通过。Schema 仍为 v3，12 个会话、2 个附件、22 条请求记录、密码及重启前有效 Session 保留，SQLite 完整性为 `ok`。没有修改现有 Provider/MCP 定义或分享域名。

已有真实 Codex 历史的读取、关闭/重开和 Session 归属验证通过。Cloudflare 页面进一步使用既有模拟监控 App 发起请求，在批准前发送标准协议取消；实际授权框关闭、未消费 grant 撤销、重放返回 410，View 保持连接，重新打开仍恢复原始结果。没有提交工具批准或模型任务。证据为 `.data/service-latest-app-regression-result.json`、`.data/service-latest-app-regression-cancel.png` 与 `.data/d4-4-shared-ui.log`；真实历史接口记录为 `.data/d4-4-native-history.log`。

开发验证为 152 项自动测试、18 项新增官方示例浏览器检查及 48 项相关回归，合计 66 项相关浏览器检查通过。官方 Server/HTML 未修改，真实独立 Codex/MCP 执行工具与资源，聊天历史仅在测试夹具重放；具体边界见 [D4.4 记录](mcp-app-regression.md)。官方测试 Server 没有加入分享实例。D4 阶段完成，下一批 D5.1；正式部署和完整上线验收仍留到 R1。

## D5.3 同步

A2UI 原生动态工具、聊天表单和服务端操作回传已构建并同步到同一测试服务。更新前检查任务、审批及表单空闲，进入维护并完成一致性备份：`.data/restart-backups/2026-11-08T14-09-31.640Z/`。更新后 PID 为 1655730，Schema 保持 v3，12 个会话、2 个附件、22 条请求记录、密码及重启前有效 Session 保留，数据库完整性为 `ok`。没有更改现有 Provider/MCP 配置。

新能力 `a2ui.available = true`，线协议 v0.9、固定 Catalog `newbot:ui/v1`，目前只对新建线程注册。旧线程没有自动迁移或分叉；`historyRestoration = false`、私密输入关闭。后续 Bridge 重启后的 UI 历史恢复在 D5.4 完成。

Cloudflare 原入口已核对：匿名读取能力为 401，原密码登录后可读取新能力和四项首页/按需表单资源，App 域访问主能力接口为 403。该检查没有创建共享模型 Turn 或执行 MCP 工具；证据为 `.data/a2ui-agent/public-result.json` 和 `service-update.log`。

功能验证为 194 项自动测试、73 项相关浏览器检查，以及隔离数据目录下真实 `gpt-6.1-sol` 的“生成表单—浏览器填写—同一 Turn 回答”。后端新依赖的生产审计仍有 2 项旧版 Zod 相关 high，保留 D5.2 的受限入口缓解，不声明上游已修复；详见 [D5.3 记录](a2ui-agent.md)。此同步仅更新测试实例，正式部署和上线统一验收仍留在 R1。

## D5.4 同步

A2UI 快照、服务端草稿、到期反馈、重启只读及持久化单次消费回执已同步到现有测试实例。更新前通过任务、审批和表单空闲检查，进入维护并完成一致性备份：`.data/restart-backups/2026-11-08T15-34-55.802Z/`。

本次将 Schema v3 升级到 v4，新增最少 UI 状态表；更新后 PID 为 1673787。更新时的 12 个会话、2 个附件、24 条请求记录均保留，密码摘要和重启前有效 Session 未变，数据库完整性为 `ok`。没有更改 Provider/MCP 配置。重启后恢复的旧表单不再有活动令牌，不能恢复原生提交权限。

功能验证通过 209 项自动测试、81 项相关浏览器检查和构建；隔离测试目录中的真实 `gpt-6.1-sol` 完成草稿保存及同一 Turn 表单提交。证据为 `.data/a2ui-recovery/` 和 `.data/a2ui-recovery-ui/`，行为与限制详见 [恢复记录](a2ui-recovery.md)。这次更新仍属于测试开发，正式部署和上线统一验收留在 R1。

Cloudflare 原入口也已核对：匿名能力读取为 401，原密码登录后能读取 `historyRestoration: true` 和服务端草稿能力；首页及按需表单资源共 4 项成功加载，App 域访问主能力接口为 403。检查没有创建共享模型 Turn，见 `.data/a2ui-recovery/public-result.json`。

## D6.1–D6.2 同步

2026-11-09（北京时间）：临时 Provider API Key 的受信输入、内存 Broker 和单次 HTTPS 消费已同步到现有测试服务。更新前核对任务、审批、表单和私密请求空闲，进入维护，并备份至 `.data/restart-backups/2026-11-08T16-12-42.807Z/`。

更新后 PID 为 1685289，Schema 保持 v4；更新时的 12 个会话、2 个附件、25 条请求记录、密码摘要及既有有效 Session 均保留，数据库完整性为 `ok`。现有 Provider/MCP 定义没有更改。新能力精确报告临时检查可用，而持久保存、Agent 私密请求和 sudo 仍关闭。

本批功能验证为 224 项自动测试、92 项相关浏览器检查及构建通过，默认消费者通过实际 TLS 服务收取一次合成凭证并丢弃反射结果。没有使用用户实际密钥或在共享实例创建模型 Turn。实现与范围见 [可信输入记录](trusted-input.md)，证据见 `.data/credentials/` 和 `.data/credentials-ui/`。正式部署和上线统一验收仍留在 R1。

Cloudflare 原入口已复核：匿名能力接口为 401，原密码可登录并读取受限私密输入能力，首页与 A2UI/私密输入按需资源共 5 项加载正常；App 域访问主能力接口为 403。该复核没有发起凭证操作或模型任务，见 `.data/credentials/public-result.json`。

## D6.3 同步

2026-11-09（北京时间）：Provider/HTTPS MCP 的写入后不可回读凭证保存已同步到现有测试服务。默认仅内存持有，也可明确选择加密保存；支持更新、清除、原生载入与重启恢复。sudo 和 Agent 主动私密请求仍关闭。

更新前核对任务、审批、表单和私密请求空闲，进入维护并完成一致性备份：`.data/restart-backups/2026-11-08T17-27-31.585Z/`。Schema 从 v4 升级到 v5，更新后 PID 为 1705748。原有 12 个会话、2 个附件、25 条请求记录、密码摘要和重启前有效 Session 均保留，SQLite 完整性为 `ok`。现有 Provider/MCP 定义未更改，共享实例没有写入测试凭证。

此次首次创建独立的 0600 加密主钥；后续重启备份会同时保存已存在的主钥，恢复加密凭证需要数据库与匹配主钥。本次升级前备份仍是 v4，不含新建主钥。备份与证据不经 Web 下发。

功能验证通过 241 项自动测试、124 项相关浏览器检查、类型检查和构建。隔离环境中的真实 Codex 完成合成 Provider 请求及 HTTPS MCP 工具调用，两份测试凭证未进入模型输入，普通命令和默认 stdio 子进程未继承专用凭证环境；没有付费模型调用。范围及限制见 [D6.3 记录](credential-storage.md)，证据在 `.data/credential-storage/`。

Cloudflare 原入口已核对：匿名能力读取为 401，原密码可登录并读取内存/加密保存与 HTTPS MCP 凭证能力；首页及按需资源共 5 项加载正常，App 域访问主能力接口为 403。该复核没有发起凭证操作或模型 Turn，见 `.data/credential-storage/public-result.json`。下一批为 D6.4 sudo 受控通道及 D6.5 完整日志/Trace 隔离检查；正式部署和上线统一验收仍留在 R1。

## D6.4 同步

2026-11-09（北京时间）：固定 sudo 身份检查和独立私密管道已同步到现有测试实例，并通过 `SUDO_IDENTITY_CHECK=true` 显式启用。设置中的“单次提权检查”只执行一次固定 `/usr/bin/id -u`；没有开放任意 sudo 命令、Agent 提权或保存 sudo 密码。

更新前完成任务、审批、表单和私密请求空闲检查、维护锁及一致性备份：`.data/restart-backups/2026-11-09T00-03-33.563Z/`。备份包含数据库、环境、Codex 配置/授权及匹配加密主钥；启用开关前的环境另存于 `.data/sudo/pre-update.env`。更新后 PID 为 1755119，Schema 保持 v5，12 个会话、2 个附件、25 条请求记录、0 条托管凭证的数量、密码摘要和重启前有效 Session 保留，SQLite 完整性为 `ok`。Provider/MCP 定义未更改。

功能验证为 253 项自动测试、37 项相关浏览器检查、构建及隔离用户命名空间中的真实 sudo/PAM 验证通过，见 [D6.4 记录](sudo-input.md)。宿主账号和 sudoers 未修改，没有使用用户实际 sudo 密码，也没有创建模型任务。

Cloudflare 原入口已确认匿名能力读取 401、原密码登录有效、App 域能力读取 403，首页及包括 sudo 设置/私密输入在内的 6 项资源加载正常。实际共享页面已核对安全设置中的固定检查入口；该浏览器核对没有创建私密请求或执行提权操作。证据为 `.data/sudo/public-result.json`、`service-ui-result.json` 和 `service-settings.png`。下一批 D6.5 完整输出与 Trace 隔离验证；正式部署及统一上线验收继续留在 R1。

## D6.5 同步与 D6 完成

2026-11-09（北京时间）：受信私密消费的公开输出、错误和 Trace 策略已同步到现有测试实例，`trustedInput.errorOutputVersion = 1`。HTTP 仅公开明确标记的产品错误，原生启动诊断和 MCP 流式/历史/App 失败输出使用固定提示；Trace 仅记录限定元数据，对话/运行标识使用摘要。既有凭证与固定 sudo 能力保留。

更新前完成空闲、审批、表单、私密请求检查与维护锁，备份为 `.data/restart-backups/2026-11-09T00-49-56.047Z/`，包含匹配的加密主钥。更新后 PID 为 1771760，Schema 保持 v5，12 个会话、2 个附件、25 条请求记录、0 条托管凭证的数量保留，密码摘要及重启前有效 Session 不变，SQLite 完整性为 `ok`。Provider/MCP 配置未更改。

262 项自动测试、84 项相关浏览器检查、类型检查与构建通过。独立夹具完成真实 OTLP、真实 Codex Provider/MCP 正常与失败，以及隔离 sudo/PAM 回归；没有使用用户实际凭证或付费模型。实现、证据和原生内部循环的信任边界见 [D6.5 验证记录](credential-isolation.md)。

Cloudflare 原入口已确认匿名读取能力为 401，原密码可登录并读取新错误出口版本；首页与按需资源共 6 项加载正常，App 域能力读取为 403。该复核没有创建私密请求、模型 Turn 或执行 sudo，证据为 `.data/credential-isolation/public-result.json`。D6 在受信操作范围内闭环，下一批 D7 消息/操作呈现与体验收尾；正式部署和统一上线验收继续留在 R1。

## D7.1 同步

2026-11-09（北京时间）：统一聊天内容入口、局部显示边界、轮内任务反馈、后台对话通知及只读状态恢复已同步到现有测试实例。当前对话失败不再重复显示全局错误，技能/文件预览关闭恢复焦点，普通消息与表单更新保持原 App 实例。

更新前完成任务、审批、表单和私密请求空闲检查、维护锁及一致性备份：`.data/restart-backups/2026-11-09T02-34-20.616Z/`，包含匹配加密主钥。更新后 PID 为 1838337，Schema 保持 v5；12 个会话、2 个附件、25 条请求记录、0 条托管凭证的数量、密码摘要及重启前有效 Session 均保留，SQLite 完整性为 `ok`。Provider/MCP 配置未更改。

270 项自动测试、72 项相关浏览器检查、类型检查、构建和格式检查通过，见 [D7.1 记录](chat-presentation.md)。新增夹具的模型、技能、文件、MCP App 和 A2UI 流程都与共享实例隔离，没有使用用户实际凭证或付费模型。

Cloudflare 原入口已核对匿名能力读取 401、原密码登录有效、App 域能力读取 403，以及最新 Web 入口和 6 项静态/按需资源。实际共享页面进一步只读恢复既有 Codex 历史，显示 16 个轮次、36 个新内容标记；没有创建模型 Turn、私密请求或 App 工具调用。证据为 `.data/chat-presentation/public-result.json`、`service-history-result.json` 及更新日志；记录只保留数量，不保存历史正文。

下一批 D7.2 历史、附件、取消与失败恢复；D7.3–D7.5 和正式上线统一验收仍未完成，继续按整体计划推进。

## D7.2 同步

2026-11-09（北京时间）：历史分页与列表恢复、按对话保留的内存草稿、附件批量/取消反馈，以及发送/停止未确认时的恢复已同步到现有测试实例。新增 `runRecovery.abandonUnseen = true`：只有尚未登记的发送可明确放弃，持久回执阻止同一 ID 的迟到请求执行；已有任务和旧回执不能覆盖。

更新前完成任务、审批、表单和私密请求空闲检查、维护锁及一致性备份：`.data/restart-backups/2026-11-09T03-09-15.770Z/`，包含匹配加密主钥。更新后 PID 为 1858376，Schema 保持 v5；更新时的 13 个会话、3 个附件、27 条请求记录、0 条托管凭证均保留，密码摘要及既有有效 Session 未变，SQLite 完整性为 `ok`。没有更改 Provider/MCP 定义。

283 项自动测试、87 项相关浏览器检查、构建及格式检查通过，详见 [D7.2 记录](conversation-recovery.md)。新增夹具在独立目录模拟分页、附件和请求异常，没有使用用户凭证或付费模型。

Cloudflare 原入口已确认匿名能力读取 401、原密码登录有效、App 域能力读取 403，新的放弃能力及最新 Web 入口和 6 项资源正常。浏览器只读恢复既有 Codex 历史，显示 2 个轮次、5 个内容标记；没有创建模型 Turn、私密请求或 App 工具调用。证据为 `.data/conversation-recovery/public-result.json`、`service-history-result.json`、`service-update.log` 与 `validation-result.json`，只记录数量及必要元数据。

下一批 D7.3 键盘操作、焦点、深浅主题与桌面/手机适配；D7.4–D7.5 和正式上线统一验收仍未完成。

## D7.3 同步

2026-11-09（北京时间）：键盘/输入法处理、弹窗焦点返回、手机模态侧栏、设置独立滚动及主题/图表适配已同步到现有测试实例。搜索、设置和嵌套私密输入内不触发聊天导航快捷键，手机侧栏支持 Tab 限制与 Escape 返回；跨入手机宽度时收起侧栏，避免覆盖已有弹窗。

更新前通过任务、审批、表单和私密请求空闲检查，进入维护并完成一致性备份：`.data/restart-backups/2026-11-09T03-51-12.683Z/`，包含匹配加密主钥。更新后 PID 为 1888684，Schema 保持 v5；更新时的 14 个会话、4 个附件、28 条请求记录、0 条托管凭证均保留，密码摘要与重启前有效 Session 未变，SQLite 完整性为 `ok`。Provider/MCP 定义未更改，没有增加后端权限或凭证消费路径。

288 项自动测试、129 项相关浏览器检查、类型检查、构建及格式检查通过，见 [D7.3 记录](keyboard-and-appearance.md)。新增检查使用合成历史和独立目录；sudo 回归使用测试子进程，没有读取用户实际密码或调用付费模型。

Cloudflare 原入口已核对匿名能力读取 401、原密码登录有效、App 域能力读取 403，最新入口及 6 项资源加载正常。实际分享页面只读恢复既有历史，显示 1 个轮次、3 个内容标记；同时验证搜索 Escape 回到输入框、375px 手机侧栏与焦点返回。该检查没有创建模型 Turn、私密请求或 App 工具调用，也未保存真实历史正文或截图。证据为 `.data/interaction/public-result.json`、`service-history-result.json`、`service-update.log` 和 `validation-result.json`。

下一批 D7.4 资源加载、缓存、内存增长和重复订阅检查；D7.5 功能冻结与正式上线统一验收仍未完成。

## D7.4–D7.5 同步与开发功能冻结

2026-11-09（北京时间）：资源加载反馈、旧连接隔离、状态同步防重、历史缓冲限额、空草稿清理、静态资源代次保留及发布权限已同步到现有测试实例。能力条件/关闭项契约、普通表单说明、架构与用户文档也已核对；D1–D7 标记为开发功能冻结候选版，正式上线验收仍在 R1。

更新前通过任务、审批、表单和私密请求空闲检查，进入维护并完成一致性备份：`.data/restart-backups/2026-11-09T05-58-32.371Z/`，包含匹配加密主钥。更新后 PID 为 1955504，Schema 保持 v5；更新时的 14 个会话、4 个附件、28 条请求记录、0 条托管凭证均保留，密码摘要和重启前有效 Session 不变，SQLite 完整性为 `ok`。Provider/MCP 配置未更改。

302 项自动测试、D7.4–D7.5 累计 150 项相关浏览器检查、类型检查、构建及格式检查通过。poll/SSE 各 28 轮重复操作后，DOM 与监听器采样稳定、堆增长约 3 MiB，退出登录后连接归零；不是 24 小时或目标容器验收。资源保留、无改动重建和 0755 发布目录均已核对。详见 [浏览器运行记录](browser-runtime.md) 与 [冻结记录](feature-freeze.md)。

生产依赖审计仍有 A2UI/旧 Zod 关联的 2 项既有 high，现有限额属于应用级缓解，不是上游修复。已列入正式发布前的风险处理，不声明生产零漏洞。

Cloudflare 原入口已确认匿名读取 401、原密码登录正常、App 域能力读取 403，最新 Web 入口和 6 项资源可用。实际页面只读恢复既有历史（1 个轮次、3 个内容标记），搜索 Escape 与手机侧栏焦点返回正常；没有创建模型 Turn、私密请求或 App 工具调用，也未保存真实历史正文或截图。证据为 `.data/feature-freeze/public-result.json` 与 `service-history-result.json`。

## 2026-11-09 用户反馈迭代同步

S1–S6 已完成并同步现有测试分享实例：固定 Codex 0.165.0、SQLite v6，加入图片缩略图、统一模型网关选择、会话审批与原生插件。重启前经过空闲检查、维护锁和一致性备份；保留 16 个会话、7 个附件和 41 条请求记录，原密码与既有登录有效。只读恢复原生历史正常，Cloudflare 入口及应用域隔离检查通过。311 项自动测试、9 项原生检查和本轮 122 项浏览器检查通过。详细改动、备份位置与证据见 [issue 验证记录](../.issue/2026-11-09/progress.md)。R1 正式上线验收仍延期。

## 第二轮设置体验同步

2026-11-09：网关私密编辑与自动 ID、统一工具/插件页、紧凑技能目录和个人技能可恢复卸载已同步现有测试实例。更新前通过空闲检查与维护锁，完成一致性备份；保持 Codex 0.165.0 和 SQLite v6，保留原 16 个会话、7 个附件、41 条请求记录及密码、登录。315 项自动测试、11 项原生检查、81 项本轮浏览器检查通过。备份位置和服务/Cloudflare 验证见 [第二轮进度](../.issue/2026-11-09/progress-02.md)。正式上线统一验收继续留到 R1。
