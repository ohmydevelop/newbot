# CHATGPT-AUTOSTART-20261113 实施与验证记录

2026-11-13（Asia/Shanghai）。计划：`chatgpt-autostart-plan.md`。

## 已完成调查

- 完整读取既有 ChatGPT 重启调查计划与进度；核对当前二进制、用户服务、桌面启动器、图形会话环境和 SDDM 自动登录配置。
- 当前 ChatGPT 主 PID 1583708；没有已有 ChatGPT 服务需要覆盖。没有变更其他未提交工作。
- 已发现需要处理的进程边界：Chromium 扁平 cmdline、renderer 子进程、跨 scope 主进程。

## 实施结果

- 新建 `/home/a/.local/bin/chatgpt-supervisor`（0755）及 `/home/a/.config/systemd/user/chatgpt.service`；新增前没有同名配置，不覆盖既有文件。
- `systemd-analyze --user verify` 与 Python 语法检查成功。
- 14:23:42 CST 执行 daemon-reload、enable --now；建立 graphical-session.target.wants/chatgpt.service 链接，服务 active/running、enabled。
- 真实监督器初始 PID 1669744，日志报告观察既有 ChatGPT PID 1583708。只对监督器执行 SIGKILL，systemd 约 10 秒后恢复，监督器新 PID 1670779、NRestarts=1；ChatGPT 主 PID 1583708 始终不变。
- 没有新增 Omarchy hook：已有 graphical-session.target 是直接的会话生命周期入口，同时提供停止、OOM 与重新启动语义，无需再建重复启动入口。

## 可追踪验收

| 问题 → 原因 | 关联功能 | 修复/检查步骤 | 验收证据与结果 |
| --- | --- | --- | --- |
| 重启不启动 → 没有持久启动注册 | SDDM 自动登录、图形 session、user linger | 注册 graphical-session.target；PartOf 随注销停止；沿用现有自动登录 | `installed-state.json` 的 enabled、active、target wants 均通过；实际重启/注销未测。 |
| 退出不恢复 → 临时 scope 无持久监督 | 崩溃、普通退出、OOM | 独立 supervisor + Restart=always、RestartSec=10、OOMPolicy=stop、StartLimitIntervalSec=0 | `checks.json` 替身 SIGKILL/SIGTERM 恢复通过；`service.log` 真实监督器 SIGKILL 恢复通过；真实应用崩溃/OOM 未测。 |
| 启用可能重启当前会话或重复启动 → 当前实例已由其他入口启动 | 手工启动、重复 systemctl start、监督器重建 | 先检测并观察现有同用户主实例，等待其退出再启动；恢复前再次检测 | `checks.json` 外部实例接管/重复 start 通过；`installed-state.json` 监督器恢复前后真实主 PID 都为 1583708。 |
| renderer 残留被当成主进程 → Chromium 重写 cmdline | zygote、renderer、更新后 deleted executable | UID、comm、exe、参数边界和进程状态共同判定 | `verify.py` 对 NUL/扁平参数、renderer、zombie、其他二进制及 deleted 路径断言通过。 |
| 无法主动关闭恢复 → keep-running 策略 | 用户停止服务 | 使用 systemctl stop/disable 而非只 Quit 应用 | 隔离测试 stop 后等待 11 秒（超过 RestartSec），未重新启动；`checks.json` 通过。 |

## 证据位置和验证边界

全部新证据位于 `evidence-chatgpt-autostart/`：

- `before.txt`：安装前现场摘要。
- `chatgpt.service`、`chatgpt-supervisor`、`effective-unit.txt`：实际配置副本及 systemd 生效配置。
- `verify.py`、`checks.json`：7 项隔离检查及结果。替身为复制的 `/usr/bin/sleep`，在临时目录命名为 ChatGPT；使用实际监督代码和 transient systemd service。只替换替身可执行路径/启动器并把观察轮询缩短至 0.1 秒，恢复等待与 systemd RestartSec 保留 10 秒。实验结束停止临时单元并清理替身/临时目录。
- `installed-state.json`、`service.log`：真实监督器恢复证据、target 注册与真实 ChatGPT 原 PID 保持不变。
- 替身证明进程生命周期规则，不证明 ChatGPT GUI、数据库恢复、真实 OOM 后的应用兼容性或下一次开机已实际执行。

## 操作与回滚

默认保持运行：主动 Quit 也会重新打开。现有实例退出由轮询检测（最多约 5 秒）后等待 10 秒；后续受监督实例退出由 systemd 延迟 10 秒重试。

- 查看：`systemctl --user status chatgpt.service`
- 暂停当前会话恢复：`systemctl --user stop chatgpt.service`，然后可正常退出应用。
- 永久关闭自动启动与恢复：`systemctl --user disable --now chatgpt.service`。
- 重新启用：`systemctl --user enable --now chatgpt.service`。
- 完全回滚：先 disable --now，再移除本轮新增的两个用户配置文件，执行 `systemctl --user daemon-reload`。记录文件可保留。

## 完成状态及未解决项

**用户要求的启动/恢复配置已安装并启用；安全验证已完成。** 当前应用未被重启，产品代码和其他正在进行的仓库修改未触碰。

真实桌面崩溃、OOM、注销/主机重启后的端到端验证未执行，以保留当前工作会话。历史内存压力根因仍未消除；本轮不承诺防止崩溃，也不检测进程仍存在的卡死或 renderer 单独失效。需要图形会话运行；磁盘解锁等发生在桌面之前的系统步骤没有改变。
