# AUTO-6 调研与进度

## 官方调研（2026-11-17）
- OpenClaw源码基线48cd549b1c48653061ec312e35fef62d13df62cf；docs/automation/cron-jobs/payloads.md明确current/session:<key>延续上下文，isolated每次新transcript。https://docs.openclaw.ai/automation/cron-jobs/payloads
- Hermes基线081e8d9b75b2bedae297a89232b04ef9be7b26a0；cron每次fresh AIAgent，投递可回origin/指定渠道，attach_to_session与执行上下文不同。https://hermes-agent.nousresearch.com/docs/user-guide/features/cron
- Hermes routes固定signature，Generic V2为HMAC(timestamp.rawBody)，±300s；GitHub原始body签名；声明式filters/skills、cron_job事件唤醒。https://hermes-agent.nousresearch.com/docs/user-guide/messaging/webhooks
- OpenClaw openclaw.plugin.json含skill路径、runtime元数据；Hermes Python register(ctx)/plugin.yaml和SKILL.md分别属于不同层。不能将代码插件称作Codex插件无损兼容。https://docs.openclaw.ai/plugins/manifest 与 https://hermes-agent.nousresearch.com/docs/developer-guide/plugins
- 设计决策（Newbot自身）：默认任务专属持久会话+独立运行账本，保持Codex后端；事件经固定协议适配器归一化，不从payload继承权限。

## 状态
已实现共同会话绑定、四种事件协议、持久去重队列、密钥管理和生态技能导入。上游文档为静态证据，尚未运行OpenClaw/Hermes运行时。


## 实施与针对性证据
- S1：新增automation_threads，按任务持久绑定；旧任务选最近未归档且未被别的任务占用的会话，旧运行记录不改。手动/时间/事件共享submit入口；每轮独立requestId与turnId。
- S2：派发前同步模型/模式/专家；人工占用时等待；prepare完成后重查任务修订及排队状态，暂停/编辑不能被迟到请求穿透。归档暂停、恢复启用同一会话。列表轮询比较threadId，避免短任务结束后入口不刷新。
- E1/E2：原始请求体验签、固定来源协议、过滤、32次有界FIFO、事务写入inbox/运行、持久去重；密钥加密并按版本轮换。关闭弹层取消读取；旧版本轮换拒绝。缺失主密钥不能因仅保存了事件密钥而悄悄生成新密钥。
- P1：OpenClaw清单声明的skills路径与Hermes包内SKILL.md分组导入；复用原扫描/摘要/选择/安装/卸载，不启动JS/Python入口或安装脚本；声明不支持的运行能力。
- 原生Codex使用生产实际二进制fe2f185-provider-ca（协议0.0.0），不是npm的0.165.0；未修改协议生成产物。

|不变量/范围|结果与证据|边界|
|---|---|---|
|S1/S2真实执行与恢复|live-model.json：实际模型3次运行同thread、不同turn；第二次记得第一次词语；在重启前入队的事件恢复执行；chat改plan真实生效|独立临时实例，只复制模型配置/凭证，未复制生产任务或发送邮件|
|E1/E2协议/队列/权限|automation-events.test.ts 9项：四种认证、重复/冲突、过滤/ping、轮换、容量、FIFO、暂停删除、真实localhost HTTP及超大body|发送方为本地协议客户端，不是外部GitHub/OpenClaw/Hermes完整服务|
|S2异步失效|automations.test.ts新增prepare期间暂停，派发次数不增加|测试替身，原生连续会话另有真实模型验证|
|P1导入全路径|ecosystem-imports.native.ts通过实际Codex扫描、导入、重启发现与卸载，另一个生态技能保留；资源保留且只有代码的包拒绝|使用合成包；不宣称第三方所有技能语义/原生插件代码兼容|
|配置密钥/DB|credential-storage.test.ts新增事件密钥独占存储时的丢失主密钥保护；部署迁移脚本3测试通过，覆盖v19→20保留旧任务/历史及回滚|生产迁移待部署验证|
|UI|首轮320/390/1280×明暗6场景通过；独立视觉评审发现已填字段缺少可见名称，已补紧凑label|最终完整浏览器/触摸回归进行中；没有物理手机|

## 验证中发现并修正
- 初次真实模型隔离测试漏复制provider private_field_sets，模型读取缺配置；修正测试数据准备后通过，未改生产Provider路径。初次失败原因在此保留；live-model-failure.json记录随后原生恢复重复调用的失败，最终结果见live-model.json。
- 测试替身未模拟native unload/provider响应，补齐替身后配置同步通过；真实原生模式切换另行验证。
- 完整单测首次唯一失败是旧迁移测试硬编码19；改为DATABASE_VERSION，第二轮603项中602通过、1项原有跳过、无失败。新增prepare竞态后针对性20/20通过。
- 密钥弹层迟到读取与重复轮换在同类边界排查中补齐；保持最少必要说明，未重新设计外壳。

## 尚未宣称完成
完整浏览器回归、生产部署与公网验收尚在进行；触摸与修正后的视觉复核已通过。物理手机、第三方真实事件源注册、邮箱主动订阅和OpenClaw/Hermes代码插件运行时不在本轮完成声明内。历史运行入口仍可进入对应会话，多个新运行共用会话时打开会话最新位置，未新增按turn锚点自动翻页。

## 收尾验收补充
- E3：事件积压占满全局前10个候选会阻止别的任务，改为每任务选最早queued；20/20针对性通过，包括独立任务不被32条积压阻挡。
- S3：真实模型归档恢复曾失败（只改本地archived），现改原生thread/unarchive成功后启用任务，本地/远程Runner白名单补充同一会话范围内此方法。恢复失败保持暂停，恢复途中删除/改版后迟到响应不能启用任务。原生unarchive非幂等，丢失回执时通过原生非归档目录确认同一thread再恢复，禁止把任意错误当作成功。
- 测试隔离：catalog-identity创建专家未清理导致空目录golden超时，已用finally删除只属于该用例的专家，不更换golden或放宽像素阈值。首次76通过，其后受污染用例中断，保留browser-initial.log；完整矩阵重跑中。
- 手机触摸：12/12通过，含时间+事件组合配置弹层、触摸上下滚动、固定操作、减弱动画、抽屉连续操作、工作流边缘交接、插件技能深层目录。为Chromium触摸事件模拟，无物理真机。
- 最终独立视觉复核ship，字段标签修正resolved，六个条件弹层均不越界。完整单测606项：605通过、1项原有skip。

原生归档→恢复→切模式→继续执行现已通过；额外模拟原生恢复完成而本地仍归档，重试核对后正常续用同一会话。证据live-model.json含7项真实执行检查。原生恢复能力通过本地及远程Runner共享权限清单接入，未开放通用任意RPC。
