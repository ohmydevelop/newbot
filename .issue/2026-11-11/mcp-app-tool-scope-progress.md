# MCP App 工具范围修复进度

## S0 调查

- 已完整读取截图与前轮记录。已确认宿主把「工具是否关联 UI 资源」与「该 App 能否调用工具」合并为同一筛选；官方标准以同一 MCP 连接和工具 visibility 为权限范围。
- 产品代码尚未修改。下一步核对真实已安装包和历史工具结果，并仅申请/取消授权，不执行真实业务工具。

### 已确认原因

- `live-before.json`：实际服务 PID 1872604，Codex 0.165.0，CloudWalker 0.5.2 已配置且启用。本地/公网/磁盘入口一致。原生历史来源 `open_security_workspace` 能打开，但工具白名单只有入口自身；`list_business_groups` 在授权申请阶段即收到 403 `permission`，未批准、未调用业务服务。
- 因此已确认本次失败由宿主权限范围误判产生，不能归咎于证书、密钥或业务组接口。UI 资源加载成功不意味着数据工具得到调用权限。官方稳定规范中的同连接 App visibility 与绑定 UI 资源是独立属性。
- Work 浏览器控制仍明确返回禁用，无法通过浏览器复现页面点击；API 复现与源码定位的证据边界分别保留。

## S1 通用修复

- `server/mcp-apps.ts` 登记同连接全部合法工具，资源 URI 可选；App 可调用集合以 visibility 判断，省略时使用标准默认值，model-only、空数组或非法枚举/类型均拒绝。
- 来源工具仍必须关联原 UI 资源；浏览器会话、线程、目录重读、关闭/过期、批准前权限校验与单次授权保持原有边界。数据工具不会仅因可调用而被渲染为 App。
- Host 产品策略升为 v2，`toolScope=same-server-app-visible`；同步现有能力说明和生命周期文档，没有修改插件包或添加插件专属分支。测试夹具中的危险工具改为明确 model-only，新增不同 UI 资源工具正向验证，避免继续把错误资源分组当作权限。
- `regression-before.log`：两项新回归在修复前失败，普通数据工具被排除；修复后 `targeted-tests.log` 33 项通过。

## S2 原生与关联验证

- `tests.log`：405/405 自动测试通过；`typecheck.log`：TypeScript 通过。
- `native-scope.json`：4 组链路通过，使用未修改的 0.5.2 发布 ZIP、真实 Codex 0.165.0、官方 App/AppBridge SDK 的内存传输、模拟 Responses 服务和模拟 TLS 业务服务。2 次模拟模型请求建立真实原生工具历史；11 次模拟业务请求。真实 Provider/真实业务调用均为 0。
- 实际入口工具通过模型 code-mode 调用并持久化；从原线程/原 item 打开 HTML 后，同连接 7 个工具可进入审批；无 UI 元数据的业务组工具取得模拟数据，态势刷新成功。申请不会执行，拒绝/跨工具范围/重放无业务调用；关闭失效、重开及服务完整重启后原来源和凭证恢复。App 数据查询不新增模型请求或聊天轮次。
- 测试夹具初次遗漏 `/models` GET 响应，产生空 JSON 错误，修正夹具后完成验证。第一次失败单独保存为 `native-fixture-first-attempt.json`，不是产品故障。
- UI 内的单请求串行/取消和错误文案不在本次改变；同一权限机制覆盖刷新、分页、详情等工具。外部插件业务组失败文案虽提示可重试，但当前代码没有单独重试按钮；记录为插件 UI 后续改进，不通过宿主注入业务按钮。宿主现有「重新打开应用」可重新发起初始查询。

## S3 测试服务更新与核对

- `build.log`：构建通过，既有图表/语言分块体积提示仍在；`git diff --check` 通过。没有升级依赖、迁移数据库、修改真实插件包、提交或推送。
- `service/local-update.json`：10:51:10（Asia/Shanghai）在空闲维护锁内完成更新，PID 1872604 → 2436624。SQLite v14；28 会话、84 请求、5 附件计数相同；最近 3 会话历史结构一致；个人/实例 Codex 配置、网关、密码、私密密钥、插件设置/私密字段/包记录摘要全部相同。
- `live-after.json`：本地、公网、磁盘入口与 App JS 摘要一致；同一个 thread/turn/item 的 App 工具集合从只有入口修正为同连接 7 个工具，`list_business_groups` 申请从 403 变为 200，随后取消。整个真实实例验证没有批准或执行业务工具。
- 保留单次批准与隔离边界；用户刷新页面并重新打开工作台后，初始业务组查询可以进入正常批准流程。
- V-UI 仍未完成：Work 浏览器控制禁用。官方 SDK 内存协议验证、真实 Codex、真实插件和模拟 TLS 服务证明执行链路；不宣称真实页面布局/点击和真实业务数据已验收。

### 证据索引

|约定|修复前|修复后|
|---|---|---|
|AT-01 普通数据工具可申请|[live-before.json](evidence-mcp-app-tool-scope/live-before.json)、[regression-before.log](evidence-mcp-app-tool-scope/regression-before.log)|[live-after.json](evidence-mcp-app-tool-scope/live-after.json)、[native-scope.json](evidence-mcp-app-tool-scope/native-scope.json)|
|AT-02 通用 visibility 和资源关联分离|相同筛选影响所有普通数据工具|[targeted-tests.log](evidence-mcp-app-tool-scope/targeted-tests.log)、[tests.log](evidence-mcp-app-tool-scope/tests.log)|
|AT-03 权限、审批、关闭与恢复|已有边界必须保留|原生四组与上述测试，含重复批准、拒绝、撤销、重启；[local-update.json](evidence-mcp-app-tool-scope/service/local-update.json)|

## 2026-11-11 收尾补验

普通 App 业务工具无 UI resource 仍可授权调用，拒绝不执行，完全访问下自动批准，model-only 仍拒绝，降级后重新审批，真实 SDK 浏览器验证通过；原生端为隔离替身。

详细步骤、证据和限制见[收尾进度](remaining-work-progress.md)。本段补充当前验证状态，保留前述历史调查，不将模拟结果当作实际业务兼容证明。
