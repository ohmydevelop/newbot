# 插件会话工具同步进度

## S0 调查开始

- 已读取截图和上一轮 MCPB/证书计划、进度及原生验证范围。上轮已验证新建线程和重启恢复，但没有证明带旧工具历史的会话在插件重装后向模型发出的工具调用链路。
- 当前先区分模型解释、持久化快照、原生可调用目录与真实调用事件。所有读取仅输出线程/工具标识与错误分类，不输出凭证、业务正文或工具参数值。
- 原生运行时固定 0.165.0。产品代码尚未修改。

### 运行证据与原因修正

- [live-summary.json](evidence-plugin-session-tools/live-summary.json)：本地、公网和磁盘构建一致，Codex 0.165.0；0.5.2 已由用户导入，连接器 ID 与历史保持一致；旧/新线程当时均为未配置、原生快照禁用。
- [rollout-tools.json](evidence-plugin-session-tools/rollout-tools.json)：只提取调用名称、ID 和错误类别。00:09/00:10 的两个业务工具都返回 `unsupported call`，未成为正常 MCP 执行事件。截图“旧注册没刷新”属于模型推断；当前证据支持未配置能力被禁用后仍继续派发模型任务。
- [configuration-state.json](evidence-plugin-session-tools/configuration-state.json)：用户在 00:12 再次保存，当前必填密钥有效、配置完整。没有读取密钥明文、修改该保存或执行真实业务工具。
- 源码：`plugin-connections.prepare` 在接收方绑定变化时取得空集合，但未检查必填项及意外丢失；`plugins.prepare` 和 `experts.capture` 只核对插件本体；`bridge` 的原生就绪校验只覆盖独立专家连接器。共同机制缺口已记录，进入针对性复现。

## S1/S2 实施与针对性验证

- `plugin-connections` 的保存消费者在事务和授权提交之前检查必填私密值、已有密钥是否因普通配置变化失效。未显式清除的失效密钥要求重新输入，原配置、密文和修订保留；明确清除和主动停用维持可操作。绑定范围不缩减，没有按证书字段名作特殊豁免。
- 插件详情返回实际缺少字段的原因；既有表单增加必填约束，保存反馈区分可用、停用和待配置。配置失败的普通草稿和私密输入保留以便修正。状态消息沿用既有组件，没有新增页面或持久提示。
- `index` 在幂等任务登记前检查明确选择的插件/专家；`bridge` 在原生同步前再次校验冻结配置，恢复后检查实际连接器启动状态。无关未配置插件、主动停用的可选组件不锁住其他功能。检查失败不消费下一条引用、不发送模型请求、不自动重放业务工具。
- 通用运行说明要求使用本轮真实工具入口；不能从历史名称推断能力，也不能把未配置解释为重启要求或通过 Shell 绕过连接器。该说明是行为指引，安全边界仍由配置/原生权限维持，不以提示词宣称强沙箱。
- [regression-before.log](evidence-plugin-session-tools/regression-before.log) 保留修复前失败：必填密钥未提供却返回保存成功。修复后 [configuration-after.log](evidence-plugin-session-tools/configuration-after.log) 11 项通过；[targeted-tests.log](evidence-plugin-session-tools/targeted-tests.log) 19 项通过，含 API 插件/专家缺项不登记任务。

## S3 验证

|项目|结果|证据|
|---|---|---|
|类型与完整自动测试|类型检查、403/403 测试通过|[typecheck.log](evidence-plugin-session-tools/typecheck.log)、[tests.log](evidence-plugin-session-tools/tests.log)|
|原生模型→工具链路|8 组通过，24 次模拟模型请求、7 次模拟 MCP 业务调用；真实模型/业务请求均为 0|[native-session.json](evidence-plugin-session-tools/native-session.json)|
|插件升级|6 组通过：原身份/选择、私密授权、预览竞争、回滚、重复提交及重启恢复|[native-upgrade.json](evidence-plugin-session-tools/upgrade/native-upgrade.json)|
|实际新版包证书链路|4 组通过，0.5.2 ZIP、真实 Codex、模拟 TLS 接收方；错误指纹不发 Token，确认指纹和重启恢复正常|[native-certificate.json](evidence-plugin-session-tools/certificate/native-certificate.json)|
|构建|通过，既有大语言/图表块体积警告保留|[build.log](evidence-plugin-session-tools/build.log)|
|界面|Impeccable 静态检查无命中；Work 浏览器控制仍关闭，未声称实际手机/桌面交互已验收|[ui-detector.json](evidence-plugin-session-tools/ui-detector.json)|

原生回归逐项验证：缺项保存不提交；选择插件/专家时不派发；普通聊天不受无关未配置项影响；原线程补齐后可发现并调用工具一次；参数更新/清除/停用/重启；启动失败拦截；升级与卸载后重装在原线程恢复；另一线程快照和共享运行时 PID 保持。固定版本使用 code-mode，在 `additional_tools` 发布入口，模拟模型通过 `functions.exec` 查询 `ALL_TOOLS` 后调用实际 MCP。测试最初误用普通顶层 tools 解析和不完整 portable 清单，修正测试夹具后才形成上述证据；不把目录检查冒充执行证明。

测试实例 00:24 仍有真实任务运行，维护锁拒绝重启；没有强制终止。构建和回归已完成，服务更新等待空闲，随后记录配置/会话和公网校验。

## S4 测试服务更新与收尾

- 00:24:42 在任务完成后取得维护锁，更新 PID `1789901 → 1872604`。没有中断任务或创建模型请求。
- [local-update.json](evidence-plugin-session-tools/service/local-update.json)：SQLite 仍为 v14；27 会话、78 任务、5 附件数量不变，最近 3 个会话原生消息结构一致；网关、密码和密钥文件一致。新增核对插件配置表、私密字段表和包记录摘要，用户刚保存的配置未被修改；个人/实例 Codex 文件哈希一致。
- [live-readback.json](evidence-plugin-session-tools/live-readback.json)：公网/本地/磁盘主入口 `/assets/index-DUhiMicX.js` 和插件块 `assets/ToolsSettings-B1XSogFH.js` 一致；CloudWalker 0.5.2 保留，2 个技能启用，连接器已配置且密钥已保存；GitHub 0.1.12 保留，独立目录仍只有 newbot_test，没有混入插件连接器。
- `git diff --check` 通过，没有提交或推送。未运行额外真实业务查询、未读取/代填用户密钥、未改变真实证书信任。验证覆盖真实固定 Codex 与模拟上游，不作为真实 Provider 或业务服务兼容性证明。
- 手机/桌面浏览器交互仍未验收：本轮再次查询，工具明确返回浏览器控制在 Work 设置中关闭。静态检查无命中仅证明未检出静态问题。所有其他原问题与选定的关联机制已有上述证据。

## 2026-11-11 收尾补验

本轮补验插件内连接器配置、独立目录过滤及真实原生连接诊断；诊断不增加模型任务。

详细步骤、证据和限制见[收尾进度](remaining-work-progress.md)。本段补充当前验证状态，保留前述历史调查，不将模拟结果当作实际业务兼容证明。
