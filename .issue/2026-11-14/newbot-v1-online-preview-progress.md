# NB-V1-ONLINE · 上线验证记录

2026-11-15，已完成本轮认证在线预览，未将整个 v1 标记生产完成。

## 入口与运行状态

- HTTPS: https://bali-watt-composed-rain.trycloudflare.com/
- 使用原 newbot 密码；未把密码、cookie 或 Provider 密钥写入记录。
- `newbot-v1-preview.service` → loopback 3162；`newbot-v1-share.service` → 独立 Cloudflare quick tunnel。均为 systemd 用户 transient 服务，进程异常自动重启；不是开机永久域名方案。隧道重建可能换域名，需要同时更新 PREVIEW_ORIGIN 并重启预览应用。
- `.data/v1-online` 独立持久目录；首次原子导入原密码哈希及加密默认 Provider 凭证，未导入原会话、聊天、插件。退出不删除数据，后续启动不覆盖数据。
- 原实例 PID 1291921 保持不变，loopback 3100 返回 200。本轮访问原公开域名出现 TLS EOF，不能证明原公网入口可用；新入口 HTTPS 实测可用，没有改动原隧道或实例。

## 问题 → 机制 → 验收证据

1. 临时 lab 退出清理会丢失在线聊天 → 单独持久化启动器 → 真实浏览器发消息，应用 PID 从 2304406 变为 2307278 后刷新，登录和原消息均恢复，数据库 thread/run IDs 不变。
2. 直接复用原 Server 会开放超出预览范围的 API → 共享预览 allowlist → 8 个 runtime 测试全部通过，覆盖认证、Origin、重复执行、跨线程、取消、断线和禁止路径。使用 FakeCodex 的部分仅证明边界行为。
3. 公网服务必须实际工作 → 原密码从 HTTPS 登录，deepseek-flash 实际回复“在线聊天已连接。”，非模拟上游。点击发送后浏览器立即呈现用户消息及“停止生成”；完成后恢复发送状态。
4. 公网安全边界 → 实际 HTTP 验证未登录 401、缺失/错误 Origin 403，登录 200，cookie Secure/HttpOnly/SameSite=Strict，配置/插件/附件/备用执行入口 404；原服务认证链没有被绕开。

`npm run check` 通过；`git diff --check` 通过。未修改前端产物，不重新构建正在运行的原实例。

证据位于 [evidence-v1/online-preview](evidence-v1/online-preview)：public-http.json、before-restart.json、after-restart.json、public-after-restart.png。代码入口为 labs/v1-integration/serve-online.ts，隔离/路由机制在 online-preview.ts。实施依据见 [计划](newbot-v1-online-preview-plan.md)。

## 明确边界

这是文本聊天集成预览。插件、附件、完整工具/思考展示、Actions、A2UI、MCP Apps 等尚未迁移完成，不能作为这些功能的验收入口。已有依赖审计和首屏体积门槛保持开放；没有把预览验证等同于正式生产准入。原密码后续变更不会自动同步到已初始化的预览。服务持久化不等于快速隧道永久可用。
