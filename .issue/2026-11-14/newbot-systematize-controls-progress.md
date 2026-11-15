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
- 隔离fixture localhost3164：专家空名称/空内容时保存禁用；填名称和提示词后按Enter，成功创建并返回目录；手机390×844技能空提交被浏览器required阻止，取消回目录并恢复“添加技能”焦点；刷新技能不触发表单；添加连接器可取消；添加商店提交非法链接显示错误、保留输入并恢复按钮。fixture模型/连接器均为替身，不作为真实第三方兼容证据。
- 原公网页面留存桌面目录、桌面/手机专家创建表单对照图，未保存原实例配置。证据在evidence-systematize/controls。

## 发布方案与边界
用户已授权公开网络。仅发布该分支完整web构建，保留前一代资产及完整回滚备份，不把实验lab作为入口，不重启未修改的后端，不迁移数据。发布后核对public entry hash、原记录/配置一致、原UI对照和真实模型文本。第三方OAuth/安装写操作不在本批重复验收范围。
