# CRAFT-MCP-20261113：连接 Craft Anything 到 Codex

用户目标：将已安装 Craft Anything 的 MCP 注册到当前 Codex。现状：CLI 0.6.0 已安装、自检可响应；Codex config.toml 无对应服务，当前聊天无 Craft MCP 工具。预期：Codex 可读取持久化配置并启动服务，重新连接后可发现工具。

约定与根因：CLI/skill 安装不等于 MCP 注册；已确认缺少 Codex 服务条目。不同客户端注册独立，OpenCode 已连接不能证明 Codex 连接。无账号迁移需求。

范围：仅新增 Codex 用户配置中的 craft-anything 服务，使用绝对路径、mcp --all-tools、30 秒启动超时，保留 dry-run 提示的 rebuild_start 审批。不改其他客户端、浏览器授权、Deep mode 或运行代码审批。当前任务不继续修复浏览器问题。

同类风险：
- 已有 --all-tools 被 setup 覆盖：有技能说明依据；当前无已有条目，手动添加并检查参数。
- 其他 MCP 配置被覆盖：待验证；备份后追加，比较原有 TOML 对象不变。
- 二进制找不到或握手失败：待验证；使用已安装的绝对路径做 stdio initialize、tools/list 和只读 session 查询。
- 当前会话不热加载：待验证；当前无该工具，配置后需重新连接客户端，不能以独立握手冒充本聊天已连接。

顺序：保存计划 → 安全备份 → 追加配置 → TOML 与旧配置比较 → MCP 协议验证 → 记录结果并说明客户端重新连接要求。回滚只删除本次新增服务段，不覆盖后续其他配置。

验收：配置解析成功、原有配置保持、服务握手成功、完整工具可列出、只读工具调用成功；当前聊天实际工具可用需客户端重新连接后验证。

官方注册依据：https://developers.openai.com/learn/docs-mcp 。本地技能：/home/a/.agents/skills/craft-anything/SKILL.md。

状态：注册、原配置保持检查及独立 MCP 握手/工具调用均完成。客户端重新连接后的实际工具可用性待验证；进度见 craft-anything-mcp-progress.md。
