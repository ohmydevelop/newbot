# URL 导入简化进度

## 调查与方案

已核对当前共享前端、create/scan、两套 URL 解析、现有行为测试和前轮浏览器记录。确认用户输入中的来源和独立 ref 形成双重事实来源，且输入时完整目录发现不必要。本轮从共同数据流消除覆盖参数与目录请求，保持固定提交的扫描/安装流程。计划已先落盘，尚未修改产品代码。

## 已完成

1. **URL-01**：删除 GithubImportSource 的异步目录请求和整个选择器，清理仅用于分支目录的接口及 CSS。输入阶段只保留链接、扫描按钮和必要说明。已在浏览器验证：一个 URL 输入，零个分支下拉；粘贴后测试请求记录仍为 `[]`。
2. **URL-02**：新建导入拒绝独立 ref/path 参数；只使用 URL。仓库首页读取默认分支；tree 地址保留最长实际引用及子目录解析；明确引用失败不回退。去掉 mutable ref 的 60 秒缓存，新扫描读取最新指向，既有扫描仍绑定已保存提交。
3. **URL-03**：删除第二套同步 URL 拆分代码。扫描直接校验并使用持久化 commit/ref/path，带斜杠的分支不会再次被截断。旧已固定来源保持不变；未固定提交的旧暂存明确要求重新扫描，不猜测目标。
4. **URL-04**：支持 releases/tag 地址，按准确的 tag 引用读取，轻量与附注标签均可解析，不把同名分支当成标签。解析后的 ref/目录显示于扫描预览；提交摘要继续内部保存，不要求用户再选择。

## 验证证据

- `evidence-issue-001/url-import/tests.txt`：**15/15** 通过（7 项 GitHub 行为、5 项导入安全、3 项资源生命周期），无跳过。其中重启后下载固定提交与精确子目录使用实际 patched Codex 进行原生扫描；GitHub API/压缩包为替身。
- `typecheck.txt`：类型检查通过。`web-build.txt`、`server-build.txt`：隔离候选前后端构建通过，保留已有前端大包警告。
- `browser-checks.json`、`browser-requests.json`：Chrome CUA 真实操作，390×844 浅色、1440×900 深色、320×740 深色。覆盖技能导入、标签插件安装、指定分支升级 1.0.0→2.0.0、错误 URL 输入保留、修改后重试为默认 main、窄屏无横向溢出。
- `mobile-source.jpg`：来源表单只有 URL；`mobile-skill-preview.jpg`：feature/api · skills/standalone；`mobile-tag-plugin-preview.jpg`：v1 标签；`mobile-upgrade-complete.jpg`：按 feature/api/plugins/demo 完成升级；`desktop-error.jpg`、`desktop-default-preview.jpg`、`narrow-source.jpg`：失败与默认分支、320px 布局。
- 网络证据：输入阶段零 GitHub 请求；扫描请求只解析对应引用并下载固定 SHA，无 branches/tags 目录分页请求。错误 missing 没有触发默认分支请求；后续改为仓库首页才读取 main。
- 初始新增原生扫描测试曾因默认二进制 0.165.0 与当前生成协议不匹配失败（`tests-initial.txt`）；明确设置已验证的独立 `CODEX_BIN=.data/native/bin/codex-main-live` 后通过。常规测试未配置 CODEX_BIN 时仅跳过这项原生集成，避免误用个人运行时；本轮证据没有跳过。

## 边界及收尾

GitHub 数据为固定公共地址的测试替身，不把浏览器测试称为对真实公开 API 的在线端到端验证。解析遵循官方 [Git references](https://docs.github.com/en/rest/git/refs#get-a-reference) 和 [annotated tags](https://docs.github.com/en/rest/git/tags#get-a-tag) 接口；没有发送凭证或安装外部未审查代码，插件仅含合成技能文件。

本轮测试数据库、资源和 Codex home 全部隔离，测试服务已关闭，浏览器尺寸恢复。当前用户服务和个人 Codex 配置未改；源码与候选产物已更新，用户服务尚未统一切换到新版。

## 发布状态更新

2026-11-11 16:15，经用户授权已随最新内核和完整构建切换到当前服务。公网 HTML/JS 与磁盘产物一致，原密码与地址不变。见 `issue-001-service-update-plan.md`。
