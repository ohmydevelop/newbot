# NB-V1-G1-RUNTIME · 真实执行接线

状态：2026-11-14 用户要求继续；在修改产品代码前记录。

## 用户目标、触发与行为约定

通过 CopilotKit 发送一轮真实 Codex 对话，支持重连和精确取消。当前 lab 只有 RecordingRunner，不能执行模型。预期新版入口沿用现有登录、Origin、维护、配置冻结、私密输入和持久回执；一次 requestId 只派发一个 native turn，断开流只解绑订阅，旧 run 的 stop 不影响新 run。

## 调查与因果边界

- `server/index.ts` 的发送 handler 同时持有业务执行与 Fastify reply。它已经实现异步准备后的并发栅栏、指纹、回执、私密字段授权、Provider revision 保持。直接从新 Runner 调用 turn/start 会绕过它们。
- `server/ag-ui.ts` 输出 native turn ID，并使用 Newbot `{thread}` 快照；CopilotKit run ID 需要映射已有 runs.request_id，不得重建第二执行账本。
- `bridge.readObserved` 可恢复 native 历史；活动 thread 使用现有投影。订阅必须早于读取，按 revision 消除读取期间已包含事件，避免刷新重复文本。
- 现有 Codex `thread/start` 产生 native ID。首批隔离接线只接受服务端已创建的 thread ID；暂不实现前端任意 ID 的持久映射，不能信任浏览器 state 当历史。
- 单实例所有登录属于同一个 default Bot；本阶段不声称多用户/多 Bot 隔离。

## 同类风险清单

| 风险/入口 | 状态 | 关联机制与检查 |
|---|---|---|
| 普通发送、附件、授权等待 | 有代码证据 | 提取同一 submit 函数，不复制执行；跑原发送/凭证/配置回归 |
| 重复请求、异步准备、断流重连 | 待验证新入口 | 同一 runs 回执；新入口重复调用只返回已有执行；connect 禁止 submit |
| 当前轮/旧轮取消 | 有代码证据 | requestId → thread/turn；检查当前 turn 后调用原 interrupt |
| 未登录、异源、登录过期 | 有代码证据 | 同一 Fastify hooks；新长连接复核会话有效性并解绑 |
| 历史快照与增量 | 有代码证据 | 原消息 ID 与 revision；不转发客户端历史作为已确认内容 |
| Actions/私密输入/A2UI/MCP Apps | 待后续闭环 | 本次仅基础文本流；不接受任意 tools/forwardedProps 执行，不伪造完成 |

## 实施顺序与范围

1. 将原 run handler 提取为同一闭包内的传输无关 submit 函数；添加显式带状态的命令错误，旧 HTTP 行为不变。暴露内部命令接口给隔离集成，不新增生产路由。
2. lab 中实现公开 AgentRunner 子类与 Fastify handler，引用原命令接口。服务器决定 owner，runId 使用现有 UUID requestId，只接受最后一个用户文本输入；历史只用于前端展示，配置后续用明确 schema 接入。
3. 对消息做官方 AG-UI 投影，保留稳定 ID；运行/重连结束状态由服务端决定，取消只绑定同一轮次。故障用例验证重复、跨 thread ID、过期 stop、断流、权限和恢复。
4. 独立目录、独立 native Home/工作区启动真实服务；仅把已有 Provider 配置通过既有安全存储接口复制到隔离实例，不复制用户聊天/插件或输出凭证。调用一次明确无工具的模型验证并记录实际派发次数。
5. 更新证据/进度并提交；通过后继续浏览器与动态 UI 接线。暂不移动目录、不切换生产入口、不升级 native。

## 验收与状态

原 run route 的相关回归通过；新 Fastify 路由拒绝缺失 cookie/非法 Origin。真实模型一次发送一次 native 派发，重复 run/connect 不新增执行；旧 stop 不取消新轮；读取/发送错误不输出内部异常内容。

模拟与真实证据分别保存到 `evidence-v1/G1/runtime-*`。动作、附件新前端呈现、审批、A2UI/MCP App 及整套 UI 尚未验收，不以文本闭环代替完整 G1。

当前状态：本文件所述基础文本/浏览器批次已实现并验证；完成证据、未覆盖失败边界及下一步见 [runtime-progress](newbot-v1-g1-runtime-progress.md)。不代表G1整体退出。
