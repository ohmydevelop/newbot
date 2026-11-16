# NB-UI-13 进度

用户授权在本地补齐CI与剩余验收，并整合模型页面。开发树干净，起点c8ea9bc；保留原Grok风格上下文，继续应用Impeccable。已读取UI12未验收项及共同机制代码，003计划先于产品修改落盘。

## 本地基线及因果确认
- UI12实际Playwright：9通过/7失败（baseline-browser.txt）。6个失败是CUA裁切717px与Playwright包围盒718px差1px；320浅色差异是导航横滚位置与刷新旋转状态。保存原diff与JSON于baseline-failures，不能当作产品回归，也不能直接放宽阈值。
- 新增测试初轮包含测试脚本问题（运动中的handle坐标、selected类、模型displayName、断言matcher）；逐项核对trace后更正，不算产品故障。
- **已复现**非所属pointerup提前结束拖拽（interaction-initial.txt）；根因结束事件没校验pointerId，move/down有校验。共享PanelResizer统一约束，覆盖左右两栏。
- **已复现**慢plugin/list返回抢走搜索框焦点（catalog-race-before.txt）。恢复effect只等目标出现，没有让用户新操作取消；同时旧scroll恢复未核对query/filter。共同ExtensionsSettings取消恢复并核对当前查询，覆盖连接器/技能/专家/模型。
- 模型已接入共享目录/详情，原provider/gateway读写、证书与私密通道保持；新增模型搜索状态，移除旧卡片CSS。待浏览器读写与布局验收。

## 行为验收完成及视觉审查
- 预基线完整本地Playwright **26/26通过**（prebaseline-browser.txt），既有单元 **570/570通过**（unit.txt），类型与设计lint通过。
- 左右鼠标拖过独立sandbox iframe（不透明源，contentDocument=null），遮罩/捕获释放后iframe原生checkbox可点击，Home/方向键/边界/重载偏好正确。记录真实pointer capture丢失、非所属pointer结束、协议输入产生touchCancel、断点卸载。window blur和额外pointer事件使用受控故障注入，**不声称已验证真实操作系统失焦/手机硬件手势**。
- 正常导航与详情采集RAF中间帧、最终态；reduce没有中间动画。工作流程36步默认折叠，内部中段滚动不带动外层，上下边缘衔接外层，折叠重开保留150px位置。模型创建→保存→刷新重读→移除、目录失败→恢复通过本地夹具；原生模型上游/证书兼容性不由此结果证明。
- 夹具缺少原生thread/list的模型过滤返回，触发安全拒删“无法核对原生历史引用”；补齐夹具的合成历史查询，再验证删除成功路径。生产删除检查未修改。
- 五宽度×两主题×四目录=40组共享标题栏几何/溢出检查。截图改为稳定的空目录、刷新完成、移开hover、手机选中分类居中以及显式717px截取；未放宽0.005阈值。snapshot-review.json逐个记录旧/新哈希和像素审查：桌面变化仅导航改名及按钮顶边35–37个裁切抗锯齿像素；手机变化仅导航横滚状态/改名和刷新图标。正文、标题、搜索、间距未变。人工审查后更新10张基线，未用自动更新掩盖失败。
- 轮次中曾出现一次Playwright Chromium headless shell启动后SIGSEGV（interaction-round2.txt），后续完整运行通过；保留原始失败记录，不改产品逻辑规避浏览器崩溃。
- 最终补充wheel取消迟到焦点恢复（同一用户介入约束）；重新构建后运行最终套件与发布检查。

## 默认连接操作补充
模型详情中“设为默认连接”只有在已选择有效默认模型后才可用，避免未选择时点击仅重开同一详情的无效反馈。新增浏览器用例验证：打开条目不会切换默认→选择模型→显式设为默认→状态更新→经更多菜单恢复原默认（default-transition.txt通过）。本地总浏览器用例增加至27项。

## 最终本地验收
- **28/28场景通过**：完整27项最终套件通过；补充模型/MCP共享长配置表单滚动及聊天第二次回复等待后，2项针对性回归通过（其中1项为已有场景复验）。汇总acceptance.json，原始结果browser-results.json / browser-supplement.json，无跳过/重试掩盖失败。四目录40组布局与10张像素基线全部通过。
- 模型与MCP共享connection-editor样式；将独立Modal的宽高限制限定到`.modal`，嵌入详情走外层目录滚动。320px、8个请求头的两种表单实际滚动，证书与保存/添加入口可达、无横溢出（shared-editor-scroll-final.txt）。未修改MCP业务写入逻辑。
- 拖动36个反馈样本，p95 **16.8ms**，低于40ms本地验收预算（drag-frames.json）；正常导航256→57单调收敛，详情透明度/位移连续，reduce直接最终态。recordings保存12段完整视口录屏，已抽帧核对没有上轮截断；灰色余边是Playwright固定视频画布补边。
- 类型、设计lint、570项单元通过；图标来源、字体、色值、752px内容宽、100/180/300ms设计参数未改。本地浏览器验证是Linux Chromium，不把它称为Safari/真机或Grok付费流程完全一致的证据。
- 外部CI仍有此前账户计费阻塞；本轮不改账户/套餐，以本地证据通过发布门禁。下一步提交、备份、同公网入口部署和真实模型只读验收。

## 首次发布与真实配置验证
- b2043e6已推送并按门禁发布到原URL；release manifest、公网主JS/CSS与验收构建一致，服务端未变、七张配置/会话表发布前后哈希一致，备份2026-11-16-web-b2043e66d96a。
- 线上模型目录读取真实“百智-MQ”，默认deepseek-flash、25个模型；详情单层返回导航、获取/选择证书、已保存私密字段入口均保留。未改实际连接参数或凭证。
- 新建UI13验收聊天，发送即显示待提交消息，真实模型回答“模型与聊天连接正常”，流程默认折叠，追问随本轮验收上下文生成。live-models.png、live-chat.png、live-browser.json。此聊天为部署后有意新增，与部署期间数据不变是不同检查时点。
- 在线慢加载暴露一个遗漏措辞“正在加载扩展…”；模型与扩展共用容器，改为中性的“正在读取…”，并把旧模型标签/内部模块加载措辞纳入ESLint禁止项。3项目录/模型针对性复验通过（terminology-final.txt）；lint旧标签与旧加载提示的两次故障注入均被拒绝，中性提示通过（terminology-lint-injection.json）。不涉及布局或接口变化。
- 本次GitHub运行43833715342两个job均0步骤，明确仍为付款/额度限制；ci-annotations.json保存当次证据。本地验证没有冒称为云端CI成功。
