# CRAFT-MCP-20261113 进度与验收

已完成注册与独立 MCP 连接验证。

问题 → Codex 缺少服务注册；原因 → 已安装 CLI/skill 但未配置 MCP；处理 → 在 /home/a/.codex/config.toml 新增 craft-anything 服务，mcp --all-tools，启动超时 30 秒，保留 rebuild_start approve；证据 → evidence-browser-access/craft-mcp-registration.json。

备份在 /home/a/.codex/config.toml.before-craft-mcp-1794565536775607115.bak（0600）。写入前后 TOML 对象比较证明原有配置未变。未改其他客户端和浏览器配置。

验证：codex mcp get craft-anything --json 显示 enabled=true、正确绝对路径及参数。使用保存的 command/args 启动独立 stdio 客户端，initialize 成功，服务 craft-anything 0.6.0、协议 2025-06-18；tools/list 返回 322 项，core_session_show 调用成功。测试服务退出后已回收。证据见 evidence-browser-access/craft-mcp-verification.json。

尚未验证：当前桌面聊天重新加载后的实际工具调用。技能明确要求安装成功后 restart or reconnect their app；本次未主动重启正在工作的桌面应用。用户重新连接/打开 Codex 后可验证当前聊天工具注册。独立连接成功不等于当前聊天已热加载。

此任务仅注册 MCP，不代表之前的浏览器授权故障已修复。

重启后补充验收：当前聊天已出现 mcp__craft_anything 工具；core_investigation_show 与 core_session_show 通过真实 MCP 调用成功，客户端接入验证完成。默认 MCP session 未绑定旧 .cany 项目，旧调查仍保存在原项目中。
