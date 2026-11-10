# D2.1 Skills 简介与只读说明

后续技能选择、原生调用与历史恢复见 [D2 使用记录](skills-usage.md)。以下保留 D2.1 的阶段结果。

日期：2026-11-08。完成 [整体计划](roadmap.md) 的 D2.1。复用 Codex 原生技能发现与启停设置，新增受控文件查看；不增加数据库、产品依赖、Agent 工具或第二种技能格式。

## 用户流程

从侧栏 Skills 或设置分类进入技能列表，显示原生显示名称、简短介绍、来源范围和启用状态。优先使用 `interface.displayName` / `interface.shortDescription`，旧元数据继续使用 `name`、`shortDescription` 或 `description`。不自动加载技能的远程图标。

“查看说明”在同一个设置面板中打开详情，显示完整简介和 `SKILL.md`。格式化视图使用已有 Markdown 文档模式；源码保留完整解码文本与 Frontmatter。格式化视图仅隐藏开头完整的 Frontmatter 块，不解析 YAML 来覆盖 Codex 元数据，也不解释技能步骤。只包含元数据或空文件时提供明确提示。

已停用技能仍可查看，查看不会启用技能或将说明发送给模型。原有启停操作继续写入 Codex 配置。重新读取会刷新当前内容；返回、切换设置分类、关闭面板或退出登录会取消旧请求。说明加载超过 20 秒可重试；文件删除、从发现列表移除、格式错误和权限问题有独立反馈。

打开详情后焦点移到标题；返回后回到原“查看说明”按钮。阅读区独立滚动，工具栏保持可用。技能页调整为受窗口约束的设置面板，支持 375px 竖屏、812×375 横屏、深浅主题和减少动画；手机列表、开关与阅读器主要操作的触控区域至少 44×44 CSS px。

## 接口与事实来源

`GET /api/config` 中的原生技能元数据新增 `id`，为原生路径的 SHA-256；重复路径合并。`skillsWarnings` 返回 Codex 报告的加载错误数量，展示通用检查提示，不返回错误中的原始路径、诊断内容或凭证。发现失败时显示“读取失败”，不会将其呈现为成功读取到空列表。

新增 `GET /api/skills/:id`，返回：

- `skill`：本次发现得到的原生元数据与 ID。
- `content`：受限读取、严格 UTF-8 解码的说明文本。
- `size` / `sha256`：本次读取的原文件字节长度与哈希。

每次查看重新调用 `skills/list({ cwds: [服务端工作目录], forceReload: true })`，仅允许读取仍在当前发现结果中的精确文件。ID 不是独立访问凭证，仍需要现有 Session；Origin 校验和独立应用域的 API 禁止策略继续生效。响应 `Cache-Control: no-store`，不保存新的技能内容副本或对话记录。

浏览器不能通过请求提交任意路径。额外 `path` 查询参数不会改变读取目标；未知或失效 ID 拒绝读取。只读取本机规范绝对路径中的 `SKILL.md`，不扩展到同目录其他文件、引用资源或远程 Skill URI。

## 文件与显示边界

- 上限 256 KiB，登记大小之外增长或读取期间替换会拒绝返回内容。
- 文件必须是单链接普通文件；符号链接、硬链接、目录及含链接的祖先目录拒绝读取。采用 `O_NOFOLLOW`、文件描述符元数据、读取前后属性与规范路径校验；Linux 另检查 `/proc/self/fd` 的实际位置。
- 严格 UTF-8 解码，拒绝无效编码和 NUL；空文件可查看。
- 操作系统错误转换为有限产品提示，不将原始文件系统异常或 Codex 错误内容返回前端。文件内容不进入操作日志、Trace 或模型请求。
- Markdown 按文档模式展示，不执行 HTML、JavaScript、Mermaid、ECharts 或嵌入应用，不加载引用图片；相对文件/API 链接显示为文本。外部普通链接仅供用户主动打开。
- 通过 `capabilities.skillDocuments = { read: true, maxBytes: 262144 }` 启用。旧后端保留发现与启停界面，隐藏说明按钮。

符号链接安装的技能、非本地技能和非规范路径目前会明确提示无法查看；不将链接自动跟随到任意服务器文件。文件名和来源以受信 Codex 发现为授权边界，不声称能抵御拥有同等宿主权限的进程任意复制/替换源文件。

本批不实现输入框选择、结构化 Skill 调用或历史技能快照。当前查看的是重新读取时的文件，历史引用与内容变化提示留到 D2.4；技能列表和详情通过用户刷新更新。

## 验证

- `npm test`：60/60 通过。新增 6 项覆盖稳定 ID 与原生元数据、停用技能只读查看、每次重新发现/文件变化/删除/伪造 ID、发现失败、链接/目录/非本地路径、大小/编码/空文件、认证/应用域/Origin/缓存边界、告警脱敏和 Markdown 惰性显示。
- `npm run test:skills-ui`：16 项 Chromium 检查通过。覆盖列表与详情、完整简介、源码、焦点往返、只读不写配置、原有启停、重读更新/删除/移除/恢复、空文件/仅元数据、受限文件错误、网络失败重试/取消、发现失败/告警、关闭刷新、深色手机布局/触控、横屏、旧后端兼容与登录失效。无 page error，无外部资源请求。
- `npm run test:skills-live`：真实 Codex 0.166.0 在独立 Codex Home 和工作目录中发现 `.agents/skills/native-proof/SKILL.md`，范围为 `repo`；受控读取的内容、长度与 SHA-256 一致。未发起模型任务、未使用 Provider 凭证，也未写入现有用户的技能配置。
- 原有文件界面 19 项、HTML 隔离 14 项、PDF 13 项、文件生命周期 11 项回归通过；加上本批技能检查共 73 项浏览器检查。
- `npm run build` 通过 TypeScript、服务端/Web 构建、压缩和上一代资源保留；`npm audit` 无漏洞。说明界面按需加载，没有新增产品运行依赖。

技能浏览器测试使用 FakeCodex、独立临时目录和测试文件；真实原生协议检查另行执行，不能将浏览器夹具称为真实模型调用。D2.3 将单独完成和验证原生结构化 Skill 输入。

证据：`.data/skills-ui/result.json` 与同目录桌面/手机/横屏截图；`.data/skills-live/result.json`；`.data/d2-1-*.log`。截图已经实际打开检查。本轮保持现有分享服务运行，未重启或迁移其数据库；正式环境、Cloudflare 与上线验收仍留到 R1。

## 复现

```bash
npm run build
npm test
npm run test:skills-ui
npm run test:skills-live
```

UI 测试需要本机 Playwright/Chromium；项目外安装时设置 `PLAYWRIGHT_MODULE` 和可选的 `PLAYWRIGHT_CHROMIUM_EXECUTABLE`。测试实例默认只监听本机 3108 端口，可通过 `SKILLS_TEST_PORT` 修改，结束后清理工作区。测试控制接口只注册在专用夹具，不进入产品服务。

原生检查使用本地固定版本二进制，创建并清理专用 Codex Home；无需模型账号。生成类型基线见 [SkillMetadata](../generated/codex/v2/SkillMetadata.ts) 与 [SkillsListParams](../generated/codex/v2/SkillsListParams.ts)，没有手写替代 Codex 协议类型。

D2.2–D2.4 已完成，见 [技能选择、原生调用与历史引用](skills-usage.md)。下一阶段为 D3 配置管理。
