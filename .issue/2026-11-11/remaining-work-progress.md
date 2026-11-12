# 剩余工作推进记录

## S0 调查

- 已读仓库 AGENTS、Issue001 主计划/进度、URL 导入和服务更新、插件配置/生命周期/证书、App 工具范围/展示等记录；旧浏览器禁用与旧内核未发布条目已被后续记录覆盖。
- 当前 git 工作区初始干净，main 为 2651ebd。Chrome 控制可用，现有公网标签页保留。
- GitHub CI 42986523293 未启动任何 step：账号付款失败或额度不足。该状态属于外部账号限制，不是产品测试失败，不能标记 CI 通过。
- 使用 Impeccable 的现有界面审查方法；不重设计页面，不增加常驻技术说明。

## S1 进行中

- 已建立 `tests/remaining-work-preview-server.ts`：真实固定内核、导入/SQLite/凭证接口、受控 TLS 服务，模型接收方合成；运行目录全隔离。首次夹具缺少 portable plugin schema 导致仅发现技能，补齐合规清单与 kind 断言后再开始正式测试，未据此判断产品缺陷。
- 真实 TLS 追加用例通过：没有 SAN 的 IP 证书不能判为地址匹配；实际生成 >64 KiB 证书后由读取限制拒绝；未发送应用数据。证据 `certificate-tests.txt`，5/5。
- Chrome 已确认配置/技能同属插件详情；首次缺密钥阻止保存；证书获取不自动填入，确认后保存；重读密码输入为空、状态为已保存；不输入新密钥再次保存仍保留原凭证。取消慢 TLS 请求并放行迟到响应，未出现旧结果；更改地址后清除本次获取的指纹。
- 390px 深色证书详情无横向溢出，内部正文可滚动。`plugin-certificate-mobile.png`、`plugin-save-state.json`。
- RW-08：正在补统一中文原生校验提示；候选前端构建到 `.data/remaining-web`，当前用户服务 `dist/web` 入口仍为 index-5sjcKMyx，未替换。

## S1 验收结果

- RW-08 原生中文校验已修复：Chrome 实测登录与插件必填提示均为“请填写此项。”；填写后登录正常；插件取消“启用连接器”后，动态不再必填可以保存，没有残留 customValidity 阻塞。英文气泡首次修复使用 microtask 释放过早，已按真实结果改为下一交互/约束变化清理，复验通过。
- RW-09 已复验：保存成功后再次编辑地址立即移除上一轮成功提示；接收方改变且未重新提供密钥时保存拒绝、草稿保留，UI 只有本次错误。原值与凭证仍在 SQLite，未转发旧 Key。连接诊断与 OAuth 的迟到成功/错误也按当前草稿代次过滤。
- 插件技能只出现在插件详情；独立技能页仅系统技能，独立连接器页没有插件派生 ID。桌面 1440×900 浅色、手机 390×844 深色，弹窗正文可滚动、无横向溢出；证书按钮可用键盘 Tab/Enter 操作。
- 证据 `plugin-certificate-desktop.png`、`plugin-certificate-mobile.png`、`plugin-save-failure-mobile.png` 和两个保存状态 JSON。合成密钥及证书只供隔离测试，没有配置真实接收方。
- 类型检查与本轮针对回归通过；进入 S2。原生结构、TLS 和真实浏览器分别有证据，不将此称为真实业务平台兼容验证。

## S2 验收结果与限制

