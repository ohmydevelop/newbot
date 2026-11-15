# NB-SYS-02 · 公共控件第一批进度

2026-11-15。实现及隔离验证完成，公网发布验证待追加。不是全产品体系化完成。

## 实施
- 新增FormActions，沿用editor/catalog/modal三种既有CSS类，不创建新布局。
- 新增FormSubmit，集中submit类型、disabled/busy、aria-busy、原忙碌标签或16px旋转图标。调用方保留校验、状态、回执和API。
- 迁移ConnectorEditor、GatewayEditor、PluginComponents配置表单、ExpertsSettings、SkillCreate、MarketplaceSettings六个入口。
- 新增CatalogRefreshButton，迁移连接器/技能/专家目录，保留技能ref与17px图标，其余18px；刷新显式type=button。
- CSS/token、图标路径、聊天shell、依赖、服务端/native/API/数据格式均未改。删除/安装/OAuth有不同语义，保留原实现。

## 验证
- 严格npm ci完成，原package-lock未修改。首次类型检查发现ToolsSettings仍在菜单icon参数使用RefreshCw，恢复该导入后完整build通过。没有抑制报错。
- 原配置/恢复/插件配置/连接器契约/插件管理/技能目录48项测试通过；静态压缩与遥测3项通过。完整构建含TypeScript检查、MCP测试包、Vite、Brotli/gzip和服务端bundle。
- Impeccable mechanical detector对10个变更控件返回[]；这不替代浏览器验证。
- 隔离fixture localhost3164：专家空名称/空内容时保存禁用；填名称和提示词后按Enter，成功创建并返回目录；桌面技能空提交被浏览器required阻止，取消回目录并恢复“添加技能”焦点；刷新技能不触发表单；添加连接器可取消；添加商店提交非法链接显示错误、保留输入并恢复按钮。fixture模型/连接器均为替身，不作为真实第三方兼容证据。
- 原公网页面留存桌面目录、桌面专家创建表单对照图，未保存原实例配置。证据在evidence-systematize/controls。

## 发布方案与边界
用户已授权公开网络。仅发布该分支完整web构建，保留前一代资产及完整回滚备份，不把实验lab作为入口，不重启未修改的后端，不迁移数据。发布后核对public entry hash、原记录/配置一致、原UI对照和真实模型文本。第三方OAuth/安装写操作不在本批重复验收范围。

## 公网发布与实际验证
- 已发布源码提交19cf201的完整web构建，入口保持 https://graph-curriculum-activities-rats.trycloudflare.com/ ，原密码沿用。原服务PID2322970未变，未重启后端/native。
- 前一代84条静态资源路径保留，旧entry仍HTTP200；原完整web与SQLite备份位于原实例.data/backups/2026-11-15-systematize-controls。可恢复该web备份而不恢复/覆盖新用户数据。
- 公网entry SHA-256与本分支构建一致。部署后、验收新消息之前逐行核对threads/extension_packages/extension_imports/plugin_connection_settings/private_field_sets/provider_configuration全相等（24/5/3/2/4/1）。
- 公网连接器与原商店来源、专家、原成员可读，深层创建表单保持结构，取消正常返回；桌面对照截图差异指标见visual-comparison.json（没有声称全产品逐像素相等）。
- 发现高层viewport设置未实际生效，DOM测得仍1280×720。原“mobile”文件改名viewport-attempt/desktop，不当手机证据。改用文档支持的CDP仿真后测得width390/height844/scrollWidth390；实际手机侧栏→插件→专家→创建→取消→关闭通过，证据public-expert-390.png。已清除仿真设置。手机没有改前/改后像素对照，不能声称做过该比较。

- 公网真实deepseek-flash文本已回复“原有功能入口保留，聊天连接正常”，刷新后原回答恢复；新增1条验收会话/1次run、活动completed，原24个会话ID保留，插件/凭证/Provider配置仍逐行相等。详见real-model.json和public-real-model.png。
- 浅色设置→模型服务→添加表单可用；仅查看未保存，已恢复跟随系统。此次只有变更控件范围的UI与状态验证，不宣称重新完成所有第三方安装/OAuth、MCP Apps或全产品验收。
- 第一批已完成并公开可用。后续按NB-SYS-01调查状态/领域边界，不能把本批组件整理标为整个重构结束。
