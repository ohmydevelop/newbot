# 内网事件订阅实验

此目录是 AUTO-7C 的隔离实验，实验入口不由生产 Server 导入，不改变线上数据库或 WebUI。无需真实账号、模型、回调地址或公网隧道。Node.js 24+，使用仓库现有依赖。

```sh
npm run test:subscriptions
npm run experiment:subscriptions -- --report .issue/2026-11-17/evidence-subscriptions/lab.json
```

实验在临时目录创建 Newbot 数据库及独立订阅数据库，结束后清理。仅本地上游替身监听随机 loopback 端口；Newbot 与订阅消费者不监听端口。模型为 FakeCodex，任务保存、接收、队列和会话绑定使用现有 Newbot 实现。

## 组成

- `plugin.json`：版本化、声明式事件能力。适配器必须由宿主提前注册；清单不能指定脚本、密钥或网络地址。
- `../../server/event-subscriptions/contracts.ts`（共用核心）：严格 schema、业务事件、注册表及稳定事件摘要。
- `../../server/event-subscriptions/engine.ts`（共用核心）：独立 SQLite 订阅、来源收件箱、游标、确认回执和逐目标分发记录。订阅按 provider/connection/resource 共享；同步事务内保存整页和目标快照后才能确认上游。
- `loopback-pull.ts`：仅接收显式 IPv4 loopback origin 的实验 Pull 客户端；超时、体积限制、禁止跳转及可分类错误。不是生产用任意 URL 连接器。
- `automation-bridge.ts`：为隔离实验将事件交给现有内部 `receiveEvent`。复用 `webhook` 来源类型但不创建回调入口；正式动态插件注册见 `server/event-subscriptions/service.ts`；本实验保留原桥以验证底层行为。
- `lab.ts` / `crash-worker.ts`：真实 HTTP 和子进程退出实验；持久化后未 ack 即退出，再打开数据库恢复。报告明确模拟边界。

## 约定

1. 初次 Pull 的 null cursor 表示建立基线，只接受空事件页，避免历史消息触发任务。后续 cursor 是上游的 opaque checkpoint，适配器必须正确实现分页与恢复语义。
2. 上游页最多 32 个事件、128 KiB。每订阅实验容量默认 1000 个去重记录，含已完成事件；达到上限进入 capacity 状态，不自动清除去重记录冒险重放。
3. 数据持久化后才 ack；ack 必须可重试。消费者至少一次交付，`deliver` 必须使用稳定 deliveryId 幂等接收。本实验不能证明任意第三方副作用恰好一次。
4. 租约和配置修订阻止迟到响应提交；每次连接操作须遵守 AbortSignal。受控适配器和内部接收器是可信宿主代码，本实验不提供任意代码沙箱。
5. 每个目标保持 FIFO。某个目标失败会退避，但不阻塞其他目标。投递返回 discarded 或 accepted 后才结束该目标；任务端再次核对 enabled/revision/trigger。
6. 安装只注册能力；卸载通过 engine.uninstall 同时禁用订阅。重新安装不自动恢复，必须显式启用。registry 本身不是正式插件管理器。
7. auth_required / gap / capacity / conflict 停止拉取；管理员处理原因后显式重试。gap 不自动清空 cursor 或回放旧消息。临时错误和上游 Retry-After 延迟重试；日志状态不保存原始上游错误文本。

## 尚未进入实验范围

真实 Gmail/GitHub OAuth、Watch 续期及 API 事件语义；生产凭证授权、代理与自签名证书；生产插件安装/升级生命周期与 UI；长期存储回收、初始化并发窗口和历史缺口恢复策略；云端队列与 Webhook 中继产品选型；真实模型执行及物理防火墙验收。生产化前还应增加抖动重试、跨订阅公平调度与运行监控，不能直接将此目录作为完成的通用连接器发布。

AUTO-7D 已将共用核心移至 server，并实现 GitHub 首个正式适配器、账号与 UI。此实验报告仍只证明本地替身范围；正式实现的当前验收与未完成项见 `.issue/2026-11-17/001-plugin-event-sources-integration-progress.md`。
