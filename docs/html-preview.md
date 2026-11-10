# D1.3 HTML/JavaScript 隔离预览

日期：2026-11-08。实现 [整体计划](roadmap.md) 的 D1.3。生成的自包含 HTML 可以在聊天产物面板中实际运行，并保留源码与原始文件下载；不增加 Agent 内核、MCP 客户端或部署服务。

## 使用流程

点击 HTML 文件卡片后打开运行预览。页面内按钮、表单控件和本地 JavaScript 状态可交互；工具栏提供源码切换、重新加载及下载。重新加载创建新的运行窗口，页面临时状态归零，已有产物版本保持不变。

切换源码或关闭面板会移除执行窗口并撤销其短时凭证。从页面内部按 Escape 也可关闭，焦点回到原文件卡片。加载失败、凭证失效和超时均显示重试入口；过期时移除执行窗口，不留下持续可见的空白页。未配置独立应用地址时，只提供源码与下载。

本轮只支持自包含页面：CSS、JavaScript、字体和图片需要内联；外部 CDN、工作区相邻资源、网络接口、弹窗和下载脚本均不开放。普通 HTML 控件并不获得 MCP 工具、模型或私密输入权限。

## 执行边界

页面使用两层 iframe。外层由 Bridge 生成，只有带 nonce 的受控脚本，内层加载已登记的不可变 HTML 快照。两层均使用 `sandbox="allow-scripts"`，响应头也强制相同 sandbox，未授予 `allow-same-origin`、表单提交、弹窗、下载或顶层导航权限。即使直接打开内容 URL，HTTP sandbox 仍会生效，而非仅依赖聊天页面的 iframe 属性。[MDN CSP sandbox](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/sandbox)

外层 CSP 的 `frame-src` 仅允许当前凭证对应的内容路径，用于约束内层的自行导航。外层的 `frame-ancestors` 限定为发起请求的主站。内层保持 opaque origin，无法用普通 origin 表达其父级，因此由短时能力凭证授权读取，不设置与 opaque 父级冲突的 `frame-ancestors`。

内层禁止外部脚本、CSS、图片、连接、子 frame、Worker、object 和 base URL。Permissions Policy 关闭摄像头、麦克风、定位、剪贴板等；Referrer Policy 不发送来源。主站不会接收页面的工具 RPC、审批、模型消息或共享状态。跨窗口消息只用于受控的加载确认、错误和关闭，并校验发送窗口、凭证与消息类型。

浏览器拒绝资源请求时也可能触发 iframe 的 `load`。因此外层每次加载都会向内层发出生命周期确认；只在收到当前文档回应后报告就绪。服务端在执行响应中添加极小的生命周期脚本，不修改保存的快照、源码和下载内容，也不提供工具调用接口。未完成确认时显示失败重试。

