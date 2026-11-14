# GCF-8 原生协议与转换边界

调研日期：2026-11-14。资料均已打开；网页内容是协议证据，不是操作授权。

## Codex 优先
官方：https://developers.openai.com/plugins/build/plugins
- 插件以 portable plugin.json / 兼容 .codex-plugin/plugin.json 表达，商店使用 .agents/plugins/marketplace.json；原生解析也识别历史 .claude-plugin/marketplace.json。
- 商店来源支持 GitHub owner/repo、Git HTTP/HTTPS、SSH及服务器本地目录；ref、sparse paths为可选高级项。
- 登记商店与安装插件是两个操作；安装身份为 name@marketplace。newbot采用原生 marketplace/add 准备独立快照，复用既有 plugin/list/read/install/配置和技能执行，不另造执行引擎。
- 多商店注册保存在SQLite；安装和配置继续使用现有扩展资源版本机制。更新准备新快照后发布，失败保留旧快照。已安装插件所在商店不能直接移除。
- 真实 pinned Codex 验证了两个商店同名插件、选择安装、技能发现和重启后的完整配置映射。本轮未使用远程第三方仓库执行代码。

## 后续转换器契约
|输入|转换目标|允许自动转换|必须显式报告或重新配置|
|---|---|---|---|
|Codex portable/native 商店|原生Codex市场和插件|直接交给原生解析器|原生不识别的格式返回错误；不静默改权限|
|Claude 插件/marketplace|Codex原生插件中间描述|名称、版本、说明、SKILL.md及可证明等价的MCP定义|Claude专用agent/subagent、hooks、commands、权限和变量插值需要逐项能力对照；不复制密钥或OAuth会话|
|Grok custom MCP连接器|newbot现有远程MCP连接器|明确提供的名称、URL、普通headers和传输定义|在newbot重新填写私密字段或授权；不能据页面目录反推托管服务凭证或声称存在通用Grok插件包|

每个未来转换器应返回：源生态/版本、标准化清单、文件映射、权限变化、阻止项与警告。预览确认后才进入现有导入发布链路；有不兼容执行能力时阻止安装，不将其降级为空插件。当前版本完成Codex多商店，Claude/Grok转换器尚未实现。

Claude资料：https://code.claude.com/docs/en/plugin-marketplaces
官方迁移入口：https://developers.openai.com/plugins/guides/submit-claude-plugin
Grok资料：https://docs.x.ai/grok/connectors

## 视觉与产品差异
实测Grok当前Add MCP Server为同面板返回层级、Name/Server URL/Headers单列表单和Cancel/Add操作；New Skill为Name/Description/Instructions。newbot保留Codex必要的本地程序、鉴权、分支和导入预览能力，通过高级项和下一层按需显示。后台原生格式不决定前台布局。
截图采集出现IAB表面裁切/重复贴片，损坏截图不作为像素证据；可读DOM和实际单列字段作为交互依据，前轮已验证Grok截图作为既有视觉基线。新版newbot截图须逐张检查完整性。
