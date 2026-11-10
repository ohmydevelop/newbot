# Cloudflare 临时分享

当前实例使用两条 Quick Tunnel：主工作台和独立的 MCP Apps origin，均指向本机 `127.0.0.1:3100`。主站仍要求现有密码登录，密码保存在 `.data/initial-password`；不写入分享链接或日志。

当前地址见 `.data/public-share.json`。`.env` 中设置了精确的 `PUBLIC_ORIGIN`、独立 `APP_ORIGIN`、`AGENT_TRANSPORT=poll` 和 `TRUST_PROXY=true`。HTTPS 登录会设置 Secure / HttpOnly / SameSite=Strict Cookie，反向代理仅信任 loopback。

Cloudflare [Quick Tunnel 不支持 SSE](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/)，因此临时分享以短轮询传送同一套 AG-UI 事件，保留事件增量、审批和断线恢复。轮询缓冲有数量/大小上限；落后或服务进程改变时，重新读取权威状态。默认 SSE 传输仍可在非临时分享配置中使用。

Quick Tunnel 的地址是临时的，停止 `cloudflared` 后失效，没有在线时长保证。不要把它视为固定域名部署。

停止本项目的两条分享隧道：

```bash
node scripts/stop-sharing.mjs
```

该命令检查进程工作目录、命令与 PID 文件，只停止本项目创建的两条隧道，不停止其他 Cloudflare 服务，也不停止本地工作台。

改用固定域名的 Cloudflare Tunnel 时，将 `PUBLIC_ORIGIN` / `APP_ORIGIN` 改成对应 HTTPS origin，并将 `AGENT_TRANSPORT` 恢复为 `sse`。不要提交 `.env`、`.data` 或隧道凭证。

测试实例的 Web 服务现由当前登录用户的 systemd 临时单元 `newbot-test.service` 管理，避免依赖交互终端寿命。查看状态：`systemctl --user status newbot-test.service`；停止：`systemctl --user stop newbot-test.service`。日志为 `.data/server.log`，只写路由模板与状态；它不会自动改变两条分享隧道的状态。该临时单元不保证主机重启后恢复，正式部署请使用生产 Compose 与 Named Tunnel 服务。
