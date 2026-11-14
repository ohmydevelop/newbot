# STACK-01 调查进度

2026-11-14完成只读审计：
1. 阅读AGENTS、package.json/lock、架构/历史A2UI与MCP Host文档，并以源码校正历史描述。
2. 确认官方A2UI处理器+React Surface正在产品路径调用；协议明确为v0.9，不将包版本或newbot Catalog v1/v2当协议1.0。
3. 确认AppBridge、AG-UI编码/事件、Radix、ECharts均有实际调用，构建manifest包含相关功能chunk。部署二进制为fe2f185-connector-ca，非只看npm版本。
4. 确认assistant-ui/Apps SDK UI/Motion/Cult/Monaco/AI SDK均未作为应用依赖；对应责任由React/Zustand/CSS及现有渲染库承接。
5. 打开官方文档核对能力分层，建议先用ExternalStoreRuntime做受限聊天POC，再独立评估A2UI1.0。尚未进行接入、迁移、性能测试；不声称选型收益已实测。
6. 未变更产品代码、服务、凭证或用户数据；此次仅新增两份审计记录，不重复跑产品测试。

后续依赖：若进入实施，沿用计划的不变量和验收矩阵，先隔离POC再决定推广；不创建第二套Agent Loop或消息状态所有者。

补充完成CopilotKit官方文档审查：应列为完整Agent前端整合候选，assistant-ui列为局部聊天替换候选；已记录TS开源runtime与生产直连Enterprise选项差异。仅文档/架构分析，无接入或性能结论。

用户后续明确要求先提交推送再制定当前主流方案：源码检查点已推送d9f9d56；正式执行计划升级为STACK-02（stack-modernization-plan.md），采用CopilotKit主候选并明确兼容门槛。本轮仍未实施迁移。
