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

## 2026-11-15 · 第二批目录生命周期

NB-SYS-03完成并发布到原公网入口：三个目录统一请求所有权，修复刷新链路忙碌状态、过期读写回及专家已保存但读回失败仍可重提的问题。60项测试、故障注入真实浏览器、手机表单与公网只读验收通过；原后端和生产数据保留。细节及验证边界见[newbot-systematize-catalog-state-progress.md](newbot-systematize-catalog-state-progress.md)。

后续按序推进：配置保存/生效/重启恢复 → 聊天发送/取消/切换/断线恢复 → 附件/A2UI/MCP Apps及完整产品等价验收。各阶段先建立具体证据，再决定内部重构，不默认引入新前端框架。

## 2026-11-15 · 本轮体系化收尾

NB-SYS-04/05/06完成实现、选定路径验收与公网发布。模型页按MCP精简重复文案，并复用公共操作所有权解决旧目录结果/错误覆盖与父子编辑互斥。聊天、附件、A2UI、MCP Apps已有边界通过审计与行为测试后继续复用，没有换shell或删功能。完整555项测试通过（0跳过），原生Codex+官方MCP App工具交互、真实模型公网回复及刷新恢复均通过。

原Cloudflare临时域名在验收时出现1016；已恢复两个专用隧道、同步Origin并重启原后端代码，原数据保持一致。当前主站：https://integration-love-angela-heated.trycloudflare.com/ ，密码不变。源码05018cb；最终记录与未验证项见[newbot-systematize-completion-progress.md](newbot-systematize-completion-progress.md)。所有本轮计划阶段已推进到交付，第三方真实OAuth、所有供应商兼容性、实机触摸滚动及专家未知写入专项仍明确保留边界，不以555项通过代替这些证据。
