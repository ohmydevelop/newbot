# AUTO-7C 实验进度

2026-11-17：核对源码与 AUTO-7/AUTO-7B 记录；用户已授权开发实验。已落盘 E1–E8、隔离范围与验收边界，开始实现。尚无通过结果。

## 实现与共同机制

完成 examples/event-subscriptions 隔离模块：版本化插件声明 + 受控适配器注册表、独立 SQLite、共享订阅、来源 inbox/目标快照/checkpoint 原子写入、持久待 ack 回执、逐目标幂等派发、配置修订/租约与插件代际 fencing。现有 automationBridge 内部接收保持原队列、权限/版本检查及任务会话机制。

先持久化整页和所有目标再 ack；一个目标的接收回执丢失可使用同一个稳定事件 ID 重试。目标分别保持 FIFO，失败目标不阻塞同源其他任务。另核对并修正了租约取得后使用旧调度快照的风险：poll 时间及阻断状态重新读取当前数据库，不依赖循环开始时的旧列表。

未新增运行依赖，未改 server/web/shared 或生产 DB schema。package.json 仅添加两条实验命令。loopback 适配器、上游模拟和 FakeCodex 均明确属于实验，不是 Gmail/GitHub 实际实现，不改变当前 Grok 界面。

## 可追踪验收

|问题/约定|验证与结果|证据|
|---|---|---|
|E1 出站/共享监听|两个任务共享一次初始拉取；Newbot app.server.listening=false；后台 run 无浏览器可持续接收|tests/event-subscriptions-http.test.ts；evidence-subscriptions/lab.json|
|E2 落盘再确认|真实子进程在提交后 ack 前 process.exit(73)，重开数据库后 cursor/receipt/目标仍在；补发未重复创建 run|examples/event-subscriptions/crash-worker.ts；lab.json|
|E3 竞争/迟到|双实例租约、过期接管、关闭时中止网络、卸载/替换代际 fence 均通过|tests/event-subscriptions.test.ts；tests/event-subscriptions-http.test.ts|
|E4 多目标可靠派发|成功回执丢失 + 另一目标失败 + reopen，恢复两次有效运行；单目标 FIFO 不阻塞另一目标|单测与 lab.json；两任务最终四次有效执行|
|E5 受控插件|未知适配器、额外 execute 字段、未知事件被拒绝；卸载后重新安装不会自行启用|tests/event-subscriptions.test.ts|
|E6 初始化/故障|历史基线不触发；401/403/410/429/503、Retry-After、体积限制、禁止跳转与超时通过；capacity/conflict 原子回滚不推进 cursor|两份实验测试；错误文本不进入状态存储|
|E7 隔离/幂等|不同连接同 ID 隔离；payload 键顺序无关；同 ID 不同内容阻断且整页回滚|tests/event-subscriptions.test.ts|
|E8 任务生命周期|真实 Newbot 队列：暂停/修改/删除拒绝旧绑定；两轮执行为同一 thread、不同 turn|lab.json；原 automation-events/automations 回归|

最终自动检查：`node --import tsx --test tests/event-subscriptions.test.ts tests/event-subscriptions-http.test.ts tests/automation-events.test.ts tests/automations.test.ts`，33/33 通过（12 新增 + 21 回归），见 evidence-subscriptions/tests.txt。

类型检查：`npm run check` 通过，见 evidence-subscriptions/typecheck.txt。

实验复现：`npm run experiment:subscriptions -- --report .issue/2026-11-17/evidence-subscriptions/lab.json`，6 项集成检查通过；两任务、四次运行、各一会话，见 lab.json 和 lab-output.txt。

## 下一阶段与限制

本轮实验完成；正式功能仍待以下阶段，不能把本记录作为已上线声明：

1. 将已验证的收件/确认/派发机制接入生产插件生命周期、账号凭证系统与数据库迁移；替换实验 webhook 类型桥，保留旧触发器与会话。补清理保留期、重试抖动、监控和调度公平性。
2. 实现 Gmail history 增量同步，逐项选择 GitHub 事件语义及轮询 API；再接可选 Pub/Sub/中继。首次同步竞态、分页与 history 过期不得静默跳过。真实 OAuth、watch 续期、代理/自签名证书与平台配额须实测。
3. 接入“应用→账号→事件→条件”UI，复用既有组件和 Grok 交互后做浏览器/移动端验收；默认不要求公网 URL。
4. 真实账号/模型与受限入站网络环境验证完成后，才进入发布验收。当前消费者无监听，但未实际配置物理防火墙；当前上游和模型为替身。实验存储保留最多 1000 条来源去重记录，满后明确停止，未实现长期回收。

未运行 UI 浏览器测试：本轮没有改 UI 或生产入口。未更改线上数据、证书、凭证或服务；未新增外部订阅，也未发送邮件/消息。
