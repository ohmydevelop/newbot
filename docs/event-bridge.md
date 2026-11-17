# 插件事件桥

Newbot 负责账号授权、持久接收、去重、派发和任务会话；插件负责发现事件、描述参数、读取上游与转换数据。新增事件插件无需修改服务端注册表或前端字段。没有事件声明的工具插件不会自动出现触发器。

当前使用 MCP Events 草案 `47d95c979faa73427e1f6e0ac0c1347559d8ea37` 的受限实现，profile 为 `mcp-events-47d95c9`，不是已发布的 MCP 正式标准。内部事件使用 CloudEvents 1.0。轮询、推送流与可选中继 webhook 都不调用模型；只有实际接收的事件才进入自动任务。单个任务的执行复用同一会话。

## 插件约定

包内 `.codex-plugin/plugin.json`、`.mcp.json`/MCPB 配置定义连接；`newbot-events.json` 引用连接名称：

```json
{
  "version": 2,
  "profile": "mcp-events-47d95c9",
  "sources": [{ "id": "mailbox", "label": "我的邮箱", "server": "mailbox" }]
}
```

远程 OAuth MCP 的 source 增加 `"authentication":"oauth"`。普通字段及私密字段来自 MCPB `user_config`，事件参数来自 `events/list` 的 `inputSchema`。已配置的插件连接可以共享其凭证与 CA；配置变更会使原授权绑定失效，需重新确认。秘密加密保存，不作为事件数据传给模型。

实现 `events/list`，以及至少一个交付方式：

- `events/poll`：返回事件、游标及可选下一次轮询间隔。首次 null 游标从现在开始；历史回放由上游不透明游标控制。
- `events/stream`：通过带 subscriptionId 的 active/event/heartbeat 通知持续发送；断线用持久游标恢复。不可回放来源无法保证离线期间的事件恢复。
- `events/subscribe`：签名 webhook，通过启用 HTTPS 的自托管中继接收；平台负责 TTL 刷新、challenge、签名校验、回执和清理。

Newbot 的持久队列插件可使用额外的 `_meta["io.newbot/receipt"]` 和 `io.newbot/events/ack`。它是 Newbot 扩展，不是 MCP Events 标准字段。平台写入 inbox 和游标后才确认；重复事件不重复执行，冲突事件 ID/截断/容量满不会悄悄跳过。事件正文应只含任务所需的业务字段，不能把整个上游配置复制进来。

配置 schema 支持有限的 object/string/number/integer/boolean、枚举、字符串数组/枚举数组、默认值及范围校验，最多四层。`$ref` 和可执行代码被拒绝；不支持的 schema 会使来源不可配置。复杂 UI 应走独立应用，不能用 schema 注入任意 HTML。

## 开发和安装

运行 `npm run build:event-plugins`，生成独立包：

| 目录（位于 `.data/event-plugins/`） | 用途                                                       |
| ----------------------------------- | ---------------------------------------------------------- |
| `github-events`                     | GitHub Issue/PR 事件，公开仓库可匿名，私有仓库配置只读令牌 |
| `mailbox-events`                    | 本地文件信箱测试夹具；不是 Gmail 连接器                    |
| `relay-events`                      | 通用 CloudEvents 中继消费者，按事件类型筛选                |

以上三个目录可通过 Newbot 设置中的本地插件导入安装。将 `mailbox-events` 复制为独立包，修改包名、事件名称/schema 和处理实现，即可开发第二种来源。构建同时生成可独立导入的发布器 `dist/event-bridge/publisher.mjs` 和中继 `dist/event-relay/main.mjs`。SDK 入口在 `packages/event-bridge/server.ts`；实现与前端无耦合。原生 Codex 的导入/读取/卸载仅验证插件包装兼容性，事件方法由 Newbot 独立 MCP 连接执行。

## 最小 Bridge

默认链路只有三部分：事件生产者 → HTTPS 中继 → Newbot 中继插件。业务方将事件转成 CloudEvents 1.0 并用 producer token 发布；Newbot 主动出站消费，只有真正到达的事件触发自动任务。无需针对外部 Agent 产品增加适配层，也无需修改平台注册表。现有 poll/push 插件可以直接连接上游，不必绕中继。

生产者可以直接使用 HTTP POST，也可以用 `packages/event-bridge/publisher.ts` 的 `eventPublisher`。后者需要 `url`、`token`、`source`、`directory`，可选 `caCertificate`（PEM）。先同步写入本地 SQLite，再异步发送；重开发布器后继续重试。队列上限10000条，满时明确失败。稳定业务事件使用稳定 id；不同事件不能复用同一 id。只发送业务所需数据，不发送配置、凭证或完整请求头。

```ts
const publisher = eventPublisher({
  url,
  token,
  source,
  directory,
  caCertificate,
});
publisher.enqueue("record.updated", { recordId: "42" }, "source-event-id");
await publisher.flush();
// 长期服务由内部定时器重试；退出前等待正在进行的发送并关闭。
await publisher.close();
```

## 自托管中继

构建后可直接运行 `dist/event-relay/main.mjs`，或使用 `services/event-relay/compose.yaml`。配置 `RELAY_ADMIN_TOKEN`（至少32字符随机值）、`RELAY_DATA`、`RELAY_HOST`、`RELAY_PORT`。默认仅监听本机；公网部署需 HTTPS 反向代理。不要把 admin token 给插件。

