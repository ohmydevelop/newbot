# NB-SYS-04/05/06 · 进度与证据

2026-11-15。承接NB-SYS-01，保持完整旧版产品与现有协议/数据格式。计划先于产品代码落盘，开发基线79445d0，发布前线上产品ce02f48。

## NB-SYS-04 配置：实现与验收完成，待公网发布

**已复现根因**：ProviderSettings自动目录读取与手动刷新是两个独立的状态写入者。自动请求延迟失败、手动刷新先成功时，旧失败仍覆盖当前反馈；见before-model-late-error.png与before-model-events.json。父级删除与GatewayEditor保存又分别持有busy，未维护同一编辑对象的互斥约束。

修正共同机制：ProviderSettings复用NB-SYS-03的operation scope，自动读取、刷新、默认模型与删除进入同一操作所有权；过期任务不得修改目录、错误或释放新任务。新增readCurrentConfiguration以Provider修订判断目录结果，遇到修订变化重读，连续变化最多3次后给出可恢复错误。父子编辑同步忙碌边界，删除时禁止保存/关闭，编辑器操作期间父级写入不可触发。GatewayEditor原有operationId、保存回执、凭证专用输入与未知结果恢复继续保留。

模型表单参考MCP：复用PrivateFieldEditor compact模式，名称、地址、API Key和模型ID使用明确占位符及保留的无障碍名称；去掉重复认证标题及泛泛的自定义模型帮助文字。接收方变更确认、已保存状态、权限和错误信息保留。没有改凭证流、后端或存储格式。

验证：
- 4项新增行为测试覆盖修订变化、旧成功/旧失败丢弃、旧任务不释放新任务、卸载与重试上限；配置相关102项通过。
- 隔离浏览器：初始读取参与忙碌锁；失败后手动刷新恢复；新增测试模型服务、专用通道保存合成密钥、自定义模型/默认值选择、重新打开看到已保存占位符。见model-loading.json、after-model-events.json、model-save-events.json。
- 延迟删除期间保存和关闭均禁用，见model-delete-lock.json。此夹具不能核对真实原生历史引用，删除安全拒绝“无法核对原生历史引用，请稍后重试”，保留恢复入口；**这不是浏览器删除成功证据**。实际删除/CAS/重启持久化由服务端自动测试覆盖。
- 桌面深色before/after-model-form.png；390×844手机浅色model-mobile-light.png与model-mobile.json，无横向溢出。Impeccable detector三文件结果为[]。

## NB-SYS-05 聊天：现有边界审计及选定路径验收完成

未新增第二套聊天运行时。App先加入本地消息/运行状态再等待请求；store.submitRun用同步origin锁、requestId及pendingRuns恢复；loadThread版本与流缓冲隔离会话；composer-drafts版本保护迟到确认；stop按thread/turn定位，结果未知不伪装已停止。现有职责已经分离，没有证据支持为了“体系化”重写它们。

真实浏览器、合成Agent：发送hold消息即进入聊天并显示停止；切换Beta写草稿、切回停止运行、再切Beta草稿仍保留；刷新后历史/停止状态恢复。chat-running.png、chat-draft-preserved.png、chat-stopped-counts.json证明只执行1次、只中断1次。普通未发送草稿仅在当前页面内按会话保留，刷新后会丢失，这是现有边界，不能写成持久化能力。重复发送、迟到确认、分页/断线/失败恢复由完整自动测试覆盖；本轮没有逐一进行所有故障的浏览器手工重演。生产真实模型另见发布后记录。

## NB-SYS-06 附件、流程、A2UI、MCP Apps：选定路径验收完成

- 附件与文本继续由共享UserMessage路径分别呈现；浏览器上传合成PNG，发送后先文字后图片，未合并为同一个气泡。过程默认折叠，展开步骤保留标题和已完成/未执行状态。
- 长过程：内部视口324px、内容1544px，overscroll为auto。键盘End抵达内部底部1220后，PageDown使外层conversation从65移动到530，内部保持1220且过程仍展开，见process-scroll-keyboard.json/png。IAB滚轮注入没有产生可观测位移，触摸合成接口不支持；process-scroll.json保留失败尝试。**仅证明键盘边界传递，不能声称本轮实机触摸/滚轮已通过。**
- A2UI：修改表单、保存草稿、刷新恢复相同值、提交后锁定并收到结果，见a2ui-restored.json、a2ui-submitted.png。
- MCP Apps混合fixture：独立iframe加载；第一次工具调用拒绝授权无执行，第二次仅允许一次后结果更新。mixed-browser-counts.json记录tools=1。
- 官方未修改MCP App：通过仓库固定版本/校验和安装@modelcontextprotocol/server-basic-vanillajs@2.0.4，以实际原生Codex启动stdio；浏览器点击Get Server Time，单次允许后服务器时间更新。official-app-tool.png与official-browser-counts.json：toolCalls=1、waitingTools=0。聊天由fixture回放，modelCalls=0；这是原生工具/官方App互通证据，不是真实模型生成应用证据。

## 自动验证与边界

- 基线551项：549通过、2跳过（未指定native及未下载官方fixture）。补齐正式测试条件后，`CODEX_BIN=<本机固定native> npm test`：**555通过、0失败、0跳过**，见final-tests.log。
- npm run test:official：1通过；指定native的导入测试7通过。导入测试使用固定GitHub归档替身，不能称为真实GitHub兼容性验证。
- 完整构建通过，见build.log；初次类型检查发现一个saveGatewayDefault调用缺少task参数，修正后构建通过。git diff --check通过。
- OAuth协议/授权拒绝、证书及私有CA的本地真实TLS边界测试通过；没有使用用户第三方账号进行Slack等实际OAuth授权，不宣称所有供应商兼容。
- 多个本机夹具共享127.0.0.1 cookie导致切换端口后需要重新登录；这是隔离测试环境冲突，不作为产品缺陷或修复记录。
- 生产凭证、已装插件、数据库和后端不迁移。模型创建/删除等写入试验只在临时数据中进行。

所有证据位于[evidence-systematize/completion](evidence-systematize/completion/)。公网发布、数据一致性与真实模型结果在后续段落补齐；未补齐前不标记部署完成。
