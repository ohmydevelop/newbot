# CloudWalker 导入进度

> 后续状态（2026-11-10）：用户已自行通过页面安装 CloudWalker 原始 0.5.0 ZIP。只读核实两个技能已选择，但固定内核未发现包内 MCP；原包没有用户配置字段声明。当前配置问题转入 [插件统一配置计划](plugin-configuration-plan.md) 与 [进度](plugin-configuration-progress.md)。以下未安装/浏览器阻塞记录保留为先前阶段事实。

- 已核对 New App 包版本、SHA-256、清单、两个技能、stdio 启动方式与 39 个文件的大小/执行位。
- 隔离解压复现单文件 8 MiB 拒绝；未执行包内程序，未上传或安装。
- 浏览器控制在用户选择 Web 界面后再次检查仍关闭；已请求用户开启。

## 已完成：导入资源限制修复（CI-01、CI-02）

- `shared/imports.ts` 的单文件限制由 8 MiB 调整到 16 MiB；总包 32 MiB、来源 64 MiB、4096 文件及解压膨胀防护保持。
- `server/session-extensions.ts` 复用相同文件/包预算，避免 ZIP 或目录成功后在会话资源复制时再次失败。
- `server/import-files.ts` 给出包含具体文件路径的超限错误，区别于总大小或压缩膨胀超限。
- 7 项针对性测试通过，覆盖 9 MiB 内容和执行位保留、超过 16 MiB 拒绝、ZIP 越界/链接/CRC/压缩膨胀、暂存配额、安装回滚、下一轮资源快照与工作区隔离。类型检查通过。
- 证据：[targeted-tests.log](evidence-cloudwalker-import/targeted-tests.log)、[typecheck.log](evidence-cloudwalker-import/typecheck.log)。

## 已完成：当前实例兼容包准备（CI-04；不等于正式安装）

- 原包 native 扫描只能发现两个技能，未识别 MCP，见 [native-scan.json](evidence-cloudwalker-import/native-scan.json)。
- `.codex-plugin/plugin.json` + `.mcp.json` 可识别 MCP；但当前固定版本没有展开 MCP 启动路径占位符。诊断程序证实占位符原样进入参数，进程中也不存在对应根目录变量；绝对缓存路径可以正常启动同一二进制。证据：[native-path-diagnostic.json](evidence-cloudwalker-import/native-path-diagnostic.json)。
- 派生包绑定当前实例原生缓存路径，原始清单改名保留，原包其余资源与执行位逐文件比对不变。它不是跨机器通用包，移动运行目录需重新生成。
- 生成文件：`/home/a/Documents/ChatGPT/newbot/.data/import-ready/cloudwalker-0.5.0-newbot-local.zip`。
- SHA-256：`e347de41c554dd89fe6567cc8752161f4e3dcd162665463b5811364b82835a1e`。原包 SHA-256 未变化，见 [prepared-artifact.json](evidence-cloudwalker-import/prepared-artifact.json)。
- 隔离原生验证：42 个文件、两个技能、1 个 MCP、7 个工具；`ui://cloudwalker/security-workspace/v1.html` 返回 926917 字节 MCP App HTML。重启隔离运行时后结果一致。未创建模型 Turn，未调用牧云业务接口，未读取或写入真实平台凭证。
- 本机包与隔离测试包仅实例路径绑定不同；真实 Web 导入、业务访问与浏览器渲染尚未验证。
- 可复现脚本：[prepare-local-package.py](evidence-cloudwalker-import/prepare-local-package.py)、[verify-local-package.mjs](evidence-cloudwalker-import/verify-local-package.mjs)。结果：[local-package-verification.json](evidence-cloudwalker-import/local-package-verification.json)。

## 已完成：测试服务更新

- 空闲维护锁下备份、构建并重启成功，当前 PID `1494072`；能力接口确认单文件限制已为 16 MiB，Codex 仍是 0.165.0，SQLite 仍是 v13。
- 23 个线程、68 次运行、5 个附件数量保持；抽查 3 个原线程历史一致。登录密码、凭证密钥、Provider 配置、实例配置和个人 Codex 配置未变化。
- 证据：[service/local-update.json](evidence-cloudwalker-import/service/local-update.json)。

## 未完成与阻塞（CI-03）

- 最新浏览器工具仍返回 `Local browser use is disabled in Work settings`，无可用浏览器或应用。需要用户开启 Work 的本地浏览器控制。
- **未向实际 newbot 安装 CloudWalker**。临时原生验证目录已清理；不以 API 或数据库写入代替用户明确要求的页面导入。
- 浏览器启用后：进入 newbot「扩展 → 技能 → 添加技能 → ZIP」，选择以上本机兼容包，核对完整插件、两个技能和 `cloudwalker` MCP，确认导入；再从页面核对安装/启用状态和工具能力。已有同内容安装应跳过，不覆盖未知版本。
- 实际平台使用另需通过受信任凭证流程配置接收方地址与授权，本轮未处理。界面资源读取通过不代表真实平台连接或可视化页面交互已通过。
