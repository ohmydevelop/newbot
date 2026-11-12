# ADR · Server 与 Runner 边界

状态：实施中。P0冷恢复、P1本地边界/持久控制、P2路径前置项以及P3独立节点TLS链路已验证。主Web Bridge仍走本地链路，完整资源与恢复同步尚未交付。

## 决策

Server 持有权威配置、用户授权、会话操作回执和恢复对象。Runner 主动连接 Server，在本机运行唯一 Codex Agent Loop；每节点独立原生 Home，不跨主机共写 SQLite。首期一个 Server/Runner，不加入自动调度。

上游存在 exec-server 远程执行能力，但仅确认这一能力不能证明插件钩子、MCP、身份和完整资源恢复全覆盖。本轮选择本地 Codex Runner，以保持现有完整执行语义，不同时建设两种模式。

## P0 已证实

真实固定 Codex + 合成 Responses 网关，在临时 A 节点执行命令及动态工具，停止后保存原生 JSONL 会话记录和工作区；删除 A，将包恢复到空白 B，通过 `thread/resume.path` 与新 cwd 保留同一原生 threadId。B 下一轮继续原历史/工具结果，动态工具契约自动恢复，旧命令只执行一次；B 重启可只用 threadId 恢复。没有复制原生 SQLite、登录文件或全局记忆，也没有修改原生数据库。

因此此冷恢复格式暂不增加 Rust 补丁。`ThreadCheckpoints` 接受固定版本的独立 JSONL 会话记录，普通与分页模式都已验证（25轮、每页5轮）；原生索引由App Server重建，不复制SQLite。内容分块复制、逐文件校验并fsync；history_base/fork依赖及压缩格式明确拒绝，账号元数据原样保留。不能将此测试推广为所有历史格式和插件私有状态均可迁移。P6 必须覆盖更多会话形态及完整 MCP Apps 产品状态。

## 所有权与协议约束

- Server 以配置修订和资源摘要发布期望状态；Runner 回报已应用及实际采用，不能反向覆写权威配置。
- Server 的 sessionId/workspaceId 是逻辑身份，native threadId 保留显式映射；节点地址和本地绝对路径不是身份。
- 普通配置和私密凭证独立；节点注册身份不随恢复包复制。原生记忆默认不进入此检查点格式。
- 扩展只读包按摘要共享，任务资源版本固定；允许集合必须落实在原生工具、技能及钩子注册，不依赖模型文字策略。
- Server↔Runner 命令具有唯一操作 ID、归属会话和 fencing epoch；重复命令读取回执，未知外部副作用不自动重放。现有本地 stdio 请求 ID 仅用于响应关联，不能冒充持久幂等键。
- 当前 `RunnerTransport` 只抽取 native IO 和进程生命周期，尚不是远程持久命令协议。产品入口继续由 Bridge 白名单鉴权。

## 兼容与迁移

旧服务在完成验证前继续现有路径；新标准路径需经显式迁移，不因启动新代码自动搬运旧数据。恢复包导入拒绝覆盖现有节点。个人 ~/.codex 和 ~/.agents 不参与。

证据：`.issue/2026-11-11/evidence-server-client/native-recovery.json` 与 `checkpoint-tests.log`。运行：`CODEX_BIN=<固定内核路径> node --import tsx scripts/test-runner-recovery-native.mjs`。


## 当前目录行为

新安装：Server `~/.newbot/server`、原生Home `~/.newbot/codex`、Runner本地目录 `~/.newbot/client`、会话工作区 `~/Newbot/workspaces`。原生子进程的HOME仍位于隔离的`codex/runtime-home`，不继承个人HOME。Server的包副本仍由现有资源库保存，Runner资源同步尚未接入。

显式DATA_DIR，或仓库`.data`中仍存在任一运行状态（数据库、`initial-password`、`private-credentials.key`、`codex/`、`workspaces/`、`runner/`）时保留原布局；清空数据库不会把实例切到全局目录，空`.data`目录也不会锁定布局。NEWBOT_HOME / NEWBOT_CODEX_HOME / NEWBOT_WORKSPACES_HOME可选择位置，但不能绕过个人目录与链接检查；不能通过设置一个空白NEWBOT_HOME让旧实例数据从页面消失。

## 离线工作区迁移

这是工作区级工具，不迁移原生Home、Server数据库位置或完整插件状态。所有命令从仓库运行：

```bash
node --import tsx scripts/migrate-workspaces.mjs inspect <Server目录> <目标工作区根>
node --import tsx scripts/migrate-workspaces.mjs apply <Server目录> <目标工作区根>
node --import tsx scripts/migrate-workspaces.mjs rollback <Server目录> <迁移ID>
```

inspect只读。apply要求支持实例锁的版本正常关闭之后留下的记录；不能手工伪造关闭标记。当前用户服务仍为原构建，未进行实际迁移。工具保留源文件与`Server目录/migrations/<ID>/original.sqlite`和record.json；回退只修改绑定，不覆盖数据库中的其他配置，也不删除任意一代文件。目标发布后数据库提交失败时，两份文件和原绑定都保留，核对记录后使用新的目标重试。

工作区绑定以workspaceId为身份，迁移后的根保存于SQLite。旧共享工作区仍共享；技能projectPath/projectRoot和原生runtimeWorkspaceRoots随工作区改变，普通历史文本、外部连接器地址与源插件路径不作字符串替换。迁移后启动过实例或文件发生变化，禁止自动回退到旧副本。

