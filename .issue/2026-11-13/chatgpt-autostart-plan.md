# CHATGPT-AUTOSTART-20261113：桌面自动启动与退出恢复

日期：2026-11-13（Asia/Shanghai）。本轮是用户授权的系统配置工作，接续 `chatgpt-restart-plan.md` 的只读调查，不覆盖历史结论。

## 用户目标、条件与约定

原始请求：`can you set  chatgpt auto start when it crash or restart the host`

- 目标：ChatGPT 桌面进程退出后自动恢复；主机重启进入桌面后自动启动。
- 实际行为：当前主进程 PID 1583708 位于临时 scope；没有 ChatGPT 用户服务或自动启动项。
- 预期：持久的用户服务属于 graphical-session.target，桌面存在时保持应用运行，退出桌面时停止。
- I1：当前会话不能因配置而被打断，也不能额外启动第二个有效桌面实例。
- I2：崩溃、OOM 或监督器退出后，有带延迟的恢复路径；不能因短时间启动失败永久失去恢复。
- I3：恢复只在图形会话中运行，保留现有程序启动器、用户参数、配置、账号及数据库。
- 已询问主动 Quit 的偏好；等待超过一分钟未收到回答后，采用明确告知的默认“保持运行”，主动 Quit 同样重新打开。用户可通过停止服务暂停恢复。

## 调查结论及证据

- `/usr/share/applications/chatgpt.desktop` → `/usr/bin/chatgpt` → `/usr/lib/chatgpt/ChatGPT`。包为 openai-codex-desktop 26.1027.51404-1。
- 系统启动器读取 `~/.config/codex-flags.conf` 并选择 Wayland；继续使用此启动器，不绕过参数。
- 当前 graphical-session.target active，systemd 用户环境已有 WAYLAND_DISPLAY=wayland-1、DISPLAY=:0。
- `/etc/sddm.conf.d/autologin.conf` 已设置 a / omarchy.desktop，当前 sddm journal 也证明自动登录成功。无需修改登录配置。
- 历史 OOM 有证据（`evidence-chatgpt-restart/oomd.log`）；本轮解决缺少恢复机制，不能声称消除了内存压力原因。
- ChatGPT/Chromium 会重写 `/proc/PID/cmdline` 为包含空格的单一参数，并将主进程与部分子进程放入不同 scope。识别时须同时考虑 NUL 和空格参数边界，按 UID、可执行路径及非 `--type` 主进程识别；独立监督器保持在自己的 service 中。

## 同类风险范围

| 优先级 | 关联功能与机制 | 状态 | 证据、处理与纳入理由 |
| --- | --- | --- | --- |
| 1 | 当前桌面与新服务重复启动 | 有代码证据 | 现有实例不属于新服务；先观察现有主进程，消失后才接管启动，不杀当前实例。 |
| 1 | 主进程 OOM、信号退出与普通退出 | 有代码证据 | 既有 OOM 记录；采用 Restart=always、RestartSec=10、无限重试；主动 Quit 也恢复是默认策略。 |
| 1 | 主机重启、注销与 user linger | 有代码证据 | Linger=yes，但图形依赖不能挂 default.target；使用 graphical-session.target、PartOf 与 Wayland 条件。实际重启/注销待验证。 |
| 2 | renderer/zygote 残留导致误认为主程序仍在 | 有代码证据 | 实机 cmdline 为扁平字符串；排除 --type 子进程及 zombie，验证不同参数表示。 |
| 2 | 手动启动、监督器重启、应用更新 | 有代码证据 | 重新扫描同用户主进程；兼容 executable 的 ` (deleted)` 后缀，保留现有 singleton。验证监督器重启不重启 ChatGPT。 |
| 2 | 反复启动失败 | 有代码证据、替身验证通过 | 固定 10 秒退避且无启动次数永久封锁；替身连续两次信号终止均恢复，真实监督器 SIGKILL 后恢复；没有主动杀真实桌面。 |
| 3 | 持续内存压力、renderer 卡死但主进程存在 | 不适用 | 本轮仅配置进程退出恢复，不是资源治理或健康探针；不改 OOM 策略，不声称解决卡死。 |
| 3 | newbot、code-server 等其他服务 | 不适用 | 不是本轮请求的应用；不变更它们或仓库已有产品修改。 |

## 实施顺序、范围与兼容

1. 落盘本计划及进度文件；保存安装前运行证据。
2. 新增 `~/.local/bin/chatgpt-supervisor` 与 `~/.config/systemd/user/chatgpt.service`。保持监督器为服务主进程，等待现有主实例退出，后续调用系统启动器并等待其退出。
3. 验证单元语法及进程识别、退出恢复、重复启动、显式停止边界；替身实验清楚标注，不冒充真实应用崩溃验证。
4. daemon-reload、enable --now；核实 active/enabled、graphical target 链接、日志、ChatGPT 主 PID 未变且只有一个主实例。
5. 更新记录、保留配置副本及验证结果。回滚为 disable --now 后移除本轮新增的两个配置文件并 daemon-reload。

依赖：本机 systemd 262、Python 3、既有桌面环境及 `/usr/bin/chatgpt`。无需安装依赖、迁移数据、修改包管理文件或重启主机。

## 可观察验收及状态

- 当前会话：主 PID 保持 1583708，仅一个主实例，新服务日志报告正在观察已有实例。
- 启动：单元 enabled 且为 graphical-session.target 的依赖，安装后 active；自动登录配置存在。真正重启/重新登录尚不进行。
- 恢复：隔离替身退出后能重新启动；重复启动/监督器被杀后不会产生第二个主实例；显式 systemctl stop 不反弹。
- 进程识别：renderer、zombie、其他 executable 不阻塞主实例恢复；正常参数、Chromium 扁平参数与升级后 deleted 路径均识别。
- 限制：不主动终止真实 ChatGPT、不制造 OOM、不重启或注销用户主机，因此真实崩溃与重启后端到端验收保留待验证。
- 实施状态：**配置安装与安全范围内验证已完成**。服务 enabled/active；主实例仍为 1583708；进程识别、替身恢复、重复启动、显式停止以及真实监督器 SIGKILL 恢复均通过。真实应用崩溃、OOM 与重启/注销后的端到端行为仍待实际事件验证，不将其标记为已测。证据见 `chatgpt-autostart-progress.md`、`evidence-chatgpt-autostart/`。
