# NB-SYS-01 · 开发进度

2026-11-15：分支准备完成，产品重构尚未实施。

- 基线：main / 40754bf；最后产品代码提交d9f9d56。
- 分支：codex/newbot-systematize。
- 独立工作目录：/home/a/Documents/ChatGPT/newbot-systematize。
- 原目录保留在codex/newbot-v1，未提交文件和运行服务不动。新worktree未复制生产.data、密钥、node_modules或构建产物。
- 产品源码与旧main一致；新增执行计划明确保留原UI/交互与功能，旧换框架计划只作历史参考。
- 未修改产品代码，因此未运行无关测试，也未部署。下一步是原版组件/交互基线和有证据的首批公共机制整理，按计划先调查落盘再修改。

## 2026-11-15 · 第一批实现与公网发布

已完成六类表单/三个目录公共控件抽取，保留原CSS和交互，51项针对性测试与完整构建通过；原完整公网入口已发布，真实模型、刷新恢复、手机和浅色深层表单均已验证。后端/native未重启、原数据保留。详见[newbot-systematize-controls-progress.md](newbot-systematize-controls-progress.md)。整体体系化仍进行中。
