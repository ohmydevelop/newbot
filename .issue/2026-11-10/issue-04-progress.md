# Issue 04：调查与实施进度

2026-11-10 16:28（Asia/Shanghai）。**S0–S5 已完成，测试服务及公网入口已使用最新构建。** 当前结论和证据见文末 S5 完成记录；下文保留调查与实施历史。

## S0 调查完成

当时授权仅为阅读分析，产品代码、运行配置和个人 Codex 环境未修改，也未重启服务；后续获得实施授权后进入 S1。

- 完整读取 04.md，查看其五张引用截图，以及相关历史计划；拆分 I04-01～07。
- 检查 App、RuntimeSelector、ProviderSettings、ThreadStatus、ChatTurn/Message、共享样式、session-runtime、thread-activity、Codex 请求路由、A2UI、凭证票据和现有回归覆盖。
- 核对固定 Codex 0.165.0、工作树和运行入口。本地、公网及磁盘前端资产 hash 一致，见 [runtime.json](evidence-issue-04/runtime.json)。没有读取或输出实际凭证明文。
- 使用现有构建和隔离 IssueCodex 夹具复现：运行中模型/权限/技能入口禁用；session/update 拒绝；等待时正文仍说正在处理；未知推理值被本地拒绝；搜索焦点矩形；网关冗余勾、原生箭头、删除与编辑同色。
- 显示占宽滚动条后，在三个宽度复现详情开关横移/变窄。临时页面应用 stable gutter 后水平坐标和宽度不变。只做浏览器内实验，没有修改 CSS 文件。
- 已保存 [分析](issue-04-analysis.md)、[计划](issue-04-plan.md) 和证据。原 issue、截图和其他计划保留。

## 复现记录

命令（从仓库根运行；需要本地已有 dist）：

```bash
PLAYWRIGHT_MODULE=/home/a/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs PLAYWRIGHT_CHROMIUM_EXECUTABLE=/home/a/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome node .issue/2026-11-10/evidence-issue-04/inspect-ui.mjs
```

最终探针退出码 0，页面 JavaScript 错误 0；检查目标是**复现现状**，不是修复验收。结果与 18 组尺寸测量见 [ui.json](evidence-issue-04/ui.json)。脚本启动独立临时数据库和模拟运行时，结束时关闭浏览器/临时服务并清理临时数据；不执行真实模型调用。

首轮记录保存在 [ui-first-attempt.json](evidence-issue-04/ui-first-attempt.json)：Playwright 默认隐藏滚动条使布局问题未复现；跨移动端后侧栏收起导致设置入口定位超时。调整探针为显示实际滚动条、等待绘制并显式展开侧栏后复现成功。这是调查工具的修正，不计为产品修复。

已查看的代表截图：

- [等待审批](evidence-issue-04/waiting-light.png)
- [详情折叠](evidence-issue-04/layout-1366-650-collapsed.png) / [详情展开](evidence-issue-04/layout-1366-650-expanded.png)
- [搜索浅色](evidence-issue-04/search-light.png) / [搜索深色](evidence-issue-04/search-dark.png)
- [网关浅色](evidence-issue-04/gateways-light.png) / [网关深色](evidence-issue-04/gateways-dark.png)

## 未解决与验证边界

- S1～S5 均未实施，I04-01～07 均未标记修复完成。
- A2UI 等待缺口、同名模型能力混用、其他 select/危险按钮为代码证据；尚未逐入口浏览器复现。
- 候选参数和新的等待聚合属于待实现路径，竞态/恢复验证列入后续计划。
- 没有验证 issue 所列具体第三方模型是否接受或实际采用推理档位；未知不能改写成不支持。
- 未运行与分析无关的完整构建/测试，以免更新在线静态资源。现有历史回归仅作线索；本轮证据独立保存。
- 后续实施按已保存计划逐阶段推进；无调查阻塞，正式部署与上线验收不在本轮。

收尾校验：探针通过 `node --check`；三份 Markdown 的本地链接目标均存在；三份 JSON 可解析；`git diff --check` 通过。原测试服务 PID 817676 持续运行，本轮没有重启。


## S1 已完成，进入 S2

