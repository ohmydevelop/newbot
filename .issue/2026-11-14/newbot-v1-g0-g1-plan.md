# NB-V1-G0/G1 · 启动调查与兼容性实施

2026-11-14。用户已授权创建分支开始工作；分支 `codex/newbot-v1`，起点 `40754bf`。主计划为 [NB-V1](newbot-v1-implementation-plan.md)。

## 问题与约定

NB-V1-A1：用户要求标准组件替代自研基础能力。触发条件为接入 CopilotKit、A2UI 1.0 与 Apps SDK UI。当前只有包元数据和文档评审，没有可安装、可运行证据；预期为普通 npm ci、类型检查及运行验证均通过，失败原因可重复定位。

NB-V1-A2/A4：现有发送接收 UUID requestId，持久回执与 native turn 关联；新框架不能重放历史消息、绕过回执或使 connect 产生新 turn。前端 Actions 还未接入 native 生命周期，不能把本地模拟回调称为真实模型验证。

## 已知证据与因果边界

- `server/index.ts`：`/api/agent/run` 已包含指纹、回执、容量、配置、私密输入等处理。不能让新 Runtime 直接调用 Codex 从而绕过这些共同机制。
- `server/runs.ts`：相同 requestId 的不同 payload 被拒绝，已存在的相同请求返回既有记录。
- `server/event-feed.ts`：bounded feed 与 epoch/cursor 支持恢复；它不是持久历史。`server/ag-ui.ts` 的快照目前为 Newbot thread shape，并非已验证的 CopilotKit 消息快照。
- 当前 SSE 路由会发送快照；新 adapter 需明确 thread/run 过滤及消息投影，不能仅把 URL 改成 CopilotKit endpoint。
- 已知元数据：官方 React A2UI 包与 markdown-it 的 core peer 范围有冲突；是否 npm 实际拒绝、根入口是否支持 1.0，需实测。

## 同类风险与范围

| 关联入口 | 机制 | 状态与处理 |
|---|---|---|
| 普通/附件发送、重连、刷新 | requestId/指纹/native turn | 有代码证据；复用回执，执行与订阅分离 |
| Actions、审批、App 工具 | 归属、调用结果、服务端权限 | 待验证；兼容探针不能开放生产执行能力 |
| A2UI 历史/Catalog | 协议版本、core/renderer 组合 | 有元数据证据；安装与 1.0 行为分别验，不用强制 peer |
| 普通控件与动态表单 | 同一 Apps SDK UI 组件 | 待验证；独立环境先验 imports/build，之后浏览器交互 |
| 存储、原生 Home、线上 dist | 共享部署路径 | 已核对生产 unit 使用当前仓库 dist；试验在 labs，独立依赖/构建目录 |
| 多 Bot、远程节点 | 完整授权与 OS 隔离 | 后续 G5；本轮契约记录，不声称目录隔离已实现 |

## 实施顺序

1. 保留现有数据/线上产物，记录 HEAD、运行服务、文件 hash 与基线测试；不因只读调查停机备份。正式切换前执行一致性备份。
2. 落盘状态/身份契约及迁移映射，标记未验证项。
3. `labs/v1-integration` 建立私有隔离工程，精确依赖和独立 lock；先验证标准依赖安装，失败保留脱敏证据。根 package/lock/node_modules/dist 不变。
4. 通过安装后，用实际包导出验证 Runtime、官方 AG-UI 扩展点、Apps SDK UI、A2UI 的边界；随后接最小页面和真实执行。不得以探针代替全部 G1 验收。
5. 更新 progress 与证据，阶段提交。目录重排、生产部署、Codex 升级不混在启动提交。

## 验收与完成状态

- 分支可确认；基线 typecheck/test 记录真实结果。
- 精确依赖可干净安装，无 force/legacy-peer；包冲突留下可重复的失败命令。
- Runtime 接入前有状态所有权和请求映射契约；不增加另一套执行循环。
- 后续必须验证真实模型、Actions/审批恢复、A2UI1.0 表单、MCP App、浏览器和性能。当前均未完成。
- 性能五轮基线、一致性备份、完整 Bot 权限契约仍属于 G0 退出条件；只读代码审查不能代替。

证据保存 `evidence-v1/G0`、`evidence-v1/G1`，实施进度见主 progress。
