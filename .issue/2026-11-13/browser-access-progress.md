# BROWSER-ACCESS-20261113 进度

已完整复核用户截图和本聊天历次操作：内置浏览器打开、浏览器发现与重置后状态读取均受同一报错拦截。

证据链：打开 Grok 失败 → 连接前 browser/access 授权响应未满足允许条件（同版本实现依据，未抓取原始授权响应） → 内置浏览器/Chromium 发现共同受影响 → 核实配置开关与扩展安装 → 下一步检查 Work 权限及新聊天连接 → 通过后访问 Grok 截图。

保存 config-summary.json（只含版本、插件开关和连接文件存在性）；access-check.txt（安装版本中的校验代码片段与哈希，不包含秘密）。账号标识、认证材料、cookies、浏览历史未存入证据。

当前 Work 执行器日志可见一次复制 ENOENT 后 attempt=3 恢复连接，不把已恢复错误当作当前根因。官方 Linux 平台限制是相关证据，但无法证明其就是报错触发条件。

未执行任何产品修改、系统配置变更、服务重启、扩展重装或缓存删除。当前无法通过工具修改 Work 浏览器权限；需确认实际设置界面或在新的正常授权聊天验证。没有宣称修复或网站已访问。

## 更正：当前界面为 Codex

用户明确纠正当前操作的是 Codex。不得根据报错中的 Work settings 推定用户正在 Work 模式，或要求用户寻找未经确认存在的 Work 设置页。

新增运行证据：当前工具命令父链为桌面 ChatGPT 进程 → 打包 codex 进程 → shell；该 codex 进程确实带有三项 BROWSER_USE_ACCESS_* 授权上下文变量（仅记录存在性，不保存值）。unified-computer-use 插件的 .mcp.json 明确将这些变量传入 cua_repl，并加载 require-browser-access.mjs。浏览器授权检查适用于当前实际加载的工具，固定报错措辞不能用于判定产品模式。尚不能认定变量被错误注入、工具错接 Work 或存在可安全修复的本地配置错误。

撤回“需提供 Work 设置页”作为必经操作。后续应核对当前 Codex 的浏览器授权状态/官方工具集成，若需要界面证据，使用用户实际 Codex 设置入口。授权响应拒绝的具体原因仍未确定；不修改或删除授权上下文来规避检查。Grok 访问与截图仍未完成。

## 第三轮只读定位结果

使用 Craft Anything CLI 0.6.0 完成静态恢复；doctor 确认没有当前 Codex MCP 注册，setup --dry-run 未修改任何配置；使用现有 CLI，因此无需注册或重启。项目会话已记录 brief、plan、hypotheses、findings 和 handoff。

证据目录 evidence-browser-access/：static/manifest.json 记录安装包内路径和 SHA256；readable/ 保存两份主进程源文件的格式化结果；actual-runtime-access-check.txt 对应真正 @oai/browser-desktop runtime；runtime-summary.json 只保存类型与开关信息。Craft 项目 codex-browser.cany 中 fnd_1/fnd_2 对应判定分支与登记机制，hyp_1 已支持，hyp_2（当前会话登记缺失/陈旧）仍 testing。

新事实：当前 session_meta 的 session_id 与聊天 id 一致，originator=Codex Desktop，history_mode=paginated；不据此推定 Aeon。当前 cua 子进程 surfaces=browser，executor 标记为 native-browser-plugin。主进程的身份还原表仍未直接读取。

最终复核：cua.getState 仍返回 apps=[]、browsers=[] 和 Local browser use is disabled in Work settings。请求没有到 Grok。没有执行安装包代码、注入调试器、改变配置、重启服务、替换签名响应或绕过授权。

问题 → 当前授权失败；原因层 → 会话映射/主体/模式/执行器检查；关联功能 → 浏览器发现、创建标签、会话恢复与分叉；下一步 → 获得区分分支的受支持诊断并做新旧聊天对照；验收 → 允许时真实访问截图、拒绝时原因准确。详细代码行号和分支清单见计划第三轮。

## 第四轮：继续分析结果

- 受支持的 app MCP `read_thread` 确认当前聊天为本地 Codex。旧的动态工具同名入口提示已停用，按提示转到 MCP 后读取成功；这不是浏览器拒绝的原因。
- 新提取一个 605616 字节主 bundle，哈希及路径见 `static-round4/manifest.json`；Craft 静态恢复证据 `ev_84a8d868abb1003866892ba725b3b069fcaf72d640a57f5fe2f8ab5a26ec98e6`。
- 完成配置合并、版本过滤及普通恢复省略 config 条件检查：未发现这些转换会丢弃已有 node_repl 身份。由此收窄第三轮假设，不将普通恢复优化当作已证实根因。
- 独立 daemon 清单与当前工具所属进程不是同一证据对象，不用其缺少当前聊天条目推断权限表内容。
- 没有重复重置浏览器工具；既有拒绝仍未修复。向用户请求在同应用新建聊天，通过正常工具做新旧聊天对照。当前没有受支持的主进程 Map/有效模式/拒绝原因读取接口，无法仅靠现有日志确定最终分支。
- 分析产物已保存；产品、系统与浏览器配置均未修改；Grok 截图仍未完成。