- 已按新授权实施。修复聊天滚动条占宽、搜索行焦点、原生 select 箭头、危险图标和网关名称；名称与模型数量同一行，长名称省略且保留悬停全名。
- 关联发现：默认网关变化会重排卡片，原全局默认模型缺少所属网关的独立记录。固定卡片排序，并在切换时保留原网关默认模型。
- 证据：`S1/ui.json` 中 18 个尺寸场景横移/宽度变化为 0，默认网关刷新恢复及原网关模型保留通过；桌面/移动单行截图已查看。`S1/regression/gateway-notices/result.json` 的 3 组关联浏览器验证通过；3 项模型默认/手工目录测试通过；类型检查通过。
- 构建发布到 `.data/issue-04-web` 候选目录，在线静态资源未更新。S2 开始统一等待原因和生命周期。


## S2 已完成，进入 S3

- 原生审批/输入/MCP elicitation 与 A2UI 表单按会话和 Turn 聚合原因、数量、定位目标；正文与侧栏使用同一摘要，多个请求不会提前解除等待。
- SQLite v10 增加最小等待摘要；进程重启清理瞬态请求并核对未知状态。事件中没有工具参数、表单内容或凭证值。
- 修复重复 turn/started 覆盖等待及终态迟到请求问题；表单提交、原生解除、停止均解除等待。
- `S2/tests.log` 31 项通过，类型检查通过；`S2/ui.json` 验证侧栏和正文均为“需要批准”，仍通过 S1 水平稳定性；已查看等待截图。迁移测试使用公开数据库版本常量，验证旧内容和 integrity_check。


## S3 完成：推理能力与实际参数

- 网关目录为推理能力附上网关、模型和配置版本的来源信息。自定义网关即使模型同名也保持未知；空能力列表不再当作已知不支持。共享校验覆盖创建、会话设置和执行入口，已知不支持的值仍拒绝。
- 原生探针发现并修复关联问题：清空界面 effort 不能清空原生线程的旧值。空闲时卸载并恢复同一线程，再应用原生默认；不使用原生不接受的 `model_reasoning_effort: null` 覆盖值。新线程未选 effort 时也不发送该无效覆盖。
- `tests/reasoning.test.ts`、`model-defaults.test.ts`、`gateway-manual-models.test.ts`、`session-runtime.test.ts` 共 11 项通过，类型检查通过。浏览器验证通过，见 `evidence-issue-04/S3/ui.json`。
- 固定 Codex 0.165.0＋本机两个模拟 Responses 上游验证 6 项：未知模型显式 low、原线程改 high 并保留历史、切换网关、接受但未证明采用参数保持未知、拒绝后不自动重试、恢复默认及新线程无显式档位。见 `S3/native/result.json`。未调用真实模型服务，不据此宣称第三方模型兼容。

## S4 实施中：下一轮设置

落实三份独立状态：SQLite 已应用配置、待应用候选、本轮 run_context 快照。运行中只保存候选；在下一次任务开始的会话锁内应用。显式技能/插件引用单独保存修订号，派发后按修订号消费，避免迟到请求清空后来的选择。


## S4 完成：保存意图与本轮执行分离

- SQLite v11 增量增加候选设置、状态版本和下一条引用；已应用配置仍在原 `session_runtime`。保存使用 CAS，原生应用前持有会话启动锁。运行中模型/推理/审批/专家可修改，当前 Turn 和已有审批不变；发送仍禁止同线程重入。
- 应用失败保留候选、正文及引用，阻止原生派发，提供重试和撤销。每个状态变化另有单调版本，迟到 HTTP 响应或历史读取不能覆盖更新的已应用状态。
- 技能和插件引用按修订号保存，派发后条件消费；专家仍为持续绑定。服务重启恢复候选与引用。成员失效在发送前验证，删除候选所引用的网关/技能/插件受到引用保护；取消失效引用仍可操作。
- 关联修复：设置加载不能把显式“默认”或未知模型的用户档位改回全局值；异步选择返回不能覆盖用户后来输入的正文；凭证恢复保持原空闲保护，并识别当前调用自己的启动锁，避免自锁。
- 自动验证 39 项通过，见 `S4/automated/tests.log`。覆盖 CAS、并发保存/应用、重启、旧审批、失败派发、持久引用、幂等消费、迟到事件与草稿 ACK。
- 真实 Codex 0.165.0＋两个本地模拟上游通过 10 项探针，见 `S4/native/result.json`：任务中保存 A/B 参数，当前请求未改变；关闭 Bridge/Codex 后恢复，下一轮实际请求使用最终网关/档位并带所选技能正文，原线程历史仍在。不涉及真实 Provider 兼容结论。
- 浏览器 6 项主流程通过，见 `S4/browser/result.json`：运行中选择、刷新恢复、撤销、原生应用失败保留草稿与引用、显式重试、下次派发后的单次消费。桌面 1366 与手机 390，深浅主题截图已检查，0 页面脚本错误。

