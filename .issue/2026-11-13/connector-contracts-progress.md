# GCF-10 进度

## 已确认因果
- UI：PluginComponents的保存位于form/fieldset内，检查位于form外；改为同一动作组，草稿脏时禁用旧配置检查。可选标签重复来自包字段标题已有“（可选）”而通用渲染再次附加。
- 状态：ToolsSettings右侧状态与McpSettings标题下状态两套实现；未安装包的声明工具复用McpSettings导致“已添加”。统一标题下状态，未安装声明列表显示“安装后可配置”。
- Slack安装：真实隔离Codex复现官方保留商店路径属于原Home而非安装器Home，被上游拒绝；复制受信任原生内置目录及plugins.sha到安装器自己的保留路径后，真实安装成功。没有重命名官方商店以绕过原生安装检查。证据native-slack-isolation.txt。
- 已安装GitHub详情：版本快照生成的只读临时目录复用了保留商店名，仍触发路径限制；改只读快照目录身份，并明确恢复外层稳定插件ID。运行/安装身份不改变，待真实应用集成验收。
- OAuth：插件解析器拒绝oauth.client_id且部署没有公网回调；已接入声明Client ID（可编辑覆盖）、严格保留非密钥字段，集中推导单一PUBLIC_ORIGIN回调避免临时地址更换留下旧回调。真实Slack workspace授权尚未完成。
- 证书：现有插件指纹字段不等于通用MCP TLS能力。新增可选CA配置的后端、上传/恢复默认界面；原生局部信任扩展正在构建，用当前origin分流默认/显式CA客户端，保持代理与网络策略。发布前必须真实TLS/OAuth验证。

## 测试进度
- 原有MCP配置、插件配置/管理、稳定性相关42项通过；不等于真实OAuth服务端验收。
- 新增证书格式/私钥拒绝/持久化与连接器隔离、OAuth回调地址推导、官方OAuth声明和覆盖3项通过。
- 原生TLS/OAuth端到端脚本已建立，使用真实Codex和本地自签名HTTPS/OAuth服务；尚待新二进制构建执行。
- 尚未部署本轮改动。浏览器、独立复核、真正Slack授权边界、原生失败路径仍待验证。

## 资料
OpenAI认证：https://developers.openai.com/plugins/build/auth
插件打包：https://developers.openai.com/plugins/build/plugins
Slack harness与回调要求：https://docs.slack.dev/ai/slack-mcp-server/connect-to-harnesses/
官方资料不能替代当前固定版本和实际账号的实测。

## 集成验收补充
- 真实应用隔离安装暴露“显示版本不等于缓存版本”的第二根因，原安装器把不存在路径自动创建为空并发布。已通过installedPluginRoot解析实际缓存并拒绝空包；共同旧缓存迁移一起修正。production只读审计确认GitHub现有快照为空，需要部署后同版本重装恢复；Cloudwalker非空。
- 完整浏览器：Slack原生安装、详情、Client ID配置、检查返回需要授权通过。未安装声明显示“安装后可配置”，不再冒充已添加；检查/保存同组，修改草稿禁用检查。配置测试包私密保存成功、重复可选消除。
- 私有CA：浏览器390/320宽选择PEM并通过真实保存API成功，无横向溢出。待补读回/清除与浅色布局证据。
- 原生13项TLS/OAuth协议检查通过：局部信任发现/调用、未配证书失败、域名不匹配失败、state拒绝且零token兑换、用户拒绝后可重试、PKCE兑换、newbot公共回调路径转发到原生、完成事件、工具可用、重启恢复。上游为隔离合成OAuth/MCP服务，不代表Slack工作区授权。证据native-tls-oauth.json/log。
- 实测发现原生mcpServer/oauthLogin/completed被错误事件过滤器丢弃，已兼容新旧名称；重试授权固定端口的回调短连接避免复用已关闭listener连接。
- 全量544项：543通过/1既有跳过；原生跨模型提供方历史与插件兼容检查通过。见full-tests.log、native-compat.log。