## 第五轮：对照结果已返回

用户回复“新聊天也报同样错误”。标记为用户报告复现，与本聊天工具直接观察区分记录。新旧聊天对照不再 pending；仅旧会话陈旧状态的解释优先级下降，共享登记/主体/有效模式仍待验证。同一句通用提示不能证明两个聊天命中同一拒绝分支。

本轮仅更新调查判断及后续计划，没有重复要求新建聊天、没有更改浏览器设置或绕过授权。Craft MCP 另案已完成注册和独立协议测试，但当前工具清单没有 Craft 命名空间；不能将该连接任务视为浏览器修复。

剩余阻塞：没有受支持接口暴露现场授权类别；需要会话映射存在性、主体匹配结果、有效模式和最终拒绝类别才能区分根因。记录中保留代码行号和已验证转换，供后续支持诊断使用。

## 第六轮：持续测试、完整重连准备

正常 CUA 再测仍拒绝。打包 Codex doctor 的脱敏结果保存于 evidence-browser-access/codex-doctor-round6.json：配置解析、MCP 配置、ChatGPT 登录材料存在性、provider HTTP 与 WebSocket 握手正常。doctor 不检查当前会话 overrides，也没有读取 desktop 授权 Map，不能据此证明当前主体匹配。与本问题无关的其他聊天库存明细已从证据中去除。

pacman -Qkk openai-codex-desktop：4148 个文件，0 altered files。已安装版与本机仓库缓存中的版本均为 26.1027.51404-1；这不是远端最新版验证。无需对完整安装盲目重装。持久化 desktop 没有 conversationDetailMode 覆盖；检查的三处本地/项目策略文件均不存在。启动参数没有本地 daemon/能力覆盖。

观察到多个 node_repl 子进程（含新创建进程）携带 native-browser-plugin 通用身份。只保存身份分类，不记录账号值、签名材料或管道地址，见 repl-identities-round6.json。这支持继续检查共用身份登记，但不证明主进程 Map 为空。

主进程 PID 3191 与此前相同，尚未完整重启。app list_threads 返回唯一 active 聊天为当前聊天，其余已列出的聊天 idle/notLoaded。下一步按官方 extension troubleshooting 第 6 步执行一次完整桌面重启；现有 chatgpt.service 的 Restart=always、KillMode=control-group，使用独立用户 transient service 执行以免重启操作随当前工具进程一起终止。保存重启前后 MainPID/活动状态；不删除缓存、不改浏览器授权、不改应用代码。

重启后必须：读取 restart-result-round6.json 判断是否真正换进程 → 使用正常 cua.getState → 若通过则打开 https://grok.com/ 并截图；若仍拒绝，记录重启无效，不能将重启当作修复成功。Craft MCP 是否加载是另一个可观察检查，不等同于浏览器修复。

## 第七轮：重启已完成，浏览器验收失败

确认 restart-result-round6.json 的 stage=restarted、restart_exit_code=0、supervisor_pid_changed=true，systemd 服务正常，主应用进程也已更换。重启后 CUA 正常调用仍拒绝，未访问 Grok。

Craft MCP 已真实接入：两项 core 只读查询成功。默认 MCP 会话没有打开持久化项目，不把空 session 当作旧调查记录丢失；旧项目仍由 CLI --project 定位。

新日志的 Conversation state not found 已追到 UI/聊天状态更新，尚无证据和 browser/access 拒绝关联；未贸然修改状态或数据库。当前聊天的 SQLite 日志检查没有提供拒绝类别。官方安装包 HEAD 403，无法核验新版，未重复请求或绕过限制。

本轮未继续重复重启、创建聊天或重置 CUA。产品侧拒绝类别不可见，仍无法选择有证据支持的本地补丁。计划第七轮记录了必须补充的诊断字段；现有调查可用于向产品支持反馈，但本次未发送给第三方。

## 已打开标签页的复测

用户再次请求检查时，应用提供的浏览器状态显示内置浏览器已有一个 https://grok.com/ 标签页。通过正常 CUA `getTab({url:"https://grok.com/"}, {browser:"iab"})` 尝试绑定该现有标签页，仍返回 `Local browser use is disabled in Work settings`。这次检查覆盖“读取已打开页面”入口；无法读取页面内容或截图。标签页存在不等于代理访问已获准。

## 用户明确请求再次重启 Codex 与 ChatApp

用户发送 restart codex and chatapp。检查确认 Codex 为 ChatGPT 桌面服务子进程；本次按用户明确指令再次重启 chatgpt.service，而非自行重复浏览器排障。使用独立 transient service 执行，结果保存 evidence-browser-access/restart-codex-chatapp-user-request-result.json。服务启动不等于浏览器已修复，后续仍需正常 CUA 验证。

用户要求再次 access grok 后，正常 CUA getTab 访问已有 https://grok.com/ 标签页仍返回 Local browser use is disabled in Work settings。再次重启结果：restarted，退出码 0。未读取网页、未取得截图。
