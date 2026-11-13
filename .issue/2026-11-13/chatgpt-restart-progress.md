# CHATGPT-RESTART-20261113 调查记录

2026-11-13（Asia/Shanghai）。本轮为原因分析，未修改产品代码或系统配置，未主动重启/停止任何用户服务。

## 已完成的证据链

| 问题 | 原因或边界 | 关联入口 | 处理步骤 | 验收证据 |
| --- | --- | --- | --- | --- |
| ChatGPT 反复退出 | 至少两次是整机 RAM 与 swap 超过 90% 后被 systemd-oomd 终止 | code-server 同样两次终止 | 读取 system/user journal，按 PID 与桌面日志交叉定位 | `evidence-chatgpt-restart/oomd.log`、`chatgpt-scope.log`、`desktop-lifecycle.log` |
| 是否是 newbot 的 Codex 直接冲突 | 当前二进制、状态目录、工具管道、进程组均独立 | 配置、插件、技能、服务重启、runner 停止 | 核对 /proc 白名单环境、进程归属、源码与实际导入的构建块 | `processes.json`、`build-isolation.txt` |
| 是否是 newbot 把机器内存耗尽 | 故障时逐进程归因仍未知；当前多个应用/开发任务共用资源 | 构建、测试、编程工具 | 只读检查内存、swap、压力与 cgroup；提出后续采样方案 | `memory.txt` 是当前快照，不是故障前历史 |

## 时间与运行边界

- 2026-11-12 10:49:19：`app-org.chromium.Chromium-19719.scope` 被 oomd 终止；桌面日志 PID 19719 的最后事件为 10:48:54。
- 2026-11-13 10:58:46、11:23:02：code-server 由同一内存/swap 超 90% 条件终止。
- 2026-11-13 11:49:15：`app-org.chromium.Chromium-307597.scope` 被 oomd 终止；桌面 PID 307597 日志从 10:43:57 到 11:49:06，与系统 scope 时间一致。
- 11:54:35：桌面应用 PID 737327 启动。日志中的 UTC 时间已经换算 +08:00。
- 调查最初，newbot 服务 PID 721670，子 Codex PID 721703，PGID 721670；桌面应用 PGID 737304。其后另一个已有开发进程执行构建并重启 newbot，新服务 PID 804705、子 Codex PID 804750。保存的最终快照中 ChatGPT 仍是 PID 737327。该重启并非本次调查执行。
- 当前服务使用本仓库 `dist/server/index.js` 与 3100 端口，ready 只读接口成功。源码与实际公共构建块都包含目录隔离、环境过滤和定向进程停止机制。
- 快照仅采集环境路径白名单和敏感环境变量的存在布尔值，没有读取/保存 token、auth.json 或聊天正文。

## 检查边界

- 没有为了复现主动耗尽内存，也没有在已有资源压力下追加完整构建/测试。
- `journalctl -k` 没有发现相关内核 OOM 终止；进一步检查用户态 `systemd-oomd` 才找到直接证据。内核无记录不是“没有内存问题”的证据。
- 没有对应近期 ChatGPT crash dump；其他 jq 崩溃未作为 ChatGPT 故障原因。
- 目录隔离不提供 OS 级资源隔离；同用户完全访问任务仍有系统操作能力。本轮没有发现其直接操作桌面应用的证据。
- 当前 RSS/swap 会随负载快速变化，不以采样值证明某个应用是 OOM 时唯一占用来源；scope 的历史峰值也不等于某一主进程的峰值。
- 用户尚未细分桌面退出、网页刷新和 Codex 重连。结论限定于本机已确认的两次桌面应用终止。

## 状态与下一步

分析完成；资源治理尚未实施；反复退出问题不能标记为已修复。
后续按 [调查计划](chatgpt-restart-plan.md) 采集故障前资源历史，再决定并发控制、独立服务资源预算或进一步的桌面诊断。现有未提交产品修改属于其他工作，本轮未触碰。

## 第二轮：用户反馈空闲时也反复重启

- 完整读取既有重启调查及自动恢复计划/进度，并重新核实实际服务与监督器。
- 17:23:25、17:25:07、17:29:16：oomd 明确选中 chatgpt.service；每次理由均为整机 RAM 与 swap 使用同时超过 90%。分别在 17:23:35、17:25:17、17:29:26 启动新实例。
- 17:15:41：code-server 被同一机制终止，说明风险跨应用存在。
- 核实时服务 NRestarts=6；此数包含其他重启，不将六次全部认定为本轮三次 OOM。
- 当前快照：物理内存 7.6 GiB，available 约 1.4 GiB；swap 总量约 11 GiB、已用约 8.6 GiB。此为事后快照，不能替代故障时日志或确定泄漏来源。
- 因果追踪：随机退出 → 整机 RAM/swap 阈值 → ChatGPT/code-server → 后续资源采样与负载治理 → 本轮证据为 evidence-chatgpt-restart-round2/oomd.log、lifecycle.log、effective-unit.txt。
- 自动恢复在真实 OOM 后确实执行；窗口/会话完整恢复未做 UI 验证。未主动终止任何应用，未改内存、swap、启动或 OOM 配置。根因治理仍未实施。
