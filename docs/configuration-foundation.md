# D3.1 配置校验、脱敏与并发保护

日期：2026-11-08。完成 [整体计划](roadmap.md) 的 D3.1。首条可编辑流程是默认模型和推理强度；Provider/MCP 的新增、修改、删除与连接测试分别留到 D3.2/D3.3。

## 用户变化

“模型与 Provider”中的默认值编辑使用本地草稿。保存前不改变当前聊天的模型选择，失败后保留修改；可主动“读取最新并重置修改”。保存成功后读回生效值，显示用户、项目、运行参数等配置来源。

保存默认值保留当前对话的模型选择。新建对话，以及没有历史选择的新浏览器会话，会优先采用服务端已配置且可发现的默认模型和推理强度。Bridge 创建新线程时也采用保存后的有效推理强度，修复原先总以模型目录的默认强度覆盖用户配置的问题。

两个浏览器或服务端同时修改配置时，旧草稿收到冲突提示，不能自动覆盖新值。写入失败、写入结果未确认、读回失败和高优先级覆盖分别给出恢复入口。上层覆盖时展示实际生效值与来源，不把“文件写入成功”直接标记为目标值已生效。

设置面板支持桌面、375px 深色手机和 812×375 横屏。表单、保存及重新读取按钮可在面板内滚动访问，手机主要操作至少 44px。界面按需加载，沿用现有设计和组件，没有新增产品依赖。

## 配置事实来源与只读视图

读取使用固定版本 Codex 的 `config/read({ cwd, includeLayers: true })`。用户配置、项目配置、Profile 与运行参数的层级仍由 Codex 决定；没有维护第二份 `config.toml`。

`GET /api/config` 新增 `configuration` 产品视图：

- `revision`：服务端生成的 opaque revision；不把原生文件版本或原始配置交给浏览器。
- `writable` / `reason`：运行时是否提供带版本的基础用户配置目标，以及不可编辑原因。
- `defaults` / `sources`：默认模型、推理强度、Provider ID 及来源类型；Profile 仅报告是否存在，不返回其名称或路径。
- `providers`：ID、显示名称、端点 origin、接口类型和凭证声明类别。
- `mcp`：ID、传输方式、启停状态、端点 origin，以及是否声明凭证相关字段、参数或环境变量。

只输出白名单字段。原始配置层、文件位置、Instructions、API Key、Bearer Token、请求头值、环境变量值、命令和参数、未知私有字段均不返回。URL 只保留协议、主机和端口，移除用户名/密码、路径、查询和片段。凭证类别只描述配置中的声明，不代表凭证有效或连接测试通过；OAuth 状态继续来自现有 MCP 状态接口。

配置读取失败时 `configuration` 为 `null`，返回通用错误，禁用默认值保存；不会因读取失败把已知 Provider 悄悄重置成 OpenAI。所有接口继续受 Session、Origin 和独立应用域的访问边界约束。

## 写入 Schema 与版本校验

现有 `POST /api/config` 的 `settings/defaults` 路径接入严格 Schema：

```json
{
  "action": "settings/defaults",
  "expectedRevision": "cfg1.<64 位十六进制值>",
  "model": "已发现模型 ID",
  "effort": "该模型支持的推理强度"
}
```

拒绝额外的 `filePath`、原生 `edits`、凭证或其他字段。保存前重新查询有效模型及其推理选项，不仅依赖浏览器列表。

revision 使用每个 Bridge 实例的随机密钥，对完整原生读取结果做规范化 HMAC。原始层版本、有效值、私有字段或配置来源变化都会使旧 revision 失效；字段序列化顺序不影响同一配置的指纹。客户端不能由返回值推导凭证明文。Bridge 重启后旧 revision 需要重新读取。

服务端从原生基础用户层取得可信 `filePath` 和 `expectedVersion`，仅发送两个生成类型约束的原生 edit：`model` 与 `model_reasoning_effort`，使用 `config/batchWrite`，不接受浏览器指定写入位置。没有用户层版本或存在歧义时拒绝编辑，不降级为盲写。

