# 第二轮：官方 MCP App 兼容与性能

日期：2026-11-08。测试环境：Linux/glibc、Node.js 26.12.0、Codex 0.166.0。这里的结果不代替 Node 24 Docker/正式服务器、双 Provider 或 24 小时验收。

## 官方应用实测

使用官方发布的 `@modelcontextprotocol/server-basic-vanillajs@2.0.4`，来源为 [ext-apps 官方示例](https://github.com/modelcontextprotocol/ext-apps/tree/main/examples/basic-server-vanillajs)。`scripts/prepare-official-app.mjs` 固定 npm tarball SHA-512，校验后只提取已打包的原版文件到 `.data/official-mcp-app`，不改写示例、不安装其运行依赖、不加入生产镜像，启动始终使用 `--stdio`。测试只面向本机的独立验收实例。

```bash
npm run test:official
```

完成了真实 Codex 与浏览器测试：

- Codex 发现 `get-time`，原版 HTML 在不同 origin 的 opaque sandbox iframe 内初始化，显示初始时间。
- 修复 Codex 将 MCP 工具同意表示为空表单时，旧界面只能拒绝的问题。仅匹配 `codex_approval_kind=mcp_tool_call`、form 模式、空对象 schema；支持单次 accept，传入空 content，不传持久授权。带输入字段、URL 模式和普通表单仍不能批准。依据 [Codex App Server 文档](https://learn.chatgpt.com/docs/app-server)。
- 点击原版 Get Server Time，经 Host 单次批准后时间更新。线程保持 1 个 Turn、1 次模型工具调用，没有因 UI 刷新再调用模型。
- 原版 Send Message 与 Open Link 收到明确拒绝，Host 显示提示。Send Log 通知不保存或转发负载，合成标记未进入服务端日志。
- 修复透明 iframe 在深色宿主上显示白底浅色字的问题；Host 通过标准 context 提供主题变量并随主题变化更新。深浅主题均可读。
- 375px 浏览器中主文档 scrollWidth=375，官方 iframe width/scrollWidth=327/327，无横向溢出。

这验证了该官方完整示例的初始化、结果传递、授权工具调用和受限交互；不代表所有第三方 App、网络资源、弹窗或全部 SDK 能力都已开放。

证据：`.data/official-app-result.json`、`.data/official-app-light.jpg`、`.data/official-app-dark.jpg`、`.data/official-app-mobile.jpg`。验收实例使用自己的 Web 数据目录与密码；生产工作台不启用官方测试服务器。内置模拟监控 App 保持原有行为。

## 内存排查与改变

1. 遥测禁用时，旧实现仍静态导入完整 NodeSDK 和 exporter。现在按需导入，并让服务端构建生成真正的独立模块；禁用路径不加载 OTel SDK，不创建 span 或缓冲。
2. 旧静态服务为每个文件注册一条路由。改为单个 wildcard 路由，资源数量不再增加相同数量的 Fastify 路由对象；保持 API 鉴权、未知 API/资源 404 与路径边界测试。
3. Linux/glibc 容器设置 `MALLOC_ARENA_MAX=2`，减少并行 scrypt 验证后的分配器保留。没有降低密码派生成本或削弱限速。此设置不构成跨平台内存保证。
4. 成功的短轮询不逐条写日志，错误与其他控制操作继续记录；减少长期分享时的日志 I/O。

可复现基准在独立 Node 子进程运行 3 次，两个实现使用相同的当前版本原始静态资源，不把预压缩副本或上一版资源算入基准路由数量。每轮均新建临时数据库，测一次登录和四次并行登录，等待 1 秒后采样，不强制 GC，不启动 Codex/MCP 子进程。旧实现为优化前保存的编译产物。报告包含各轮明细，RSS 仍有分配器波动，不能只选择最低值。

```bash
npm run build
MALLOC_ARENA_MAX=2 npm run test:performance
# 本机保留的旧产物可用于对照：
node scripts/benchmark-bridge.mjs .data/perf-baseline/server.mjs
```

下表为最终三轮中位数（MiB）：

| 阶段                   | 旧实现 | 本轮实现 |
| ---------------------- | -----: | -------: |
| 模块导入后             |  104.5 |     86.4 |
| 服务初始化后           |  124.5 |     95.4 |
| 单次登录后             |  141.9 |    113.4 |
| 四次并行登录后稳定采样 |  190.3 |    129.3 |
| 加载模块数             |    937 |      435 |

较早的隔离采样出现过约 97 MiB，但最终中位数为 129.3 MiB，不能将最低值当作稳定承诺。密码验证的瞬时内存也会超过 100 MiB。

真实测试工作台：改造前运行约 7 小时，RSS 约 158 MiB；上一轮 36 秒探针峰值 155 MiB。本轮新实例刚就绪约 97 MiB，随后 90 秒/18 次采样峰值 **123 MiB**、heap **32 MiB**、0 次失败。两个短测的时长和缓存状态不同，只能作为现场观察；不据此宣称严格等负载的百分比收益。真实负载尚未稳定达到 Bridge <100 MiB，完整容器资源和 24 小时测试仍未完成。

证据：`.data/performance-before.json`、`.data/performance-after-deploy.json`、`.data/benchmark-before-final.json`、`.data/benchmark-after-final.json`、`.data/soak-2026-11-07T23-19-53.784Z.json`。

## 前端加载与渲染

- AG-UI Schema 在登录后开始连接时加载，保留标准事件验证。
- KaTeX/数学解析只在消息含公式时加载；普通文本不下载数学模块和样式。
- 旧消息与 Renderer 使用 memo；偏好仅在内容改变时写 localStorage，不再随着轮询重复写入。
- 会话历史与模型/MCP/Skills 配置并行读取，避免历史等待慢配置。
- Mermaid 初始化复用并对流式片段做短暂合并；Mermaid/ECharts 能从未完成片段恢复到有效图形。
- 构建时生成 Brotli/gzip，运行时仅协商静态文件，不压缩或缓冲 SSE。带 hash 的资源缓存一年且 immutable，HTML 始终重新验证，私有 API 仍 no-store。
- Web 在临时目录完成构建与压缩后发布，并保留上一版 manifest 引用的资源；避免打开的标签页找不到旧的动态模块。跨多个版本或网络失败时，边界组件显示“重新加载”，不再整页空白。Docker 全新镜像不自动拥有上一镜像的文件，跨镜像升级仍可能要求刷新。

入口 JS 原始体积从约 470 kB 降到约 358 kB，普通文本 Renderer 从约 449 kB 降到约 171 kB；入口 Brotli 约 109 kB。Mermaid/ECharts 等重模块仍按需加载，不宣称全部 chunk 都很小。

可在本机验收 URL 加 `?profile=1`，读取隐藏的 `#newbot-performance` DOM 输出。它只包含静态资源路径、字节数、浏览器时序和界面出现时间，不采集 API URL、消息、工具参数或凭证；正常访问不加载诊断模块。

浏览器本地测量：最初一次新入口资源传输的 FCP 为 112 ms、界面壳约 209 ms；后续真实富文本页面 FCP 为 100 ms、首条历史消息约 267 ms。存在不同缓存/页面状态，均不是公网冷启动或所有 MCP 配置就绪的保证。真实回答中的 KaTeX、Shiki、Mermaid、ECharts 均已显示，DOM 检查分别为 1/1/1/1，图表没有错误提示。

## 回归与剩余门槛

26 项自动测试通过；包含禁用遥测不加载 SDK、启用遥测内容隔离、压缩/静态路由边界、官方 stdio 示例和 MCP 空表单单次授权。构建及依赖审计通过。

遥测内容测试还发现默认资源探测会采集进程命令行。现在显式关闭默认 resource 探测，合成 Prompt、结果和异常消息都不会进入导出数据。没有增加自动 HTTP/process 插桩。

官方基础示例兼容门槛已完成。仍需正式 Docker/sandbox、固定域名 SSE、第二个真实 Provider、实际 MCP OAuth、远程整机恢复、24 小时及 1–5 会话完整验收；继续优化真实工作负载的内存预算。

交付检查：原公网链接 ready=200，未登录配置=401，原密码登录=200 且 Cookie 为 Secure；HTML 为 no-cache，静态 Brotli 正确解码且 immutable；保留的上一版 JS 返回 200。打开着的旧标签页在构建后仍能加载设置面板。隔离验收实例和标签页已停止，原工作台继续由 newbot-test.service 运行。证据：`.data/round2-delivery-checks.json`。