通过 admin Bearer token 向 `POST /v1/routes` 创建通道，返回 producer/consumer 两种独立密钥。producer 仅用于 `POST /v1/routes/:id/events`；consumer 用于 subscribe/lease/ack/unsubscribe。撤销使用 admin `DELETE /v1/routes/:id`。密钥响应只在创建时返回，应存到密码管理器或 Newbot 私密字段中。

`relay-events` 配置中继 HTTPS 地址、route ID、consumer token，可选配置「中继 CA 证书（PEM）」；外部生产者使用 producer token。内网机器无需开放入站端口，也不要求常驻浏览器。多个条件使用独立消费者组，不互相抢事件；删除停用的外部消费者可调用 unsubscribe 释放其积压约束。

若直接订阅只支持 webhook 的 MCP，在 Newbot Server 设置 `NEWBOT_EVENT_RELAY_URL`（HTTPS origin）、`NEWBOT_EVENT_RELAY_ROUTE` 和 `NEWBOT_EVENT_RELAY_TOKEN`（consumer）。上游回调指向中继，不指向内网机器。平台发送 client-generated `whsec_` secret，校验原始正文的 HMAC、5分钟时间窗及订阅身份。签名校验在业务处理前完成，只有持久写入成功才返回2xx；订阅撤销后返回410。停止订阅尝试主动 unsubscribe，失效凭证下由上游有限 TTL 清理。未配置中继的 webhook-only 来源不能启用，poll/push 不需要中继。

SQLite 和加密密钥必须一并备份。正文 AES-GCM 加密，route token 仅存 hash，文件权限0600。待处理上限每通道100000条，满时503而不丢弃。已全部确认的正文保留7天，去重标记和回执30天；未确认事件不会按期限清理。密钥遗失时拒绝创建新密钥覆盖原存储。长期不用的消费者需要显式移除，否则其未确认数据持续保留。

## 迁移与验证

v23 只在主数据库事务内添加通用参数及迁移记录。任务/触发器/账号/会话/游标/去重键保留，旧 webhook 原样保留；独立订阅库不重键。v1 源保留在单独兼容模块，只有已知旧声明走此入口。不同包摘要或不兼容升级需要重新确认账号，不能悄悄重放。迁移失败回滚，不启动 worker。

`npm run test:event-bridge` 包括协议、模拟上游、实际 stdio MCP、HTTP 中继、迁移回滚、签名 webhook、本地 OAuth 和 HTTPS 测试；`npm run test:event-bridge-ui` 在320/390/768/1280宽度、深浅色下安装后的来源配置/运行验收。CI 执行边界检查，禁止核心导入提供方实现或插件反向导入宿主。

测试边界：本地信箱不是 Gmail；本地 OAuth 不是 Slack 登录；浏览器视口测试不是真机。公网 HTTPS relay 与真实业务账号需要部署相应中继/账号后额外验证。

本地完整验收：先运行 `npm run build:event-plugins`，再设置协议匹配的 `CODEX_BIN` 并执行 `npm run test:bridge-minimal`。脚本使用隔离数据库、实际插件导入、私有 CA HTTPS 反向代理、原生 Codex runtime 与本地确定性模型，验证三次任务复用同一会话、发布器重开、重复交付及 Newbot 重启。输出默认位于 `.data/bridge-acceptance/evidence`；不接入任何真实 SaaS 账号，也不验证外部模型质量。

## 任意事件插件转公网中继

`dist/event-forwarder/main.mjs` 是独立的通用出站桥。它通过真实 MCP stdio 加载插件、发现并校验选定的 poll 事件，将完整事件页持久化到 outbox 后才保存源游标和确认回执。中继不可达时保留队列；暂时错误会重建MCP连接，重启继续发送。订阅源、参数或目的通道改变时拒绝复用旧检查点，需使用独立状态目录，避免混用游标。

配置 JSON（含通道令牌的实际文件应为0600）：

```json
{
  "directory": "/var/lib/newbot-bridge/source-one",
  "source": "urn:company:source-one",
  "server": {
    "command": "/usr/bin/node",
    "args": ["/opt/plugins/source-one/server.mjs"],
    "envKeys": ["SOURCE_TOKEN"]
  },
  "event": "record.updated",
  "arguments": {},
  "relay": {
    "url": "https://relay.example/v1/routes/ROUTE_ID/events",
    "token": "PRODUCER_TOKEN"
  }
}
```

运行 `node dist/event-forwarder/main.mjs /path/to/config.json`。只传入明确列出的环境变量，不复制宿主环境或凭证到事件中。中继插件在 Newbot 内使用同一通道的 consumer token；不要在源插件旁额外创建重复消费任务。

GitHub事件包1.1.0新增 `workflow.completed`，参数为仓库与可选分支，输出真实工作流名称、提交、运行链接及结论。首次读取只建立基线；随后读取最近100条已完成运行，按runId/attempt去重，32条分批交付。窗口完全越过未消费检查点时报告gap而不静默跳过；较旧且已离开最近100条窗口的运行重跑不在此来源的覆盖范围内。若业务需要全量审计，应接入有完整保留策略的上游。公开API匿名额度不足时可在插件环境提供已有授权，插件仅使用读取接口，令牌不进入relay和模型。