## 独立复核后的修正
- 旧缓存迁移与新安装共用installedPluginTree，缺失/空目录不会由importTree创建并发布。目录按needsRepair识别历史空快照，提供重新安装；坏旧包不拖垮整个插件目录。原生描述文件名必须为marketplace.json，包外生成描述原子升级，固定包内容不变。
- CA上传32KiB限制改为解码字节与规范化PEM双边界，base64包装允许对应43692字符，避免实际24KiB缩水。
- OAuth完成反馈：原生事件→index.ts配置类分流→AG-UI安全全局事件→按loginId保存的前端结果→两个入口消费对应链接、显示失败或检查连接。无chat ID/内部discovery ID也可到达；不传播原始错误。维护锁等待原生响应时缓冲ID，迟到旧完成不释放新锁，离线清除世代。
- 已新增完整createServer事件入口和待响应竞态回归。真实Slack授权、token自动刷新、跨origin重定向/过期证书仍不声称完成实测。

## 最终验收与部署（2026-11-14）
以上“待构建/未部署”和中间测试计数为历史过程，下列为本轮最终状态。

- **布局与状态**：手机390px实际公开实例复查Cloudwalker配置，检查连接/保存同一行、重复可选消失；Slack安装后可展开Client ID配置。未安装声明不冒充已添加；插件/独立MCP状态均置于名称下。配置状态不代表账号已授权，线上检查Slack明确返回“需要授权”。证据live-cloudwalker-mobile.png、live-slack-mobile.png、live-slack-ax.txt。隔离浏览器另覆盖320px、浅色OAuth失败、深色草稿、桌面1280px；物理手机未实测。
- **安装与关联恢复**：真实实例安装Slack 0.1.7成功；同机制下GitHub 0.1.12空包同版本重装，needsRepair由true变false，详情可读。没有改外部账号权限；GitHub工具授权不在此恢复结论内。证据live-plugin-recovery.json。
- **OAuth**：真实编译的Codex与本地合成HTTPS/OAuth服务完成state/PKCE、拒绝后重试、兑换、回调转发、完成通知、工具发现及凭证重启恢复；13项通过。浏览器合成拒绝事件验证链接消失、失败提示和重试入口，证据oauth-ui-denied-light-390.png。模拟事件不冒充真实Slack授权；真实native协议测试与UI测试证据分开。
- **局部CA**：隔离浏览器选择PEM通过真实保存接口、读回已保存证书、变更origin清除证书；native自签名HTTPS发现/工具调用成功，未配证书连接器不能继承信任、主机不匹配失败。线上添加表单证书入口可见（live-certificate-mobile.png），先填写HTTPS地址才启用选择。未在production创建测试连接器或修改牧云凭证。
- **最终检查**：TypeScript检查及构建通过；全量546项，545通过、0失败、1既有跳过（full-tests.log）；原生跨提供方历史及插件兼容通过（native-compat.log）。独立代码复核三轮发现的问题均已修正，最终交付操作由主代理执行。
- **实际部署**：原公开入口 https://renewal-disciplines-fabric-mortality.trycloudflare.com/ 保持不变。备份位于.data/restart-backups/connector-contracts-20261114T023928Z；maintenance期间quiescent.sqlite与新服务启动后逐表比较threads/runs/provider_configuration/extension_configuration/plugin_connection_settings/experts/session_extensions全部相同。公开HTML与index-DNEjO7fH.js、index-C61aGDD7.css逐字节匹配；ready.runtime=ready，维护锁已释放。证据deployment.json。逐表对照发生在有意修复插件和模型验收创建聊天之前。
- **部署异常及恢复**：原newbot-test是transient unit，stop后单元消失导致start失败；部署脚本先恢复旧dist/env，但旧unit亦不能启动。随后安装新构建与已验收native，并建立/home/a/.config/systemd/user/newbot-test.service持久单元，保留原工作目录/env/端口，Restart=on-failure；daemon-reload/start后恢复。未设置开机自启，双Cloudflare隧道未重建。最终三个服务active。记录此过程，不把首次发布动作称为一次成功。
- **真实模型**：在公开网页发送单条无工具验收请求，deepseek-flash回复“连接器新版模型验证通过”，thread_activity=completed。证据live-model.json、live-model-ax.txt；只证明现有真实模型聊天在新部署可用，不代表Slack工具业务已通。

### 完成边界与遗留
本轮应用代码、UI、安装恢复、局部CA和受控OAuth协议修复已部署并有验收证据。真实Slack工作区授权/回调白名单、token自动刷新、私有IdP兼容、跨origin重定向/过期服务端证书/错误CA的真实端到端条件未验，不标完成。inline client_secret不支持；native局部CA扩展覆盖newbot app-server运行路径，未扩展独立Codex CLI路径。Quick Tunnel仍为临时地址。密钥/Cookie/密码未写入证据，未创建Git commit或推送。
