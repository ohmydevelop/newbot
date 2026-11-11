# 包内 MCPB 与证书获取进度

## S0

- 用户已授权取消旧约定和删除旧插件，并明确要求通知插件会话。本轮按新要求执行，不保留 io.newbot 兼容分支。
- 已核对官方 MCPB manifest 规范及 Agent Plugins 根清单 schema。插件根清单没有标准用户配置字段，采用包内完整 MCPB 描述；组合发现规则在文档中单独说明，不冒充跨宿主标准。
- 已只读确认指定会话属于 `/home/a/Documents/ChatGPT/newapp`。通知仅发送协议/实现要求，不转发凭证。
- 前轮 TLS 检查确认自签名。当前通用表单能承载单行指纹；本轮提供 TLS 观察与确认填入，避免多行 CA 通道和全局证书库变更。
- 原始截图/历史计划保留，证据收集到本轮独立目录。

## S1：取消旧声明、协调新版和清理旧安装

- MC-01 的共同原因是配置字段关联依赖宿主专有指针。`server/plugin-descriptor.ts` 改为发现包内完整 MCPB 0.3 清单，按 name 对齐原生连接器，`${__dirname}` 相对清单目录展开。校验必需字段、原生名称、入口路径、重复声明和平台启动参数。原生无配置插件、原生 HTTP 定义保留；不把 MCPB 的 stdio 定义扩展为自造 HTTP 格式。
- `io.newbot` 只剩明确拒绝旧包的检查，没有读取、迁移或兼容分支。文档 `docs/plugin-configuration.md` 更新为完整标准清单，标明 Agent Plugin 内组合发现是 newbot 宿主策略。
- 已通过会话工具通知 `01a1c4d1-2cdf-7033-bcb6-654ced4606d3`，仅发送契约和验证要求。插件作者完成 v0.5.2，交接文件 `/home/a/Documents/ChatGPT/newapp/.issue/newbot-mcpb-handoff.md`。发布包 SHA-256：`e58c9ecb0ec22fcceee860b279ee11e04dce27e8e1796900e465b385b585ca46`。
- 新包保留原生插件结构、2 个技能、7 个工具及内嵌 MCP App；新增普通可选指纹字段，密钥继续为敏感字段；不包含旧配置目录、io.newbot 或跳过 TLS 选项。作者的官方 schema/打包验证见其交接；宿主另行做真实原生验证，不只采信作者结果。
- MC-02：通过已鉴权卸载接口移除 0.5.1，随后取得空闲维护锁，清理旧目录项、1 条包记录、1 个活跃包根、原生缓存和旧导入 ZIP。对应插件设置与私密绑定已移除；其他插件保留。未触碰审计/历史快照或外部 newapp 源码。维护锁正常释放。
- 证据：[uninstall.json](evidence-plugin-mcpb-certificate/uninstall.json)、[removal.json](evidence-plugin-mcpb-certificate/removal.json)。当前实例没有自动装入 0.5.2；新包处于可导入状态。

## S2：只观察证书的受控入口

- MC-03：新增 `/api/plugins/certificate`，复用登录和 Origin 校验，来源必须是当前插件连接器声明的普通文本字段。探测前后核对包摘要和配置修订；插件卸载、升级或并发修改使结果失效。响应不含私密输入，获取不写数据库。
- `server/certificates.ts` 单独建立 TLS 观察连接，固定已校验 DNS 地址，使用原主机名 SNI。允许用户明确输入的私网目标，拒绝回环、链路本地、云元数据及不安全 IPv6 封装等地址；不发 HTTP、Cookie、Token，不把观察连接复用为业务连接。
- HTTPS 专用，HTTP 返回具体提示。返回域名/端口、颁发对象/颁发者、有效期、系统/主机名验证状态和完整叶证书 SHA-256。日期或用途不合法时禁止自动填入，观察结果 5 分钟有效。限制 6 秒、2 个并发、每分钟 12 次，失败也计数。
- `tests/certificates.test.ts` 通过实际 TLS 监听验证自签名、受信任、主机名不匹配、过期/尚未生效、连接超时及零应用数据；验证 DNS 固定、混合地址拒绝、限流和私密字段隔离。超大证书上限有代码，未另造超大 TLS 证书；无 SAN 没有独立测试。

## S3：表单操作与草稿绑定