- 真实固定补丁内核 fe2f185 + 合成 Responses 网关，浏览器代理切断后后台仍完成；恢复连接保持原线程和新草稿。第二轮关闭标签页，后台完成，再打开恢复两轮历史。最终请求 4、完成 2、工具执行 2、线程 1；见 `recovery-final.json`、`recovery-offline.png`、`recovery-online.png`、`recovery-reopened.png`。不构成真实 Provider 兼容证明。
- 另一次独立运行实际产生原生命令审批；关闭/重开后保留同一审批，键盘批准后工具仅执行一次。见 `native-approval-final.json`、`native-approval-before-close.png`、`native-approval-completed.png`。runs 表为派发回执，不能将其 accepted 状态当成原生任务尚未完成；以原生完成事件和工具计数为准。
- 标准 ext-apps SDK + 实际 Host API + 合成原生端：普通业务工具没有 UI resource 也可进入审批；拒绝不执行，允许只执行一次。完全访问自动允许合法 App 工具，但未开放的 model-only 工具仍拒绝；降级后重新出现审批。见 `app-manual-scope.json`（1 次）与 `app-auto-scope.json`（2 次）。折叠保持 iframe 交互状态；一次刷新恢复 CPU 25/75，未追加模型/业务调用。
- 浏览器 390px 深色及 1440px 桌面验证 App 外壳使用业务标题、无常驻内部协议与权限说明；见 `app-mobile.png`、`app-desktop-restored.png`。浅色插件弹窗已通过，App 浅色补验未通过：多次出现初始化超时，调试能力明确返回 `Raw CDP is unavailable while Browser Use is resolving a paused document response.`。这是验证环境存在干扰的证据，不能据此证明产品无缺陷，也不将所有刷新路径标为通过。后续需在文档响应不被暂停的浏览器中补验。
- 测试不同 localhost 端口复用 Cookie host 导致另一个夹具登录失效；重新登录后继续。候选构建清空旧 chunks 导致旧标签页动态导入失败，刷新候选页面后恢复；开发发布脚本保留上一代 assets，不受此夹具构建方式影响。上述两点不误报为产品故障。
- 原 Issue001 大块空白没有复现。仅记录当前长过程/恢复结果，不添加负边距补丁。
- RW-09 专门延迟真实连接诊断返回，编辑草稿后再释放：旧结果被丢弃；恢复地址重新检查显示“发现 1 个工具”。模型请求仍 2、业务命令仍 1，诊断未启动模型任务。见 `diagnostic-stale.png`、`diagnostic-current.png`、`diagnostic-final.json`。OAuth 代次过滤有代码检查，未以真实 OAuth 服务完成浏览器登录验证。

## S3 检查

- 本轮针对测试 18 项通过（包含证书 5 项），恢复与 App/插件相关回归另 55 项通过；见 `targeted-tests.txt`、`certificate-tests.txt`、`recovery-app-tests.txt`。类型检查通过，Impeccable 检测无报告；见 `typecheck.txt`、`ui-detect.json`。
- 两处产品改动仅涉及浏览器约束提示与插件草稿/诊断代次，无数据库迁移、个人 Codex 配置或服务端凭证变更。

### 发布与清理

- `npm run build` 完整通过（前端、测试 MCP、类型、服务端打包）；前端发布到现有开发服务，入口 `/assets/index-CmM5RzeT.js`。公网/本地 SHA-256 一致且 health 均 ok，上一版 `index-5sjcKMyx.js` 保留；见 `final-build.txt`、`published-web.json`。仅前端产品代码改变，无需重启服务中断任务。
- 隔离端口 3147/3148/3149/3151 已停止，测试标签页关闭、临时视口恢复；用户原有公网标签页未关闭。
- 未操作 GitHub 计费，未更改真实 Provider、插件凭证或个人 Codex。未进行正式发布验收。

## 仍未完成/未验证与下一步条件

|事项|当前结论|下一步条件/动作|
|---|---|---|
|GitHub CI|账号付款/额度导致任务未启动；本地检查通过|账号可运行 Actions 后重新触发；不修改计费设置|
|App 初始化/刷新可靠性|成功恢复有证据，也存在超时；浏览器工具明确暂停文档响应，无法完成归因|在不会暂停 iframe 响应的浏览器中重新测首次加载、刷新与浅色；用资源请求和初始化时序确认产品是否需修复|
|原 Issue001 大块空白|本轮没有复现|出现时收集同一界面 DOM 高度、消息项/滚动容器位置；保持证据，不隐藏问题|
|真实 Provider/图片生成/外部 namespace|本轮合成请求不证明实际上游兼容|R1 实际服务验收；外部转换服务由提供方处理，不删除原生兼容检查|
|实际 OAuth/业务插件兼容与正式部署|没有用真实服务完成本轮验证|按既有上线前验收范围补齐；不把 SDK/合成接收方结果冒充实际业务结果|

复验夹具：`RECOVERY_APPROVAL_TEST=1 UI_TEST_CANDIDATE=.data/remaining-web CODEX_BIN=.data/native/releases/fe2f185/codex node --import tsx tests/remaining-work-preview-server.ts`；恢复测试不设 RECOVERY_APPROVAL_TEST；App 使用 `APP_SCOPE_TEST=1 APP_LIFECYCLE_TEST_PORT=3151 UI_TEST_CANDIDATE=.data/remaining-web node --import tsx tests/app-lifecycle-preview-server.ts`。候选构建需预先用 Vite 生成；也可省略 UI_TEST_CANDIDATE 使用开发发布产物。全部为隔离数据，禁止将测试 Controller 暴露公网。
