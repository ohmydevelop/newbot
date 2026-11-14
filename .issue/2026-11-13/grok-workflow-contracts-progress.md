# GCF-9 进度

2026-11-14：已读最新反馈、源码与 GCF-8 历史线索；已在真实 Grok 只读对照默认折叠、完成式任务标题与24px工具行。计划落盘，开始实施。尚未把模拟或历史证据标记为当前修复完成。

## 已实施与针对验证
- GCF9-1/2：ToolItem 默认折叠；完成状态可见；事件转换补齐原生 started/completed 缺少的状态；32px 桌面、36px手机行高。两层滚动改 auto。浏览器真实滚轮：流程内部0/聊天150，向上120后聊天30且流程仍展开；工具详情0/流程241，向上120后流程121，详情仍0。证据 scroll-wheel.json、scroll-tool-detail.json。键盘翻页到边缘也能进入外聊天。CUA 的 Input.dispatchTouchEvent 明确不支持，普通 drag未模拟触控；触屏手势未实测，不能称已通过。
- GCF9-3：GitHub 公共解析支持 slash ref/tree/blob manifest/release，固定提交，目录快照；根目录交给原生收取，不套用 ZIP 子目录预算。原有来源 ref/sparse字段仍兼容。真实 openai/plugins/tree/main 得到提交 d420d13051bffe4543ed39e30fa46b87148e47dd，原生已到清单身份检查但拒绝 reserved openai-curated；保持此上游约束，添加简洁明确错误，不宣称注册成功。模拟网络 ZIP + 真实 pinned Codex 通过子目录/清单两类读取；缺失目录不注册。
- GCF9-4：专家独立第三分类，方向键循环及End实测；提示词保存、读取、重启、请求快照和提示词单独专家均有集成测试；附件单独发送的生成上下文也会从用户正文移除。手机320px目录无溢出，390px编辑器已保存和读回真实本地测试数据。
- GCF9-5：连接器/导入/商店分别插头、导入、店面图标；删除重复浏览插件；连接器字段保留aria名称、去视觉重复标签。后续补实际表单截图。
- 全套阶段验证：539项，538通过，1个原有skip；后续针对新增代码28项27通过1skip，原生URL单独测试通过；typecheck通过。最新修改涉及保留商店错误和空思考标题，待最终针对检查/视觉复核。
- 进一步浏览器证据：长工具正文1024px可滚区，顶部滚动传给流程241→121，证明两层共享机制均恢复；思考默认关闭、手动展开可独立控制。连接器菜单只保留连接器/导入插件/管理商店，三种图标已截图；手机连接表单无视觉重复标签且本地程序分支仍有程序/参数/环境变量控制。
- 附件专家补充集成测试通过：纯附件+提示词专家只执行一次，模型输入收到提示词，刷新历史用户消息不泄露注入内容。
- 原生浏览器3151通过仅来源字段添加本地合成商店“设计工作室”；目录可见一个插件，与51个原生内置目录共存。保存不会自动安装插件。添加中锁定返回/关闭/重复提交，成功后回到商店目录。浅色桌面表单及深色手机表单截图有效，390/320/1440检查无横向溢出。

## 独立复核第一轮
Impeccable fresh reviewer disposition=fix：仅浅色表单占位文字约3.4:1需修正。已改共享 catalog/deep input/textarea ::placeholder 为 var(--muted)、opacity:1，保留简洁表单；待同视口复拍与reviewer verdict。其余流程密度、折叠、专家独立、图标/去重布局判定match/adaptation。DESIGN.md旧GCF-7段仍有专家归技能的历史描述；本轮surface brief与计划明确新约定，不借任务重写旧设计文档。
兼容补充：旧客户端省略instructions时保留已有提示词，明确传空字符串可清空；5项针对测试全部通过。包含 .agents/plugins 元目录链接的2项native测试通过。

## 最终复核与部署（已完成）
- 复核唯一修复 resolved，disposition=ship；light #646464/#fff=5.92:1，dark #9e9e9e/#191919=6.56:1。六张表单复拍有效，见 grok-workflow-contracts-verdict.md；未宣称超出该fix范围的二次全面检查。
- 备份 .data/restart-backups/grok-workflow-contracts-20261114T001618Z；maintenance确认无活动请求后保留旧server并原子发布web，重启newbot-test.service，PID1040784。启动监听前首次检查连接拒绝，监听就绪后验证通过，非请求/数据失败。maintenance现为false。
- 原地址 https://wines-metric-switches-under.trycloudflare.com/ 页面与本地 dist/web 逐字节一致；JS index-JwPf7SRt.js、CSS index-D_WSMC_d.css 均相同。21个原聊天、61次运行原记录保留，provider_configuration / extension_configuration / plugin_connection_settings / experts / session_extensions 均与停机前SQLite快照完全一致，schema17不变。见deployment.json。
- 真实 deepseek-flash 新聊天01a1d772-156e-70f1-bc3a-5563b59870e4，6.74秒完成；只由专家提示词提供的目标句“专家提示词与新版界面验证通过。”正确返回，用户可见正文没有注入提示词，没有工具调用。测试专家解绑并移除，保留验收聊天；未改现有专家。见live-model.json。
- 线上浏览器确认专家独立分类及原有“牧云安全专家”可见，截图 live-experts.png（390×844）；真实模型界面见 live-model.png。隔离预览服务已停止，临时浏览器测试视口恢复，保留线上验收页。

## 限制/遗留
- 触控边缘传播未能使用本环境工具实测；已实测滚轮/键盘，两层CSS auto与浏览器原生滚动链。不能宣称实体手机触摸验收完成。
- 自动推断覆盖GitHub树/分支/标签/清单及元目录链接；其他服务仓库根地址沿用原生Codex能力，其他平台深层网页和私有GitHub子目录认证未验证。
- 子目录归档继续受40MiB下载、64MiB解压和文件数量等原安全预算约束；不会绕过限制。内置保留商店不可重复导入，明确报错。
- 新指令的存储/快照/恢复、附件、旧客户端兼容有测试；UI截图含隔离合成数据的，均非真实工具执行；真实模型验证单独记录。
- DESIGN.md保留历史GCF-7描述；当前约定以本轮plan和.impeccable/surfaces/plugin-center.md为准。
- 线上连接器目录仍出现原有“部分插件详情读取失败”提示，对应此前已记录的 GitHub 插件详情读取异常；本轮未修复该独立上游读取问题，不将目录全部可用列为验收通过。
