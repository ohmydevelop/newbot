# Issue 002 深层交互分析进度

已确认目标为同目录002.md。完整读取原文与image-1至image-7；image-2/5是同轮补充截图。上一轮只覆盖了模型目录及指定滚动/拖拽路径，不能据此认为专家选择窗、技能详情、工具列表也已验收。已落盘调查计划；本轮仅分析，不修改产品。

## 当前版本与证据核实

- 开发源码位于newbot-systematize；原issue目录所在newbot是另一分支。生产服务从newbot/dist运行。公网manifest与生产磁盘一致，前端产品9b29dda，见evidence-002-analysis/version.json。
- 部署服务端bundle仍包含expert/list的name:c.id，而configuration公开视图已有connectorNames；结合浏览器同一连接器在主目录显示hids、专家选择显示connector_UUID，确认显示名丢失链路。
- 浏览器使用公开Newbot实际账号已有数据，只查看设置/详情、打开未保存草稿、搜索后清空；没有保存、启停、连接、授权、调用业务工具或发送消息。Grok只查看连接器创建表单、技能菜单和编辑草稿，未保存；调查标签均已关闭。

## 问题→根因→关联→建议→证据

|问题|根因/当前判断|关联入口与下一步|当前证据|
|---|---|---|---|
|A 专家滚动|当前overscroll:auto，桌面双向交接通过；原设备/版本未知|保护当前行为，补触屏/Safari和import-skills同类路径|expert-scroll-top-chain.json、expert-scroll-bottom-chain.json|
|B 标签|sr-only隐藏必要视觉字段含义|模型、MCP恢复短标签，插件字段另核对；不全局取消sr-only|newbot-form-styles.json，grok-form-styles.json|
|C 加号|同一工具栏无统一添加语义，catalog-add混用多种操作|先区分目录添加与聊天使用，再共享组件与lint|四目录源码、Grok的New Skill仍为文字按钮|
|D 状态错位|状态居中于标题行，更多居中于两行块|共享目录行管理主行/描述/动作槽；模型和专家状态一起验证|row-alignment.json：有说明差10px，无说明差0|
|E 技能跳动|动作在自然高度reader后，源码高度变化推动按钮|标题区动作、紧凑模式切换、目录补菜单；插件/历史Reader权限分离|skill-layout-shift.json：按钮下移114.453px|
|F 工具小窗口|旧卡片224/244px选择器权重覆盖详情height:auto，再叠overflow:auto|独立MCP和复用McpSettings的插件入口移除卡片职责|tools-layout.json：224px容器、5119px内容、125工具|
|G 模型搜索|上一轮已具备，当前实测通过|保留搜索/返回契约，不重做模型页|models-search.txt|
|H UUID名称|expert/list主动把已有name替换为id|选择、详情、不可用提示统一显示名；稳定ID和执行引用不变|server/experts.ts:125，部署bundle:5455，专家浏览器目录|

## Grok及自动检查调查

- 当前Grok创建MCP保留Name/Server URL/Headers标签；技能目录有更多管理菜单；编辑技能有名称/简介/指令层级。保存参考局部截图及字段计算样式。全部改加号不是本次观察到的Grok普遍规律，列为Newbot的设计选择。
- 已读check-design-ownership、eslint.config、settings-contracts和上一轮interaction验收：当前lint限定文件范围，布局基线最终是空专家目录；不覆盖带说明的行几何、长工具详情、技能模式切换操作锚点、专家ID/name映射。
- 建议lint只管组件/语义边界，数据测试保护ID/name，真实浏览器几何/滚动/布局变化保护交互；每个新增门禁注入旧错误确认会失败。

## 边界与完成状态

浏览器DOM报告1280×720，工具截图实际输出641×720可见裁切。初始滚动坐标超出可见宽度没有产生动作，未将其判为产品故障；随后在可见位置完成双向滚轮测试，并保存DOM位置证据。截图扩展名已按真实JPEG格式改为.jpg，未编辑像素。

本轮未做逐帧Grok动画、真机触摸、Safari、导入选择器/插件动态私密表单、真实OAuth与业务工具测试；不宣称这些已通过。当前产品工作树未改；只在原issue目录新增分析、计划、进度与证据，原始issue和图片未修改。

分析完成。完整报告：002-deep-interaction-analysis.md。后续实现步骤、验收阈值及兼容约束已具体化；本轮到分析为止。
