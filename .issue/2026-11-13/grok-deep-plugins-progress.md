# GCF-8 进度与证据
- 已读完整本轮反馈及AGENTS规则，继承GCF-7实际部署但不将历史ship当作本轮验收。
- 已核对Codex原生商店协议、现有单来源逻辑与乐观/历史附件两个入口。
- Grok已观察Add MCP Server及New Skill同面板表单。Page.captureScreenshot captureBeyondViewport:true会触发此页面状态重置；现用false保留当前状态，旧截断参考需补拍验证。
- Craft已更新brief/plan；源码直接阅读，外部CUA/文档证据不虚构Craft evidence ID。

- 原生双商店验证首次失败：Runner RPC白名单未包含marketplace/add。协议生成文件有方法不等于执行器已放行；补充这一必要方法，商店更新通过隔离的新原生快照准备，移除仅登记变更。未放开任意RPC。

## 实施与验证
- Codex多商店：新增SQLite注册、原生隔离快照、幂等回执、revision比较、失败回滚与已安装商店移除保护。旧newbot-imports兼容。
- 真实重启验证发现CLI点路径中的引号成为名称内容，修为完整TOML表；native-marketplaces.json覆盖双商店、同名独立安装、技能发现、注册恢复及原生重启配置传递。
- 深层共享CatalogDetail头部/返回/窄表单/底部按钮；添加商店、技能书写、技能导入、连接器编辑共用样式。技能书写复用上传→扫描→安装协议。
- 3151原生浏览器：两合成商店成功添加；第一商店资料笔记安装后第二商店同名项仍可添加；weekly-notes创建成功并读回完整指令。
- 附件共享UserMessage负责乐观与历史；3152模拟上游浏览器验证文字在前、图片独立在后，刷新无重复，可预览。纯双图pending和reload都只有两个message-image，无空文字气泡，无390px横溢出。模型/工具事件为合成，非真实服务证据。
- 首轮全套535项，534通过、1跳过；后续增加纯附件HTTP幂等/空消息拒绝测试通过。最终构建后需补最终针对性验证。
- 研究与未来转换器边界见grok-deep-plugins-research.md；未宣称已完成Claude/Grok生态转换。
- 最终自动化536项：535通过、1跳过、0失败。最终针对性覆盖纯附件HTTP、商店注册、插件操作；类型检查通过。
- 独立复核初判fix，仅两项：手机深层背景按当前Grok参考设为#191919；坏来源提示地址/访问权限，等待同路径复拍评分。
- 浅色连接器真实切换已验收：theme=light、390px无横溢出，connector-light.png。
- 3151完整进程重启后保留SQLite/资源目录继续验证；native市场配置映射问题已修复，商店与技能重启恢复纳入验收。
- 错误复查又发现共用importTree会创建不存在的源目录，随后原生返回笼统解析错误。商店读取在复制前改为lstat检查源目录，不创建用户指定来源；新增测试证明失败后来源仍不存在。公开错误保留安全的产品文案，泛化的原生错误转为地址/权限恢复说明。
- 两项独立复核修复已完成同路径截图：手机深层背景及字段rgb(25,25,25)；320px坏来源明确提示检查来源地址/访问权限，草稿保留可重试。未改全局聊天/目录背景。

## 实际发布与最终验收
- 独立复核最终 `disposition: ship`，仅覆盖报告两项修正；grok-deep-plugins-verdict.md。普通系统扩展保留既有DESIGN.md/.impeccable/design.json，深层例外和精确背景记入surface brief；没有整体替换设计系统。
- 空闲维护锁成功；备份 `.data/restart-backups/grok-deep-plugins-20261113T233744Z`，含原dist及quiescent SQLite。原子web发布保留上一代328条资源；替换后端后newbot-test.service PID变为973684，ready=true。
- 原入口 https://wines-metric-switches-under.trycloudflare.com/：HTML与JS index-a15jj5cR.js、CSS index-CnQYG2QV.css逐字节匹配发布产物。schema仍17。
- 发布前20个聊天、60条执行记录全部保留；provider_configuration、extension_configuration、plugin_connection_settings逐行未变。生产未注册合成商店或安装测试技能，商店仍为原Codex和newbot-imports。
- 生产新建独立验收聊天，实际session_runtime确认deepseek-flash；正文立即出现/发送状态切换，真实模型1秒完成“多商店与附件界面验收完成”。推荐追问由当前上下文生成，未改为固定提示。未调用外部工具或读取用户文件。
- 实际公网添加商店、新技能表单已检查，见live-add-store.png、live-skill.png；最终截图逐张目视确认。隔离测试服务器与临时浏览器页面已关闭，恢复视口，仅保留生产验收页。

## 剩余边界
- Codex真实双商店/安装/技能发现/重启已验；合成目录未含真实账号授权。远程Git/SSH仓库认证未做外部安装验收。
- Claude与Grok转换器为后续实现；本轮研究提供输入/输出/权限和不兼容项矩阵，没有宣称全生态兼容。
- 生产GitHub plugin/read仍400，返回原生“Codex 操作未完成…”；本轮未修复其账号/原生详情问题，未更改授权。hids当前UI显示已连接，故不沿用上轮连接失败判断；未执行其实际业务工具。
- 附件布局/预览/纯图/多图/重载是隔离真实HTTP+模拟模型上游验证；真实模型只验证短文本，不把它称作图片理解验收。
- 构建仍有既有大chunk提示；测试全套535通过/1跳过，最终新增源目录保护等8项专项全部通过，最终类型检查通过。
