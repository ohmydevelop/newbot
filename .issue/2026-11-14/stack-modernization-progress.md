# STACK-02 进度

## 2026-11-14：源码检查点与方案

- 当前源码、测试、设计与文本issue记录已提交为d9f9d56e65cf66ebe7cbe578dc6e6bd564a841d6，并推送origin/main；git ls-remote确认远端同SHA。源码边界见source-checkpoint-progress.md：原始浏览器抓取、图片与运行证据只在本机保留。
- 本轮npm run check通过；未修改产品代码，沿用GCF-10全量545通过/1跳过及真实模型/部署证据，不虚构新回归。
- 官方Google文章确认A2UI1.0于11月11日发布、10月29日介绍与CopilotKit组合。厂商维护与生态合作在计划中分别表述，不声称CopilotKit属于Google。
- 当日GitHub API与npm注册表元数据已保存。主候选CopilotKit1.88.0；协议A2UI1.0；web_core0.15.0；Codex更新候选0.169.0。无依赖安装或产品变更。
- 已确认A2UI React0.15.0→markdown-it0.2.2→web_core ^0.14.0的声明冲突；计划优先验证CopilotKit a2ui-renderer1.88.0直接依赖web_core0.15.0路径。实际渲染/旧快照兼容尚待M1/M4，不把元数据当运行证据。
- CopilotKit TS Runtime开源路径与Enterprise直连选项分开；Runner包装现有run/connect/stop，不另造Agent Loop；历史权威留在Codex/newbot。
- 已形成M0—M6里程碑、原问题/关联风险矩阵、量化预算、数据兼容与回滚，以及assistant-ui替代触发条件。预算是验收目标，不是已测性能。

当前状态：计划完成；M0—M6实施未开始。计划与metadata准备作为独立文档提交推送。没有开启迁移、修改当前服务或新增云依赖。
