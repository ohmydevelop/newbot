# Issue 001 开发服务更新

用户授权“更新最新”。目标是将当前 3100 服务切到已验证的源码及匹配的 patched Codex，而非只更新前端。

顺序：核对 PID、工作目录和当前状态；取得维护锁以避免中断任务；备份 SQLite、密钥、服务环境、实例 Codex home 和旧 dist；完整构建；固定独立 Codex 二进制并更新启动配置；重启；核对登录、数据库完整性、凭证/配置、近期原线程历史、前端资源及公网入口。

不变量：个人 ~/.codex 不变；原密码、凭证与线程不丢失；协议和内核一致；不创建模型任务；Cloudflare 地址保持不变。有活动任务则暂缓停止；启动失败时停止候选并恢复旧环境、数据库与运行目录后再启动旧服务。

已有证据：428 应用测试、325 原生协议测试、18 原生集成验收；新增 URL 导入 15 项测试与真实浏览器验证。仍不宣称所有第三方 Provider 兼容或完成正式上线验收。

状态：准备更新。证据将保存到 evidence-issue-001/service-update/，过程追加本文件。

## 完成（2026-11-11 16:15 Asia/Shanghai）

- 维护锁成功，无需中断任务。备份位于 `.data/restart-backups/issue001-1794384862914`，含数据库、密钥、环境、旧产物及实例 Codex home。
- 完整 build 通过（包含类型检查与前端压缩、旧一代静态资源保留）；启动使用 `.data/native/releases/fe2f185/codex`，二进制摘要与已验证原生构建一致，`.env` 已固定 CODEX_BIN。
- 服务 PID 3672851，SQLite v16，原密码、凭证密钥、个人与实例配置摘要均保持。30 线程、88 runs、5 附件；近期 3 线程历史 ID/顺序/类型验证一致；未创建模型任务。
- 本地和 Cloudflare 登录通过；公网 HTML 与入口 JS 摘要与磁盘完全一致；liveSettings/pinnedPluginResources 能力均为 true。
- 维护锁已释放，Cloudflare 地址与登录密码不变，原隧道无需重启。

证据：`evidence-issue-001/service-update/local-update.json`、`public-update.json`。脚本：`scripts/restart-issue001-test-service.mjs`。仍不将无模型调用的更新验证称为所有真实 Provider 的兼容验证。
