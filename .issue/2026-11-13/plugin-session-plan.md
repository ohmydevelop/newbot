# 插件会话问题：凭证丢失、@ 不提插件、缺少会话关联栏

日期：2026-11-13。来源：`.issue/2026-11-13/001.md` 与截图 `image.png`。三件事分开处理，按用户要求逐个解决。

## 问题 1：升级插件后 API KEY 丢失

**触发**：牧云插件（HTTPS MCP，`CLOUDWALKER_API_TOKEN` 走私密输入）升级到新版本后，配置页 Token 为空。

**根因（代码证据）**：`private-field` 的接收方绑定把**包摘要**也算了进去：

```ts
// server/private-fields.ts:62-93
const owner = config.newbot_plugin_connections?.[target];
const { packageRoot, ...plugin } = owner;   // plugin 里含 packageDigest、schemaDigest
values.push(plugin, logical(def.env || {}), …);
```

升级会改变 `packageDigest` / `schemaDigest`，绑定随之变化；`plugin-connections.ts:116-121` 只在绑定等于“旧格式（pre-portable）”时才迁移，其他情况直接 `return {}`，于是私密字段不再注入。用户看到的是“凭证没了”，实际是绑定失效、既不显示也不使用。

**判断**：包摘要不是“接收方”。接收方应由 `pluginId + connector id + URL/command/args/env/cwd/headers` 定义；升级后这些不变时，密钥仍应指向同一接收方。升级确实会运行新代码，但插件本来就能读取注入给它的密钥，绑定不负责约束“插件代码行为”，只负责防止密钥跟随到另一个接收方。

**修复**：

1. `privateFieldBinding` 去掉 `packageDigest`/`schemaDigest`（保留 `pluginId`、`server` 与全部目的地字段）。
2. 保留 `previousPrivateFieldBinding`（portable + 含摘要）与 `legacyPrivateFieldBinding`（非 portable + 含摘要）用于迁移：读取到旧行且其绑定与当前配置的旧公式一致时，解密并以新绑定重新封装（同步、仅内存明文）。
3. `saved()` / `info()` / 授权校验统一走同一迁移入口，避免 UI 显示 `valid: false`。
4. 目的地真的变化（URL、command、args、env、headers、cwd）时仍旧失效，行为与既有测试一致。
5. UI：凭证失效时在插件连接编辑处给出明确提示（不能只显示空输入框）。

**同类风险**：Provider（网关）凭证使用同一绑定函数，同样受摘要影响——改为不含摘要后，更新网关定义但目的地不变时凭证保留；目的地变化仍失效。`private_field_sets` 旧行的迁移逻辑必须覆盖这两类 scope。

**已复现/待验证**：绑定含摘要是代码证据；升级导致失效由截图与用户反馈佐证；迁移后新版本保留、换 URL 仍失效需要单测确认。

## 问题 2：`@` 后不弹插件列表；下一轮插件丢失

**A. `@` 不弹**：`mentionAt` 的正则要求 `@` 前是行首或空白（`web/composer-selection.ts:13`），中文输入时常见“帮我@牧云”这类无空格写法，因此不触发。**修复**：允许 `@`/`$` 前是不属于 `\p{L}\p{N}_` 的字符（同时避免邮箱 `foo@bar` 误触发）。

**B. 下一轮丢失**：当前设计是“下一条消息”的输入，`session_inputs` 在派发后 `consume`，`composer.acknowledge` 也会清空 plugins/skills。用户期望“用过就长期使用”。这属于下面的功能 3，单独实现，不在本轮用临时补丁掩盖。

## 问题 3：会话关联栏（右侧）

**目标**：当前会话关联的插件 / 技能 / MCP 在右侧可见、可移除，结构可扩展（后续放子 Agent）。

**设计**（下一轮实施）：

- 语义从“下一条消息的输入”升级为“会话关联”：`session_inputs` 不再在派发后清空，而由用户显式移除；`nextInput` 与关联栏共用同一份状态与 revision，避免两套真相。
- 桌面：右侧 260–280px 折叠栏，与左侧栏对称；移动端为抽屉，进入会话时默认收起。
- 每一类分组（插件 / 技能 / 连接器）显示名称、状态（可用/需配置），悬浮显示移除；移除即写回 `session_inputs`。
- 可扩展位：分组数据由服务端 DTO 提供（`kind` + `items`），UI 按 kind 渲染，新增类型（子 Agent）不改布局。
- 兼容：无关联时隐藏入口；旧会话的 `nextInput` 仍可读取。

## 实施顺序

1. 本轮：问题 1 的绑定与迁移 + 单测；问题 2A 的正则与测试；问题 3 只落计划。
2. 下一轮：问题 3 的服务端语义（不消费）+ 右侧栏 + 移动端 + 截图验收。

## 验收

- 单测：升级（摘要变化、目的地不变）后密钥仍注入；换 URL/command 后失效；旧绑定行自动迁移；Provider scope 同样覆盖。
- 单测：`mentionAt("帮我@")` 触发、`foo@bar` 不触发。
- 回归：插件配置、凭证隔离、会话输入相关测试全绿；`tsc`、`build` 通过。
- 问题 3 的验收在下一轮：关联栏增删、刷新/重启保持、移动端可用（截图）。