响应同时设置 `Connection-Allowlist`：内层为空，外层仅允许对应内容地址。该头用于补足 CSP 在导航、资源提示和 WebRTC 等通道上的覆盖差异；其支持情况依赖浏览器，不能以 CSP 作为跨浏览器的完整网络防火墙。[Chrome 官方说明](https://developer.chrome.com/docs/modern-web-guidance/guides/security/restrict-outbound-connections)、[WICG 规范](https://wicg.github.io/connection-allowlists/)

本轮浏览器验证针对 Chromium 155；没有完成 Firefox/Safari 或 WebRTC/UDP 的独立流量验收。网页权限隔离也不提供浏览器 CPU/内存限额。目标浏览器与运行环境的完整验证仍在上线前 R1 处理。

## 会话与资源生命周期

- 主站 POST 接口要求已登录且 Origin 合法，读取前验证产物归属、类型和快照校验值。
- 随机 256 位预览凭证绑定当前 Web Session、产物、主站 origin 和应用 origin，5 分钟有效；外部应用域不接收主站 Session 值。
- 应用文档 URL 是短期只读能力地址，持有者可在对应 Session 有效期间读取该产物，不是新的登录凭证。URL 不记录到操作日志，响应禁止缓存且不发送 Referrer。
- 每个 Session 最多 8 个凭证，全实例最多 32 个；只在内存保存元数据，不额外缓存整份 HTML。
- 关闭、切换源码、重载、退出登录或失效后撤销凭证；关闭时尚未返回的创建请求会在返回后立即撤销。网络完全中断时以服务端有效期为最后界限。
- Bridge 重启后旧凭证失效，重新加载会从持久化快照重新授权，不把当前工作区文件替换进旧版本。

## 独立应用地址与共享路由

复用 `APP_ORIGIN`，该地址需与主站一样指向同一 Fastify 服务，并由实例所有者控制。所有主站 authority 都从应用域集合排除；不能把主站允许的另一个地址同时用作预览应用地址。

只允许本机单一主站时，可自动选择 localhost/127.0.0.1 的另一地址。本机同时将两个地址加入 `PUBLIC_ORIGIN` 时，必须显式配置独立应用地址。没有可用独立地址时，能力报告关闭 HTML 执行，前端保持源码模式。

应用域只提供 `/sandbox/*`、`/artifact-preview/*` 和 `/artifact-content/*` 文档；登录、主站页面、静态资产和全部 API 在应用域均拒绝。主站也拒绝直接加载这些执行文档。本轮同时为既有 MCP Apps 文档增加 HTTP sandbox，并验证 SDK 的初始化、工具结果和单次授权调用仍可用。

| 接口                                           | 作用                                              |
| ---------------------------------------------- | ------------------------------------------------- |
| `POST /api/artifacts/:id/preview`              | 为当前登录会话创建短时预览能力，返回 URL 和有效期 |
| `DELETE /api/artifacts/:id/preview/:previewId` | 撤销当前 Session 的指定能力，重复撤销幂等         |
| `GET /artifact-preview/:token`                 | 仅在独立应用域提供受控外层文档                    |
| `GET /artifact-content/:token`                 | 仅在独立应用域提供 sandbox 内的已校验快照         |

未新增数据库表或 Schema 版本；沿用 D1.1 的 SQLite v2 与快照存储。

## 验证与复现

- `npm test`：42 项通过，包括新增的授权、Origin/Host 边界、凭证归属、撤销/登出、有效期、容量、损坏快照和原文下载不执行等回归。
- `npm run test:artifact-ui`：原有 19 项文件界面检查通过，HTML 源码路径保持不执行。
- `npm run test:html-preview`：14 项 HTML 浏览器检查，覆盖实际 JavaScript 计数、DOM/Cookie/存储隔离、直接打开文档仍受 sandbox 约束、外部资源/接口/导航/表单/弹窗探测、伪造消息、重载、关闭、源码、页面内 Escape、失败恢复、到期、深浅主题与 375px。探测接收端没有收到 HTTP 请求。
- `npm run test:mcp-ui`：既有 MCP Apps SDK 完成初始化、结果展示及 Host 单次授权的真实工具往返，验证共享路由加固没有破坏该流程。此项使用 SDK 测试夹具，不冒充所有第三方 App 验收。
- `npm run test:html-live`：真实 Codex 0.166.0 + `gpt-6.1-sol` 从 Web 创建 HTML 文件，捕获 `fileChange` 生成卡片；打开后点击 Add，计数从 0 变为 1；原始文件内容与 SHA-256 核对通过，刷新后卡片恢复。
- `npm run build`：TypeScript、Web 构建及服务端打包通过。保留静态预压缩与上一代资源；没有新增产品运行依赖。

浏览器命令需要本机 Playwright/Chromium；项目外安装时设置 `PLAYWRIGHT_MODULE`，必要时设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`，与 D1.2 相同。真实运行命令会调用配置的 Provider，使用独立临时数据目录，不批准额外权限或外部工具访问。

证据：`.data/html-preview/result.json`、`html-desktop.png`、`html-dark.png`、`html-mobile.png`、`mcp-result.json`；真实生成证据在 `.data/artifact-live-html/result.json` 和 `real-codex-preview.png`。

本轮在独立本机实例验证，未重启现有分享服务、未迁移其数据库或变更 Cloudflare 配置。正式部署与整体验收继续留到开发完成之后；后续 [D1.4](artifact-lifecycle.md) 已完成版本、容量、清理和恢复的开发验证；当前下一批为 D1.5 PDF。
