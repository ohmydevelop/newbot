# NB-SYS-03 · 进度与验证

## 调查 → 实施

2026-11-15，计划先落盘，随后修改产品代码。基于 f31c28b；分支 codex/newbot-systematize。

- 连接器刷新不覆盖前置读取 → 页面操作所有权贯穿 settings/discovery/list；旧请求不能清除新 busy。原版浏览器慢请求期间按钮仍可点击，记录两次 config、discovery 和 list。修复后第一次点击即禁用，记录一轮。见 before/after-refresh.json、对应 events.json。
- 三个目录局部读取保护不一致 → operation-scope + useOperationScope 统一最新读取、同步去重、写独占、卸载失效；全局 settings/discovery 仍用现有 store 生命周期，不因关闭页面取消共享缓存读取。
- 专家保存成功但读回失败仍保留新建草稿 → 已确认提交后关闭草稿，读回失败显示目录恢复提示。原版同路径已复现；新版刷新后仅一条新记录。删除成功/读回失败也分开处理。见 before/after-expert-readback.png、expert-delete-events.json。
- 子插件迟到回调可能重开旧详情 → 父级仅接收仍对应当前详情快照及 id 的更新，关闭再打开同 id 也不接收旧快照；目前为代码审核证据，未对真实 OAuth 迟到回调做注入，不称 OAuth 验收。

## 验证

全部证据位于 evidence-systematize/catalog-state/。

- tests.log：60项通过，包含5项操作所有权行为测试、配置/恢复/插件配置/连接器/插件管理/技能/专家/商店及资源保留测试。覆盖旧读晚返回、同步重复动作、读写竞争、卸载后写入不可假装撤销、effect重建后旧任务不能解锁新任务、不同页面独立。
- build.log：完整生产构建/类型检查通过；detector.json：三个目录机械检查无发现。
- 浏览器为 localhost:3164 隔离实例，真实 React/HTTP/服务端，Codex/模型为测试替身。故障注入仅 tests/issue-preview-server.ts 的显式环境开关注册，不进入生产服务。
- 商店：延迟刷新立即禁用；503后刷新恢复；无效商店输入失败后保留草稿和恢复操作按钮。见 marketplace-events.json、marketplace-read-error.png。
- 插件：停用提交成功后目录503，显示已完成；刷新恢复已停用；从详情启用后详情恢复可使用。见 plugin-events.json、plugin-committed-read-error.png、plugin-detail-restored.png。
- 目录初始/切换、专家新建与删除、商店深层表单均实际操作；未改 CSS/布局/图标。前后桌面目录截图可比较；ImageMagick原始AE指标为 27.817 (3.01834e-05)，非零，不宣称像素绝对一致。手机390×844，document宽与scrollWidth均390，无横向溢出，见mobile-size.json及mobile-market-error.png。
- 浏览器中没有把所有操作类型逐一进行双击/断线/乱序注入；共同机制的这些边界由操作scope测试覆盖。真实服务兼容性不能由替身证据推出。

## 未解决/后续

本批没有改 Provider、全局store、聊天运行时、凭证/OAuth/CA。专家写入结果未知（服务端已提交但响应丢失）的跨挂载幂等，需要单独的服务端回执协议调查；本批处理的是已明确确认成功后读取失败。

接下来：配置保存与恢复（Provider目录并发、修改/保存/重启生效、凭证状态边界）；随后聊天生命周期（即时发送、重复发送、取消、切换、断线/恢复与工具步骤）；最后附件/A2UI/MCP Apps及全产品等价验收。每批先证据与计划，不同时更换框架或视觉。

发布：本地验收通过，待记录公开入口发布核对。无生产配置/会话修改。
