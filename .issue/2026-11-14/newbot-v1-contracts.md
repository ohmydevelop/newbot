# NB-V1 · 接线契约草案（G0）

状态：源码调查后的设计约束，未实施多 Bot 授权；需在 G1 真实闭环中验证。

## 身份与权威

目前 `server/db.ts:owns` 只检查 threads 表是否存在该 ID。实例登录是单实例权限，不能把这个方法的名字当成多用户或多 Bot 所有权证明。旧实例先映射到一个 default Bot；新增 Bot 入口必须在完整作用域校验落地后开放。

| 标识 | 来源与用途 | 约束 |
|---|---|---|
| principal / botId | 服务端会话认证及授权解析 | 不信任 forwardedProps/state 中自报身份 |
| sessionId / nativeThreadId | 新前端逻辑会话映射到已有 Codex thread | 旧 thread ID 保持，不复制原生历史 |
| requestId | 一次用户发送生成的 UUID，落入现有 runs 表 | 重试复用，同 ID 不同规范化 payload 拒绝 |
| AG-UI runId | adapter 公开运行 ID | 明确映射 requestId/native turnId；不能混用两种 ID 做 stop |
| callId/actionId | 原生工具请求及动作账本 | 回传绑定线程、轮次、注册 schema、消费者及期限 |
| nodeId/epoch | 现有 Runner 控制面 | 旧节点回执不能覆盖当前执行 |
| revision | Provider/工具/权限配置 | 接受时冻结；下一轮才采用新配置 |

Codex 拥有执行循环与历史。Newbot 拥有登录、归属、配置、回执、可信审批与持久索引。CopilotKit 是后端状态的前端投影。Zustand 保留 shell/设置/草稿。A2UI core 负责协议状态处理，Host 管 App 实例。不得添加 Runtime 自己的模型循环或第二份可覆盖原生历史的消息数据库。

## AgentRunner 对现有管线的约束

- `run`：仅派发本轮新增输入，不能将 CopilotKit 发送的全部 messages 再逐条执行。必须复用 `/api/agent/run` 背后的容量/指纹/回执/私密输入/配置冻结逻辑；后续提取为共享服务，而非复制 route 大段逻辑。
- `connect`：只读已确认历史并订阅事件，绝不调用 run。恢复到 unknown 的副作用任务只显示待核对，不自动重发。
- `isRunning`：由服务端回执和对应 native turn 决定，不根据浏览器 loading 猜测。
- `stop`：解析请求所指的确切 run 对应 native turn，旧 run 停止请求不得中断新 turn。断开响应流只取消订阅。
- CopilotKit 1.88.0 的公开 Runner 请求包含 ownerId 和 stop.runId（来源：安装包 d.mts）；adapter 必须在可信层传入且执行校验，不能因为类型有该字段便认为已安全。
- 当前 `STATE_SNAPSHOT` 是 `{thread}`；标准消息投影需提供稳定 item/message ID，先验快照+delta 不重复，再接前端。当前 EventFeed 是有界传输缓存，不是持久日志。
- 运行端点复用 Fastify cookie、Origin、body limit、登录过期与维护模式。标准 Request/Response 转换不能丢掉这些约束，也不能转发浏览器自报的内部凭证。

## Actions 与授权

纯 UI 动作注册成 Codex dynamicTools 的受限目录，native 触发后由持有消费租约的浏览器返回同 callId 结果。无浏览器/超时保留等待或失败，不伪造成功。文件、命令及外部服务副作用仍在 Server/Connector 执行。

可信授权来自服务端规范化后的意图。A2UI 表单只提交业务数据，不拥有授权权限；插件证书、OAuth token、私密输入不进普通 Agent state。AppBridge 保持独立 origin、工具来源校验和现有授权管线。

## 数据兼容与隔离

先添加版本化映射再切换读写；不改写或搬移旧 Home/历史。新 A2UI 写协议版本，旧 0.9 路径继续只读恢复。未知版本显式失败，不能按 1.0 猜读。

多 Bot 执行隔离候选为不同 OS 身份或无特权容器；本轮未定案、未验证。不以不同目录或 thread 过滤宣称强隔离。此项未完成前不得开放不可信 Bot 执行。