- 新 `CertificatePicker` 集成插件连接器表单。普通 URL 字段提供“获取服务器证书”，有多个地址/目标时明确选择；只有一个目标时仍显示其字段标题。密钥不参与地址或目标候选，宿主不判断 CloudWalker 特定字段名。
- 展示证书摘要和折叠详情，“确认使用此证书指纹”只填入草稿；原有保存流程负责持久化和下一轮注入。当前地址变化会清掉本次获取的旧指纹，手工改写值不误删。取消、组件切换和过期请求不覆盖新状态。
- MC-04：`web/certificate-draft.ts` 状态约定及服务端探测前后版本竞争均有测试；编辑器身份包含连接器、配置修订和描述摘要，避免升级后保留旧字段。
- Impeccable 静态检查完成：[ui-detector.json](evidence-plugin-mcpb-certificate/ui-detector.json)。仅一项旧 `.prose blockquote` 的 `border-left` 被识别为卡片侧边强调线；实际为 Markdown 引用语义，非本轮新增组件，保留不改。新证书组件未报告命中。
- **真实浏览器未验证**：工具返回 `Local browser use is disabled in Work settings`。未绕过设置启动浏览器，手机/桌面、键盘、取消与异步竞态的真实交互仍待补验；静态检测和状态测试不作为视觉证据。

## S4：原生链路、回归和运行版本

|验证|结果与边界|证据|
|---|---|---|
|类型与完整自动测试|`npm run check`；401/401 通过|[typecheck.log](evidence-plugin-mcpb-certificate/typecheck.log)、[tests.log](evidence-plugin-mcpb-certificate/tests.log)|
|发布包与证书完整链路|真实 Codex 0.165.0 + 实际 v0.5.2 ZIP + 自签名模拟业务服务，4 组通过。默认不信任和错误指纹在 Token 发送前拒绝；获取并确认的指纹使模拟查询成功；重启保留配置和加密凭证|[native-certificate.json](evidence-plugin-mcpb-certificate/native-certificate.json)|
|插件升级|6 组：保留身份/选择；新代码需重新私密授权；陈旧预览拒绝；失败回滚；重复/并发；重启恢复|[native-upgrade.json](evidence-plugin-mcpb-certificate/upgrade/native-upgrade.json)|
|技能与插件导入|13 组：两种原生插件结构、129 项扫描和大资源执行、独立/插件技能选择、实际 MCP 调用、并行扫描与空闲安装、重复和部分失败恢复|[native-result.json](evidence-plugin-mcpb-certificate/import/native-result.json)|
|生产构建|通过；仍有既存大体积图表语言块提示，非编译失败|[build.log](evidence-plugin-mcpb-certificate/build.log)|
|测试服务重启|PID 1722066 → 1789901，schema 14；24 会话/71 任务/5 附件不变，最近 3 会话结构、网关配置、密码、密钥和个人/实例配置哈希不变|[local-update.json](evidence-plugin-mcpb-certificate/service/local-update.json)|
|公网读取|本地/公网/磁盘主入口和插件块一致；旧插件不在目录，GitHub 0.1.12 保留；独立连接器只有 newbot_test；能力报告 MCPB 0.3 与证书获取|[live-readback.json](evidence-plugin-mcpb-certificate/live-readback.json)|

原生证书测试创建 0 次模型请求、0 次真实业务请求、2 次模拟查询，未填入真实 Token、未获取或更改实际服务的信任。升级测试不调用模型/业务；导入回归使用模拟 Responses 上游并观察实际请求，不能据此宣称真实 Provider 兼容。所有测试运行目录与个人 Codex 隔离。

测试服务已于 2026-11-11 00:03（Asia/Shanghai）更新，入口 `/assets/index-DW8Vx5FP.js`，活动插件块 `assets/ToolsSettings-BxjrIJXo.js`。此次是已有测试实例更新，不是正式上线验收。`git diff --check` 通过；没有提交或推送仓库。

## 完成范围和剩余项

- MC-01/02：实现、移除旧资源、通知及新版包交付均有证据。
- MC-03/04：API、普通配置/私密参数、TLS 和原生执行/恢复路径已验证；UI 代码和状态测试完成，真实浏览器交互验收保持未完成。
- 新包可通过 Web 插件导入流程使用。当前测试实例按要求保留旧版已删除状态，不擅自重新安装、代填真实服务凭证或确认真实证书。
- 无 SAN、超大证书的单独真实 TLS 场景未验证；其标准校验与大小约束有代码证据。真实业务 TLS 兼容、浏览器视觉和正式部署不计入已完成结果。
