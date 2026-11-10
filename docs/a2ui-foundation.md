# A2UI 版本、Schema 与官方最小样例（D5.1）

日期：2026-11-08。本轮完成可复现的协议与宿主研究夹具。正式聊天能力仍为 `a2ui: false`，没有 Agent 生成、消息关联或历史恢复；这些在 D5.2–D5.4 实现。部署和上线整体验收仍在 R1。

后续进度：D5.3 已在新对话启用真实 Agent 表单和操作回传，见 [接入记录](a2ui-agent.md)。本文件保留 D5.1 当时的实验范围与审计结果，当前能力和依赖状态以新记录及整体计划为准。

## 固定基线

| 项目             | 本轮结论                                                    |
| ---------------- | ----------------------------------------------------------- |
| 官方 React 包    | `@a2ui/react@0.14.0`，仅开发依赖                            |
| 官方核心包       | `@a2ui/web_core@0.14.0`，仅开发依赖                         |
| 已验证线协议     | `v0.9`，原版官方样例                                        |
| 补充输入兼容检查 | `v0.9.1`，只替换 envelope 的版本字段                        |
| 导入入口         | 两个包均使用显式 `/v0_9`；不使用默认入口                    |
| 包完整性         | 根 `package-lock.json` 的 SHA-512 integrity                 |
| 原版文件         | `examples/a2ui/official/manifest.json` 的包内路径与 SHA-256 |
| 产品入口         | 不导入这些包；不增加公共 API 或模型工具                     |

官网当前标记 v1.0 为 Current，并列出 React 支持范围。但实测发布包的导出入口和 README 仍推荐 `/v0_9`；默认根入口包含旧版 API，不能靠包名推断协议版本。`0.15.0` 还与其 `@a2ui/markdown-it@0.2.2` 的 `web_core ^0.14.0` peer 要求冲突。本轮选择能通过 `npm ls` 的 0.14.0 组合，没有使用 `--force` 或 `--legacy-peer-deps`。来源：[官网版本说明](https://a2ui.org/)、[React 发布包](https://www.npmjs.com/package/@a2ui/react/v/0.14.0)、[核心发布包](https://www.npmjs.com/package/@a2ui/web_core/v/0.14.0)。

0.14.0 的运行时 `A2uiMessageSchema` 接受 `v0.9` 和 `v0.9.1`，但处理器将生成的 Surface 协议归一化为 `v0.9`。随包 raw JSON Schema 的版本常量仍为 `v0.9`。四类消息在两个输入版本中都能执行，不代表 outbound 消息、capabilities 和其他 0.9.1 差异已全部验证。产品首次接入先使用已验证的 v0.9；协议升级必须重新跑契约与交互检查，不能静默改版本字段。标准参考：[v0.9.1 协议](https://a2ui.org/specification/v0.9.1-a2ui/)。

## 宿主实现方式

复用官方 `MessageProcessor`、Schema、数据绑定和 Surface 生命周期，避免自行实现协议处理器。`A2uiMessageSchema` 只校验消息 envelope；组件属性、Catalog、函数和图结构还需要交给已注册 Catalog 的处理器验证。未知 Catalog 标识不会触发网络获取，不把模型提供的 URL 当作自动加载指令。

本轮按照官方发布包 README 使用 `A2uiSurface` 与 `basicCatalog` 跑原版示例。需要明确：此版本 `basicCatalog` 的具体组件是 Lit/Web Components，React Surface 是宿主，这不是最终产品组件库。D5.2 使用官方 `createComponentImplementation` 将白名单映射为本项目 React 组件，并定义自己的固定 Catalog ID；不将完整 Basic Catalog 开给模型，也不增加第二套产品前端。官方的建议是核心处理与渲染实现分离，见 [Renderer 开发指南](https://a2ui.org/guides/renderer-development/)。

四个未改写样例分别验证文本、按钮 action、TextField 双向绑定和增量组件/数据更新。兼容性运行只在内存中替换 envelope 版本，保留原 Catalog 标识。原始样例采用前向组件引用，因此实验处理器仅允许 dangling references，未知组件和其他校验仍开启；正式产品需要限定输入规模并在完整批次执行图校验，不能直接照搬实验策略。

## 依赖与输入边界

实验夹具只使用编译时固定的样例，不提供任意 JSON 输入或上传接口；所有 action 仅写入本页内存，最多保留十条。只监听回环地址，CSP 禁止网络连接、子框架、表单提交及外部脚本。文本以转义后的纯文本渲染，未启用 SDK 默认 Markdown HTML 路径。实验代码和依赖不进入产品 bundle，Docker 运行阶段仍通过 `npm ci --omit=dev` 安装生产依赖。

本轮审计发现官方 Markdown 包固定了有已知漏洞的 DOMPurify 3.4.11，已用 override 统一为既有生产依赖使用的 3.4.17。官方核心和 React 仍需要 Zod 3.25.76；当前审计将其标记为 oversized collection 的内存耗尽风险，修复范围指向 Zod 4，与官方声明的依赖不兼容，不能直接强制跨主版本替换。参考 [Zod 公告](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)。

这意味着当前依赖组合只作为受控开发样例，不应直接提升为处理任意模型输出的生产依赖。D5.2 必须先解决此项：优先采用上游兼容修复；如保留旧处理器，必须在 Schema 处理之前落实字节、集合、节点和深度限额，并针对公告中的资源耗尽路径验证有效。产品现有 Zod 4 保持原样，不能为接入 A2UI 将其降级。生产依赖审计与实验开发依赖审计分别报告。

## 开发验证

```bash
npm run check
npm test
npm run build
npm run test:a2ui-ui
npm ls @a2ui/react @a2ui/web_core
npm audit --omit=dev
```

新增 13 项自动测试，覆盖原版文件及 Schema 完整性、四个样例在两种输入版本下的顺序执行、未知协议/字段/组件/可执行属性、未注册 Catalog 和删除后的失效行为。

新增 12 项真实 Chromium 检查，覆盖官方 React Surface、action 身份和上下文、双向绑定、逐条前向引用及增量更新、删除/重放、0.9.1 输入兼容、键盘焦点、桌面/手机和深色显示，以及没有外部请求或工具/模型调用的边界。证据保存在 `.data/a2ui-ui/result.json` 与同目录截图。

全量 165 项自动测试通过；生产依赖审计为 0 项。包含实验开发依赖的审计仍报告 4 项 high：一项旧版 Zod 公告及其影响的三个 A2UI 包，不能将其描述为全量依赖零漏洞。新增包均是开发依赖，正式聊天能力保持关闭。

后续进度：D5.2 已完成本产品 React Catalog 与处理前资源限额，并针对旧版依赖的数组路径验证了应用入口缓解措施，见 [组件与限额记录](a2ui-catalog.md)。依赖公告仍存在，不将缓解描述为上游已修复。Agent 生成和 action 回传在 D5.3，恢复、过期和降级在 D5.4。私密输入仍仅由 D6 的可信通道处理。
