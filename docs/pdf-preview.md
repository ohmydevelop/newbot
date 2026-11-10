# D1.5 PDF 只读预览与 Range 读取

日期：2026-11-08。完成 [整体计划](roadmap.md) 的 D1.5，D1 文件与页面产物阶段闭环。新增前端构建依赖 `pdfjs-dist@6.5.438`；继续使用现有产物元数据与不可变快照，不增加数据库迁移或产品服务。

## 用户操作

点击 PDF 卡片即可打开只读阅读器，支持上一页/下一页、页码跳转、适合宽度、125%/150% 放大、重新读取和原文件下载。只渲染当前页，横向页面保留原始比例。可展开“本页文字”读取或复制当前页提取出的文字，最多 20,000 字符；扫描件不提供 OCR。

沿用已有版本选择器。切换文件版本、关闭面板或重新读取会取消旧请求并销毁旧文档/worker；刷新会话后从原卡片恢复登记的版本。正在查看的内容不会自动换成工作区的新文件。下载始终来自当前选定的快照，包含完整原始字节。

损坏文件、密码文档、超过页数限制、网络错误和响应不一致分别显示反馈与重试入口。密码文档提示下载后在本地阅读器打开，不引入新的私密输入通道。超过保存上限的工作区文件在登记前拒绝并提示拆分或压缩，不创建空卡片。

桌面、深色主题、375px 手机竖屏与 812×375 横屏完成检查。横屏压缩重复文件信息和标题区域，为文档保留可滚动的阅读空间，下载与翻页控件仍在屏内。关闭与焦点管理复用现有 Modal。

## 数据接口

新增 `GET /api/artifacts/:id/pdf`，复用 Session、Origin、会话归属和不可变快照验证；独立应用域禁止访问。该接口专供客户端解析器获取字节，返回 `application/octet-stream`、`Content-Disposition: attachment`、`nosniff`、沙箱 CSP 和 `Cache-Control: private, no-store`，不在主站使用原生 PDF iframe 或嵌入式阅读器。

| 请求                                              | 返回                                            |
| ------------------------------------------------- | ----------------------------------------------- |
| 无 Range                                          | 200，完整快照                                   |
| 合法单段 `bytes=start-end`、`start-` 或 `-suffix` | 206，精确 `Content-Range` 和 `Content-Length`   |
| 无效/不可满足的单段 bytes 范围                    | 416，`Content-Range: bytes */size` 和 JSON 错误 |
| 不支持的单位、多段请求                            | 忽略 Range，200 完整快照                        |
| `If-Range` 与强 ETag 不匹配                       | 200 完整快照                                    |
| HEAD（含 Range）                                  | 200，完整快照元数据，无响应体                   |
| 快照缺失或哈希不一致                              | 410，保留历史元数据                             |

ETag 为快照 SHA-256。解析边界使用 BigInt，避免超大整数溢出。客户端按 128 KiB 分段、串行读取，检查每次响应的 206、范围、总长、ETag 和实际字节长度。关闭/切换时取消活跃与排队请求，登录失效回到登录界面。

Range 减少网络传输，不代表磁盘随机读取：当前每次响应仍通过现有接口完整读取并校验不超过 8 MiB 的快照，再截取片段。这保持历史完整性检查，不增加内容缓存或绕过原有路径/链接校验；后续若有实测性能需求再优化。

## 渲染与资源边界

使用 PDF.js 自己的解析 worker 与 canvas 绘制；字体、CMap 和 WASM 解码资源通过 Vite 随构建发布，按需加载，不依赖外部 CDN。只允许读取固定资源映射，不接受文档提供的任意资源 URL。构建保留 PDF.js、字体与解码器的上游许可证到 `/licenses/pdfjs/`。

不实例化脚本沙箱、不执行 PDF JavaScript/OpenAction、不挂载可交互链接/表单层；表单仅绘制已有静态外观。XFA 关闭。PDF 中的链接不会成为主站可点击元素，文档不获得 MCP、聊天或凭证权限。PDF.js worker 响应使用单独 CSP，WASM 执行权限仅放在该自有 worker，网络连接关闭；主页面 CSP 不增加 eval 权限。压缩的 `.mjs.br/.gz` 同样获得 worker 策略。

