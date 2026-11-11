# Issue 06 调查

2026-11-10。原始反馈：`06.md`，截图 image-35.png 至 image-44.png。保留原文件。

## 目标与不变量

全局配置保存只依赖服务端持久化，不应被上游能力发现拖住；新默认只作用于新线程。异步操作必须有明确状态和所有者，迟到响应不能改变其他会话。私密数据只进入指定接收方的受控通道，不进入普通配置、模型上下文、日志和前端持久化。界面应呈现用户选择，自动处理内部协议参数。

|编号|触发、实际行为与预期|根因与证据|状态|
|---|---|---|---|
|06-01|切换默认模型长时间忙碌；应本地保存立即反馈|session-runtime.defaults 调用 catalog；ProviderSettings 保存后 loadSettings + 强制刷新目录；配置事件再次加载。/api/config 两次 2071/2335ms，直接配置读取 5ms。未发现推送默认到已有线程|有代码证据|
|06-02|连接器错误显示 Provider/模型默认；应仅显示本对象|ConfigurationFeedback 无条件渲染 defaults|有代码证据|
|06-03|页面显示 HTML JSON 解析异常；应有可恢复网络错误|公共请求解析和修改操作分类不完整；本轮公网未再次返回 HTML，不能确定原始来源|防护缺口有代码证据；原网络故障待验证|
|06-04|连接测试/刷新/重读重复；应是独立服务端诊断|原生 ephemeral discovery thread 只列目录，没有 turn/start；UI 将诊断和全部设置加载串联|有代码证据|
|06-05|文件存储被理解为记忆/插件库|实际为附件与快照。SQLite 保存扩展定义，包在隔离 imports/CODEX_HOME，技能进入服务端工作区 .agents/skills，MCP 运行参数注入|已核实|
|06-06|全局安全页显示当前会话策略、sudo 单次检查；私密输入覆盖不足|Settings 读取 s.thread；vault 仅 provider/MCP HTTP Bearer，未覆盖 headers/stdio/chat|有代码证据|
|06-07|MCP_A 标识持续报错，表单要求 env 引用和 JSON|原生标识小写正则直接暴露。公网 Chromium 复现 patternMismatch 和英文错误|已复现|
|06-08|保存网关仍等待模型发现；应独立保存与刷新|GatewayEditor.finishSave 等待 onSaved/provider/models，目录失败保留保存表单|有代码证据|
|06-09|普通发送出现上次待确认；丢响应后可能永久等待|pendingRun 在正常发送前设置；catch 查到已接收仍未确认；全局 pending 阻塞其他草稿|有代码证据|
|06-10|配置加载前点添加无反应|ToolsSettings 按钮可点，McpSettings.edit 无 config 返回，createSignal 不随 config 重试。公网加载后再次点击才打开|已复现|
|06-11|搜索移到侧栏顶栏图标|保留 Ctrl/Cmd K、弹窗和移动端行为|产品调整|

## 同类风险

|范围|共同机制|结论|
|---|---|---|
|网关、MCP、插件启停、技能设置、凭证保存|保存后整套发现；SSE 又全量读取|有代码证据，纳入 S1/S4|
|网关、连接器的版本冲突|cfg1 覆盖整份原生+SQLite配置；无关变更失效|有代码证据；重复只读两次版本相同，不能声称读取必然改版本|
|文件/导入/私密接口 JSON|不统一校验响应类型|有代码证据，按响应语义检查；二进制文件不套 JSON 解析|
|跨会话、刷新、断线、迟到确认|单个全局 pending、草稿 ACK 所有权|有代码证据，纳入 S4；保留请求幂等与禁止盲目重发|
|资源目录复制与凭证注入|运行快照与会话生命周期|纳入恢复/禁用/撤销验证；不扩展为新记忆或多 Agent|

## 原生可行性及限制

固定真实 Codex 0.165.0，在独立临时 HOME/CODEX_HOME 使用模拟 Responses 和 MCP，验证线程参数可接收 provider HTTP Authorization、MCP HTTP X-Api-Key、stdio env。接收方取得正确合成值；线程结果/事件/临时文件扫描没有该值。MCP 探针没有模型 turn。不是实际 Provider 兼容证明；跨线程、撤销、终止/恢复仍须实现阶段验证。

公网 HTML 与 dist/web/index.html 一致，asset index-CNZIxK_4.js。浏览器截图暂存 /tmp/newbot-issue06-connectors-desktop.png、/tmp/newbot-issue06-connector-editor-mobile.png，进入实施复制到证据目录。没有变更生产配置或个人 Codex。

## 确认边界

用户选择先理清资源管理，不新增长期记忆；聊天私密输入只覆盖网关/连接器，不新增通用 sudo。全局凭证加密持久化，聊天按任务/线程临时授权。保持固定内核、SQLite 权威来源、个人 Codex 隔离；正式上线验收另行进行。

## 实施中新增因果证据：发现辅助进程竞争

S3/S4 原生联调复现：MCP 诊断成功后立即发送任务，后台技能通知与前台扩展快照可能同时启动两个发现辅助进程。捕获的原生启动错误为 `failed to initialize sqlite state runtime`，随后前台技能读取失败；不涉及模型调用或凭证认证失败。共同边界是同一隔离 Codex Home 的辅助发现进程启动/退出。本轮纳入串行化辅助发现生命周期，覆盖 skills/list、plugin/list、plugin/read，不改变主 Agent 任务生命周期。验收使用固定原生二进制连续执行诊断→发送→重启/恢复流程，并回归扩展相关测试。
