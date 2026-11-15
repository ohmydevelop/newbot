# NB-V1-ONLINE · 用户要求在线预览

2026-11-15，用户“给我在线”。这是对新版验证界面提供在线入口的明确授权，不等于G1/G2全部验收或替换原实例。

## 目标与约定
用户从手机打开HTTPS链接，使用原newbot密码登录并与真实模型聊天。原实例与聊天数据保持可用；预览聊天必须在独立数据目录内，正常重启不能删除。预览只开放已验证的文本聊天链路，不把配置、插件安装、主机文件和未完成动态UI接口一并暴露。

## 当前证据与风险范围
- 当前serve-browser仅loopback3161，退出会删除测试目录；不能直接成为在线预览的常驻入口。
- 已有Fastify登录限速、精确Origin、Secure/HttpOnly cookie和CSP可复用；原账号是单实例密码。只复制其密码哈希，不打印或另发密码，不复制会话cookie。
- 原newbot-test.service端口3100仍运行。新增独立3162服务与Cloudflare隧道，保持原服务及域名。
- Codex/Provider复制使用已有isolatedProvider，只复制配置与加密Provider凭证；新建独立native Home/工作区。所有审批拒绝，前端Action/A2UI/Apps不在本次开放范围。
- G1依赖审计/性能未过生产门槛仍有效。本次是用户明确要求的认证预览，不宣称生产正式迁移。

| 同类风险 | 状态 | 验证 |
|---|---|---|
| 未登录/非法Origin | 有代码证据，公网待验证 | 401/403、Secure cookie、登录成功 |
| 额外API与配置/插件/文件入口 | 待验证 | 共享预览白名单：仅session/login、thread创建读取、指定Copilot agent info/run/connect/stop |
| 服务重启丢失预览聊天 | 原lab行为已确认不适用 | 持久目录.data/v1-online；重启后保留DB/native/登录及聊天 |
| 临时Cloudflare链接变更 | 已知限制 | 常驻隧道，本次记录实际URL；不承诺trycloudflare永久域名 |
| 原实例受到影响 | 待验证 | 新旧端口/数据/PID分离，原PID/入口不变 |

## 实施顺序
1. 新增独立预览启动器与共享路由白名单；不修改正式聊天UI和原生产构建。
2. 首次原子初始化.data/v1-online，复制原密码哈希和加密Provider数据；后续复用独立目录。退出仅关闭，不删除用户预览聊天。
3. 用systemd用户服务常驻app和隧道；仅loopback监听，HTTPS公开域名作为唯一允许Origin。
4. 实际公网检查登录、未授权、Origin、被禁用接口；通过浏览器发送真实模型消息并刷新。重启应用确认历史恢复。
5. 记录URL/服务/证据并给用户可点击链接。密码与凭证不进入issue或git。

验收：链接HTTPS可访问；原密码可登录；模型真实回复；持久恢复；原newbot继续运行。状态/未完成项写入同目录online-preview-progress。此入口后续可单独停止服务/隧道回收，不删除预览数据，也不回滚原生产数据。

## 本轮结果
已完成认证在线预览，真实模型及应用重启恢复已验证。原实例本地响应正常、PID 未变；原域名公网 TLS 检查未通过，独立记录，不宣称其公网正常。详见 [进度与证据](newbot-v1-online-preview-progress.md)。