Linux实例锁使用内核抽象Unix socket，只在本机提供独占，进程崩溃自动释放但不会留下“正常关闭”的假记录。它不是跨主机租约。迁移期间还应停止用户自建的外部文件写入者；逐文件稳定读取和清单复查发现变化即拒绝发布。

## 凭证和扩展资源身份

完整校验过的插件采用包ID/摘要、Schema、服务接收方与逻辑包内路径进行凭证绑定。换本地目录不会变更同包接收方；改URL、普通配置或包内容仍需要重新授权。旧密文只在原物理接收方严格匹配时转封装，不猜测重新绑定。

已导入技能采用包ID+包内路径作为内部身份，保持已有skill ID和别名。对未经托管的任意绝对路径仍保留原有检查，不自动复制个人技能目录。

## 尚未交付

完整Home迁移、允许配置/资源分发、主Bridge远程适配、全局分块上传、完整恢复检查点及节点管理界面仍在计划中。持久控制/注册/租约/TLS已作为默认关闭的独立节点链路验证。当前Server仍在单进程内调用本地Runner适配器；未经验证不能移除现有Client主机。

## 跨主机备份边界澄清

当前P0验证在同一测试主机的独立A/B目录中完成，模拟源节点删除和空白节点重建；不是两台物理主机之间的网络恢复验收。ThreadCheckpoints目前由验证脚本调用，尚未接入生产服务的自动备份或上传任务。不能据此认为现有会话已自动备份到另一台Server。

分机模式下，Server不能读取Runner的本地绝对路径。Runner需要取得一致的原生记录/工作区快照，按摘要将对象经鉴权TLS连接上传。Server核验并持久保存全部对象后，在SQLite事务中发布包含原生threadId、逻辑workspaceId、内核标识、文件清单、资源版本和同步序号的检查点，并回传确认。对象文件与SQLite索引都属于Server的持久数据；不共享或在线复制两端的原生SQLite。

新Runner领取已确认检查点，在自身目录下载/校验/物化文件，取得匹配的扩展版本和允许配置，再由原生path resume导入同一个threadId、替换cwd和权限根。节点身份重新注册，设备OAuth按需重新登录，临时授权不从备份复活。旧节点必须确认停止后新节点才能执行；仅租约失效不证明外部副作用已停止。无法联系旧节点时需P6的显式故障恢复流程，当前不自动接管。

仅能承诺恢复到Server最后确认的检查点：只在Runner本地、上传中或尚未提交检查点的数据不能算已备份；未知外部工具副作用不能自动重放。当前格式仍要求停止Runner进行冷备份；任务边界自动检查点需要另行实现一致性与持久确认，不能直接复用对运行目录的普通复制。

## 独立Runner验证入口（P3-A）

这条通道用于开发验证，尚未将聊天产品切换为远程运行。Server设置`NEWBOT_RUNNER_CONTROL=true`才注册节点接口；默认关闭。登录后的管理请求可通过`POST /api/runners`传入`name`和固定内核`expectedFingerprint`（SHA-256）取得一次性展示的node ID/token；Server仅保存令牌摘要。GET列出节点，DELETE撤销节点。不存在公开的任意原生RPC派发接口。

Runner使用独立的0600 JSON注册文件，字段为`server`、`nodeId`、`token`、`binary`、`fingerprint`、`state`、`codexHome`、`workspaces`。server必须为HTTPS origin；其他路径是Runner本机绝对路径，三个目录互不包含。首次启动只接受空目录；已登记目录仅允许相同节点重新使用。不得将现有产品.data或个人.codex填写为新节点目录。

构建后：`npm run runner -- /absolute/path/runner.json`；开发验证：`npm run runner:dev -- /absolute/path/runner.json`。节点出站连接Server，无需在Runner上开放监听端口。TLS不关闭证书校验；开发私有CA可通过独立进程的NODE_EXTRA_CA_CERTS显式配置。仅本机测试可使用`allowLocalHttp:true`，远端HTTP始终拒绝。

控制协议1具有稳定命令ID、节点epoch、scope和配置revision。SQLite回执记录派发状态；原生调用与本地事务之间崩溃时标记unknown，不自动重放。普通传输包加密，私密配置命令正文只驻Server内存。事件按连续游标落盘后确认，未收到确认的事件会重发；重复内容必须一致。此传输缓存不是完整会话备份。

租约到期停止受管Codex；等待原生启动/停止竞争结束后才报告stopped。重启后新的bootId取得新epoch，旧命令结果只用于核对，不更改新配置。撤销只禁止新工作，不能回滚外部服务已经发生的操作。仍运行或未确认停止的旧节点不能被另一个节点自动接管。

验证：`node --import tsx scripts/test-runner-network-native.mjs`。临时CA、两个独立进程、真实TLS和固定Codex内核；模型为模拟Responses端点。包括命令和动态工具执行一次、历史读取、正常停机、Runner重启原线程及回执恢复。`tests/runner-connection.test.ts`额外销毁真实TCP响应验证重连，覆盖握手、命令响应及事件确认丢失。测试不改个人Codex和现有运行实例，不是两台物理主机验收。

独立Runner非正常退出后当前采用保守恢复：本地正常停止标记缺失时拒绝自动启动；Server未收到旧boot停止确认时也拒绝换boot，不能仅凭租约超时重启。强制终止宿主并不保证已脱离的原生/外部作业终止。P6需要提供明确核验后的故障接管流程；当前开发入口不提供伪造停止状态或自动清除标记的旁路。
