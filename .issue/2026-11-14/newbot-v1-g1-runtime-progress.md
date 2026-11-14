# NB-V1-G1 · 执行接线与独立界面进度

2026-11-14。范围对应 [runtime-plan](newbot-v1-g1-runtime-plan.md) 与 [browser-plan](newbot-v1-g1-browser-plan.md)。本轮是 G1 文本闭环，不是整个 v1 交付；生产服务未重启。

## 问题 → 共同机制 → 实现

| 问题/不变量 | 已确认原因与实现 | 关联入口/证据 |
|---|---|---|
| 新 Runner 不得绕开发送保护 | 旧 HTTP handler 同时拥有业务与 reply。原闭包提取为 submitAgentRun，通过 AgentCommands 共用回执、配置锁、私密字段授权与执行，不另建模型循环 | 旧发送、凭证、Provider、恢复49项回归通过；全量544/546通过，与改造前相同 |
| 重连/重复请求不得再次执行 | runId 映射已有 UUID requestId；connect只读取/订阅；订阅先于读取，revision去重；客户端历史不进入 native input | 真实模型派发1次、重复run及connect仍1次；HTTP并发/断流/恢复测试 |
| 完成历史也必须遵循官方事件状态机 | 实际HttpAgent拒绝没有RUN_STARTED的终态；为完成历史恢复构造原回执RUN_STARTED→MESSAGES_SNAPSHOT→RUN_FINISHED | 真实SDK恢复通过，不把恢复当新执行 |
| 旧取消不得影响新轮次 | requestId查询原turn，只允许当前native turn；无runId拒绝 | 旧/缺失/随机runId测试；浏览器停止后native状态interrupted |
| 进程掉线不得永远转圈 | 原服务掉线发STATE_SNAPSHOT而非RUN_FINISHED；Runner读取终态并结束为RUN_ERROR | 原生进程离线模拟通过 |
| 新入口不得放宽鉴权 | 同一Fastify登录/Origin/body limit；Runner固定default owner且核验thread存在；长连接复核session并解绑 | 401/403/404/413、过期登录、跨thread事件/回执测试；不声称多Bot隔离 |
| SDK自动元数据不得误拒绝或作为授权 | 1.88自动加入__copilotkitRequestId；只校验UUID后丢弃，不接受其余props/tools/context | 实际React发送通过；未知props拒绝回归 |
| 官方组件须在独立宿主真实可用 | 补齐官方要求的Tailwind基础；统一嵌套data-copilotkit主题；登录Input/Button及新建/主题使用Apps SDK UI | 浏览器登录、键盘发送、浅深色、390/1280截图；无伪造window.openai |
| 重连按钮必须实际重新连接 | 同threadId不会重挂载SDK；增加连接代次，读回成功后重建Provider；旧代次错误不覆盖当前 | 浏览器断网→显示错误→恢复网络→重连成功，不补发消息 |
| 私有化界面不能暗依赖CDN字体 | Apps SDK UI内置KaTeX CSS带外部URL；精确映射到锁定KaTeX本地字体，由Vite产出同源资源 | 初始/修正后network记录分开保存；构建CSS无该CDN前缀 |

## 已有验证

- 根 `npm run check` 通过。全量测试546项：544通过、1跳过、1旧失败；`runtime-root-tests.log`。失败为当前线上dist没有br资产，未修改断言、未覆盖线上产物。
- lab类型/构建通过；5项原上游协议探针通过，7项真实HTTP+FakeCodex契约测试通过。测试替身只用于故障/并发边界，不当真实模型证据。
- `runtime-real-model.json`：真实deepseek-flash文本、完成历史恢复、相同requestId重发，native turn/start恰好1次。独立native Home/工作区，仅复制default Provider的加密凭证行；原始凭证不写日志。测试结束临时数据删除。
- `browser-native-state.json`：浏览器触发的真实对话completed、停止轮次interrupted；这是同一真实模型服务，非截图替身。
- 浏览器检查：点击发送立即出现消息和停止按钮（人工观察，尚未p95量化）；Enter发送；刷新恢复；登录错误；明暗切换；断网重连；手机/桌面无横向溢出。离线模拟已恢复。
- `browser-startup-cleanup.json`：第二实例启动被拒绝，运行实例密码文件不变、临时目录未遗留。
- 独立界面审查首次提出占位文字对比不足及G1方向契约缺项；已补方向附录，placeholder改为主题muted token，复审逐项确认两项修正resolved，disposition: ship（仅两项修正范围）。

## 明确未完成/限制

1. G1的前端Action、A2UI1.0真实表单/Apps SDK Catalog、官方MCP App与可信审批同页闭环尚未实现。已有5个协议探针不替代它们。
2. 新Runner目前只投影普通文本，不含完整思考、工具步骤、附件、动态追问或插件管理。旧产品能力尚未迁移/删除，G2—G4继续承担。
3. 当前精确stop验证覆盖已获得native turn回执的执行。提交准备期间/授权等待的取消、崩溃未知结果恢复、长历史分页、未送达草稿恢复还需接线；不能因文本示例通过即公开替换生产。
4. 仅既有单实例default Bot；db.owns并非完整多Bot授权。G5尚未实现。
5. 默认CopilotChat首屏JS偏大；`browser-build.log`记录主块约2.87MB（gzip约0.83MB），完整性能预算未通过，禁止据此宣称轻量化完成。后续沿官方headless/slot按需拆分，不能换成第二Agent框架。
6. 网络证据仅覆盖所记录浏览器请求和测试路径，不是完整系统出站审计。系统字体只使用本机可用字体；不引入外部字体CDN。
7. 临时验证实例只绑定127.0.0.1，测试批准一律拒绝；它不能作为新生产部署使用。

## 下一步

在同一隔离页加入中立Apps SDK Catalog的A2UI1.0表单与动作，再接真实Codex动态工具/前端Action回传和既有服务端审批账本，最后接标准MCP Apps Host。先写相应边界与故障计划，再修改执行能力。完成G1全部退出门槛后进入G2正式产品迁移。

## 收尾证据与文档边界

最终截图位于 `evidence-v1/G1/screenshots/`；browser-review.md保存独立审查结论。公式已通过真实浏览器显示；browser-network-math.json记录两个KaTeX字体同源200，无第三方请求。browser-markdown-tests.log证明数学标记保留同时拒绝脚本/事件属性/javascript链接。

本页是用户已指定设计系统的隔离兼容页，根PRODUCT/DESIGN仍代表旧部署产品。Impeccable报告的既有sidecar/build配置漂移没有擅自修复；G2正式迁移时更新设计记录。该边界不阻止G1实现，也不作为请求额外确认的理由。

干净安装最后执行了依赖审计：37个受影响包记录（24 high/6 moderate/7 low），包含传递依赖聚合，不能解释为37个独立可达漏洞。非强制audit修复预演遇到peer解析冲突，没有强制更新或框架降级。已新增 [依赖发布门槛计划](newbot-v1-g1-dependency-plan.md)；生产安全和性能门槛仍开着，下一批同步核实可达性和兼容修复。
