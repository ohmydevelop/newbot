# 单次 sudo 身份检查（D6.4）

日期：2026-11-09。已实现独立私密输入与受控 sudo 消费；本阶段唯一操作是 `sudo.identity`，以 root 执行一次固定的 `/usr/bin/id -u`，用于验证本机受控提权链路。只有检查状态返回浏览器，没有通用 root 命令入口、密码保存或 Agent 领取接口。

后续 D6.5 已完成当前受信操作范围的公开输出、错误、日志和 Trace 验证，见 [隔离记录](credential-isolation.md)。下文的数量和下一步描述为 D6.4 当时记录。

## 使用与能力

服务端设置 `SUDO_IDENTITY_CHECK=true` 后重启。Bridge 必须以非 root 用户在 Linux 上运行，`/usr/bin/sudo` 必须是 root 持有且带 setuid 的可信可执行文件，`/usr/bin/id` 及路径目录也须符合权限检查。默认关闭；缺失或不可信时能力仍为关闭，不会回退到 shell、askpass 或 Codex 终端。

在“设置 → 安全与运行 → 单次提权检查”发起。工作台显示固定操作、root 身份、接收方和期限，再使用独立密码框提交。可粘贴 UTF-8 密码，保留空格，最多 1024 字节，拒绝换行、空字符和非法编码。每个请求只允许消费一次；密码格式错误尚未启动执行时可以修正。

`trustedInput.sudo` 单独报告此固定检查的可用性；`sudoIdentity` 报告操作、命令、策略版本和 15 秒执行上限，`arbitraryCommands`、`agentRequests`、`persistence` 都是 false。普通 MCP Elicitation 和 A2UI 私密输入仍关闭。可用性不代表本机 sudoers 一定允许提权，也不代表密码已经验证。

## 执行与隔离

- 请求严格校验 Session、精确 Origin、安全连接和请求所属登录。客户端不能指定命令、参数、UID、环境变量或接收方。
- 请求绑定当前 Bridge 用户与可信二进制身份摘要；执行前重新核对。等待输入期间不能重启维护；执行期间持有独占维护锁，拒绝新任务或配置操作。
- 启动独立子进程，固定 cwd 为 `/`，只传入固定 PATH 和 C locale；无 shell、不继承工作台环境、不经过 Codex JSON-RPC、MCP 或普通 PTY。
- 执行 `sudo -k -S -p <随机私密提示> -u root -- /usr/bin/id -u`。只在 sudo 发出本次提示后，向独立 stdin 管道发送一次密码和换行，然后关闭输入并清零 Buffer。输出两通道总量限制为 4096 字节。
- 仅当进程成功退出、stdout 严格为 `0\n`、没有剩余错误正文时报告成功。原始 stdout/stderr、PAM 错误和进程异常均不返回前端、不写业务日志或对话。
- 没有提示便成功的 NOPASSWD 路径报告“系统未要求密码，输入未发送，也未验证密码”。再次提示、多因素交互、超时、失败、反射或非预期输出均停止，不自动重试。
- 取消、过期、登出、运行时失效和服务关闭会撤销未完成请求、清零输入并终止独立进程组；已发生的系统认证无法撤回。浏览器断线不重发密码，只能读取状态。

`-S` 使用 stdin 获取密码，`-k` 与命令组合时忽略现有缓存且不更新缓存，依据 [sudo 官方手册](https://github.com/sudo-project/sudo/blob/main/docs/sudo.man.in)。这里没有执行 `sudo -v` 或全局清理用户的其他 sudo 授权。系统自身的 sudo/PAM 审计仍由管理员策略管理。

## 验证

全量 **253 项自动测试**通过，本轮新增 12 项，覆盖开关与严格操作范围、Unicode/空格、一次消费、NOPASSWD、输出反射、重复提示、超限、错误 UID、超时、取消、撤销、二进制策略变化、格式拒绝、HTTP 归属与维护边界。类型检查与构建通过。

新增 **11 项 sudo 浏览器检查**通过，原临时凭证 12 项与保存流程 14 项回归通过，共 **37 项相关浏览器检查**。验证私密二进制请求、无自动重发、过期清空、焦点恢复、375px 手机深色布局、原始结果不返回及浏览器/数据库/原生调用无测试密码；桌面与手机截图已查看。证据在 `.data/sudo-ui/`、`.data/sudo/`。

`npm run test:sudo-native` 在一次性用户、挂载、PID 和网络命名空间及独立 chroot 中使用本机原版 sudo/PAM。临时账号通过真实密码执行固定 root 身份检查，错误密码、重复提交、取消后提交均失败，随后 `sudo -n` 仍失败，确认未创建缓存。宿主账号和 sudoers 未修改，没有使用用户实际密码或调用模型。失败不静默跳过；该测试需 Linux 用户命名空间、subuid/subgid 映射、util-linux、OpenSSL、本机 sudo/PAM 与开发构建依赖。

```bash
npm test
npm run build
npm run test:sudo-native
npm run test:sudo-ui
npm run test:credentials-ui
npm run test:credential-storage-ui
```

浏览器测试沿用 `PLAYWRIGHT_MODULE`、`PLAYWRIGHT_CHROMIUM_EXECUTABLE`；独立夹具默认端口 3128，可设置 `SUDO_TEST_PORT`。

## 范围与下一步

D6.4 的固定受信消费与独立验证完成。任意 sudo 命令、Agent 自动提权、远程 SSH/sudo、交互终端、MFA 和密码保险库没有开放；未来新增实际管理操作时需逐项定义固定消费者与授权范围。

本模块面向可信宿主和可信项目，同 UID 的恶意进程或系统级调试器不在强隔离保证内。JS 字符串、浏览器及内核缓冲区无法承诺物理擦除；敏感 Buffer 主动清零。D6.5 的完整错误、工具结果、日志和 OpenTelemetry 矩阵仍待完成，正式部署与上线统一验收继续留到 R1。