## S5 实施中：联合回归与测试实例更新

进行类型检查、完整自动测试、原生隔离/应用生命周期/文件与凭证相关回归，然后通过空闲锁与备份更新既有测试实例。正式上线和第三方 Provider 兼容验收仍后置。


### S5 验证中发现的细节

- 重新检查手机截图发现：名称/数量已同行，但继承的按钮最小高度配合 `align-items: flex-start` 使文字略高于右侧图标。改为内容居中，并把文字/图标中心差 ≤1px 加入桌面和手机截图断言。
- PDF 首次候选验证在 gzip 响应头断言失败：候选目录只执行了 Vite，未执行正式构建的静态预压缩步骤。已定位为验证产物缺少 `.gz/.br`，补齐同一 `build-assets.mjs` 步骤后重新验证，不修改 PDF 安全机制。
- 完整自动测试 364/364 通过；原生隔离验证 7/7 通过，个人配置摘要未变、同线程热切换保持 PID。MCP Apps 15 项、凭证隔离 5 项浏览器检查通过；会话恢复结果保存在 S5/regression。


## S5 完成：联合验收与现有测试服务更新

| 证据 | 结果 |
| --- | --- |
| [完整自动测试](evidence-issue-04/S5/automated/tests.log) | 364/364 通过 |
| [类型检查](evidence-issue-04/S5/automated/typecheck.log) / [候选构建](evidence-issue-04/S5/automated/candidate-build.log) | 通过；实际服务更新另执行完整 `npm run build` |
| [布局和交互](evidence-issue-04/S5/ui.json) | 18 组尺寸均无水平跳动；名称/数量同行、文字/图标中心差 ≤1px；0 页面脚本错误 |
| [下一轮设置](evidence-issue-04/S5/regression/next-turn/result.json) | 6 项浏览器主流程通过；桌面/手机、深浅主题；失败不丢草稿和引用 |
| [原生执行](evidence-issue-04/S5/native/result.json) | 固定 Codex＋两个本地模拟 Responses，上游实际参数/历史/技能正文/重启恢复等 10 项通过 |
| [原生隔离](evidence-issue-04/S5/isolation/runtime-isolation-native.json) | 7 项通过；独立 HOME/CODEX_HOME，个人配置未变，同线程热更新保持 PID |
| [MCP Apps](evidence-issue-04/S5/regression/app-host-ui/result.json) | 15 项通过，权限与 iframe 生命周期保持 |
| [会话与草稿恢复](evidence-issue-04/S5/regression/conversation-recovery-ui/result.json) | 15 项通过，迟到发送/停止响应、上传和草稿恢复保持 |
| [私密凭证隔离](evidence-issue-04/S5/regression/credential-isolation-ui/result.json) | 5 项通过，API/日志/浏览器存储不含提交凭证 |
| [PDF 预览](evidence-issue-04/S5/regression/pdf-preview/result.json) | 补齐生产预压缩步骤后 13 项通过，Range、会话过期、主题和移动布局正常 |

### 运行实例

通过维护空闲锁后备份数据库、配置、凭证密钥文件及构建，再停止并更新原测试服务。没有中断用户任务或创建模型 Turn。

- [本地更新核对](evidence-issue-04/S5/service/local-update.json)：PID `817676 → 987185`，SQLite `9 → 11`，21 个会话、58 条运行记录、7 个附件不变，3 个近期原生历史核对一致。登录密码、凭证文件、Provider 定义、实例配置及个人 `~/.codex/config.toml` 摘要均未改变。
- 备份目录：`.data/restart-backups/issue04-1794299157704/`，仅服务端私有目录保存，不复制到公开证据。
- [公网检查](evidence-issue-04/S5/service/public-check.json)：公网 HTML/JS 与磁盘一致，新入口 `/assets/index-LPTOYUKO.js`；未登录主 API 为 401，应用域访问主 API 为 403；桌面和手机打开设置正常，无页面脚本错误。
- 本地与公网检查均未调用真实模型，上游兼容性结论仍限于模拟测试。正式部署、上线验收和两个真实第三方 Provider 的兼容矩阵按用户要求后置。

计划内无已知未完成项。完整未发送正文/附件草稿的跨浏览器持久化未纳入本轮；已确认的下一轮设置、技能/插件引用及专家绑定保存在 SQLite。