限制：单份快照 8 MiB、最多 500 页、单次 canvas 最多 800 万像素且每边不超过 8192、图片解析上限 1600 万像素；加载超时 20 秒、页面渲染超时 15 秒。文字提取有截断，不承诺完整可访问 PDF 导航、批注编辑、签名验证或复杂文档保真；超限图片可能省略。canvas 限额不等于解析器总内存硬上限。需要完整文档能力时下载原文件。

阅读器与 worker 独立分块，不进入首次聊天加载；worker `.mjs` 也预压缩，继续保留上一代构建资源。通过 `capabilities.artifacts.pdfPreview` 启用：连接旧后端时保留原有下载模式，不展示不可用阅读器。

## 开发验证

- `npm test`：54/54 通过，新增 4 项覆盖 Range 边界/整数、登录与应用域、HEAD/If-Range、精确重组，以及请求范围之外的损坏与缺失快照。
- `npm run test:pdf-preview`：13 项真实 Chromium 检查通过。覆盖延迟加载与 worker 策略、本地 CMap/中文、真实 canvas、静态表单/文档脚本和链接不运行、分页/横向页/缩放、JPEG2000 WASM 解码与多段 206、逐字节下载、损坏/密码/501 页/8 MiB 超限反馈、失败/响应不一致重试、关闭取消、版本切换/刷新、深浅主题/手机横屏竖屏及登录过期。无 page error，无外部资源请求；注入的 400/500/401 错误会出现预期资源失败日志。
- 原有文件界面 19 项、HTML 隔离 14 项、文件生命周期 11 项回归通过，合计 57 项浏览器检查。
- `npm run build` 通过 TypeScript、Web 构建、资源压缩/上一代保留和服务端打包。`npm audit`（含构建依赖）无漏洞。

测试 PDF 由 ReportLab、pypdf 与 Pillow 生成，包含三页中文/表格/横向图表、静态表单、外链和 OpenAction、JPEG2000 大图、密码、损坏及超限样本。Poppler 渲染后实际打开检查，并检查浏览器截图；系统字体与 PDF.js 的字体替代可能带来字距差异，不以二者像素一致作为验收。

浏览器夹具使用 FakeCodex 原生事件、独立临时工作区与真实 PDF 字节；不将夹具称为真实模型或正式部署验收。D1.2/D1.3 的真实 Codex 文件生成记录继续有效。本轮未重启现有分享服务、迁移其数据库或更改 Cloudflare；正式环境、容器和统一上线检查仍留到 R1。

## 复现与证据

准备 Python 环境中的 `reportlab`、`pypdf`、`Pillow`（Pillow 需支持 JPEG2000）。浏览器测试需要 Playwright/Chromium；项目外安装时设置 `PLAYWRIGHT_MODULE`，必要时指定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。它们均不是产品运行依赖。

```bash
python3 scripts/create-pdf-fixtures.py
npm run build
npm test
npm run test:pdf-preview
npm run test:artifact-ui
npm run test:html-preview
npm run test:artifact-lifecycle
```

PDF 浏览器夹具默认使用本机 3102 端口，可通过 `ARTIFACT_TEST_PORT` 修改；结束后关闭并清理实例。测试专用修订接口仅在夹具 `ARTIFACT_PDF_FIXTURE=1` 时注册，不进入产品入口。PDF 结果、Range 记录和截图见 `.data/pdf-preview/`；参考 PDF/Poppler 图见 `.data/pdf-fixtures/`。

实现参考：[PDF.js 官方 API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html) 与 [RFC 9110 Range](https://httpwg.org/specs/rfc9110.html#field.range)。实际使用参数以固定依赖的类型和源码为准。

后续 D2.1 技能简介与 SKILL.md 只读查看已完成，见 [技能查看记录](skills-viewer.md)。D2 技能选择、原生调用与历史引用现已完成，见 [技能使用记录](skills-usage.md)。