除保存前的整体 revision 比较外，实际写入还携带原生 `expectedVersion`，防止最后一次读取与写入之间的用户文件竞争。写入后再次读取：目标值不一致或原生报告 `okOverridden` 时返回 `overridden`；其他配置层在保存期间变化时报告可能已写入的冲突，要求重新确认。跨多个配置文件不被当作一个原子事务，也不盲目回滚覆盖后来的修改。

仅在任务、审批、待授权 App 调用和 OAuth 均空闲时保存。保存期间复用 Bridge 维护状态，拒绝创建新的 Turn 和持久提交记录；结束或失败后释放状态。默认值保存不重启 Codex，不向运行中的线程热加载静态模型字段。源文件和运行时任务仍由 Codex 管理。

写入失败或响应丢失时不自动重复提交。可能已经写入的情况要求重新读取检查；前端不会自动将旧草稿换上新版本号再重试。旧前端缺少 revision 时收到“刷新页面并重新读取”的提示。连接旧后端时保留原有设置界面，由 `capabilities.configuration.versionedDefaults` 控制新编辑器。

本批保护覆盖新的默认值编辑路径。原生 Skills 启停和既有 Provider 切换保持原接口；Provider/MCP 的后续管理会在 D3.2/D3.3 扩展同一版本边界。通用配置回滚、重启失败处理与私密凭证录入不在本批标记完成。

## 验证

- `npm test`：75/75 通过，新增 8 项覆盖字段白名单与脱敏、原生写入目标/版本及未改动字段保留、旧版本/缺失版本/非法字段/并发写入、最后时刻的原生版本竞争、项目层变化、只读与上层覆盖、保存失败/响应丢失/读回失败、登录/Origin/应用域边界、任务/审批/保存互斥，以及新线程使用已保存模型和推理强度。
- `npm run test:configuration-ui`：11 项 Chromium 检查通过，包含两个独立浏览器会话的冲突与草稿保留、服务端修改、写入失败、上层覆盖、结果未确认、任务占用、读取失败、当前对话与新对话的默认值作用范围、新浏览器默认值、深色手机与横屏。无 page error，无外部资源请求；截图已实际打开检查。
- 原有 Skills 查看 16 项、技能调用 11 项、文件界面 19 项、HTML 隔离 14 项、PDF 13 项、文件生命周期 11 项回归通过；连同本批共 95 项浏览器检查。MCP Apps 初始化、结果与经审批的反向工具调用另行回归。
- `npm run test:configuration-live`：真实 Codex 0.166.0，在专用 Codex Home/工作目录中验证读取脱敏、原生 CAS 拒绝旧版本、保存后读回、未编辑的凭证字段保留，以及 Codex 子进程重启后的持久化。测试不执行账号登录、模型任务或真实 Provider 的连接测试。
- `npm run build` 通过 TypeScript、前端/服务端构建、静态压缩与上一代资源保留；`npm audit` 无漏洞。

浏览器夹具使用 FakeCodex；真实协议验证单独执行，不把夹具当作真实多 Provider 验收。现有分享服务未重启，其数据库和 Codex 配置未被本批迁移或修改。正式部署与上线检查仍留到 R1。

## 复现与证据

```bash
npm run build
npm test
npm run test:configuration-ui
npm run test:configuration-live
```

UI 测试需要本机 Playwright/Chromium，可配置 `PLAYWRIGHT_MODULE` 和 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`，默认本机 3112 端口，可通过 `CONFIG_TEST_PORT` 修改。所有测试数据目录与工作目录独立，结束后清理；控制接口只在夹具中注册。

记录与截图：`.data/configuration-ui/`、`.data/configuration-live/result.json` 和 `.data/d3-1-*.log`。原生类型基线见 [ConfigReadResponse](../generated/codex/v2/ConfigReadResponse.ts)、[ConfigLayer](../generated/codex/v2/ConfigLayer.ts) 与 [ConfigBatchWriteParams](../generated/codex/v2/ConfigBatchWriteParams.ts)。

后续进展：D3.2 已完成 Provider 新增、编辑、删除保护、版本化切换、模型发现与基础连接诊断，复用本批版本边界，见 [Provider 管理记录](provider-management.md)。D3.3 MCP 管理和 D3.4 统一恢复也已完成，见 [恢复记录](configuration-recovery.md)；私密输入仍留到 D6。
