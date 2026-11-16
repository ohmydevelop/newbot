# NB-UI-12 / 001 调查进度

2026-11-16：本轮为分析与计划，无产品修改或部署。

1. 全文读取001.md并查看image.png。用户澄清为顶部控件大小、间距、对齐。完整历史目标以NB-SYS-01“保留旧版体验”为准，不重新启用被否决的实验shell。
2. 核对开发工作树7abc724、生产checkout a53c9d2、线上index与开发dist相同。版本证据evidence-ui-drift/version-check.json。
3. 阅读当前PRODUCT/DESIGN、历史Grok观察、systematize计划/截图比较、当前CI/package与控件/导航/拖动源码。已有手工视觉和浏览器验证，但未形成CI必过体验门槛。不能把无lint、无视觉CI和“完全没有测试”混为一谈。
4. 线上1280×720实测顶部close中心y87，其余y92；见toolbar-metrics.json/newbot-current.png。尺寸30/32/34/36各自设置，绝对定位close与flex主栏分离。需要共享栏布局修复，尚未实施。
5. 实测查询cloudwalker→技能真正加载→返回连接器，query丢失。首次快速切回未丢失，继续等实际挂载后才复现；见catalog-continuity.json。已把冷/热和加载完成的条件加入验收计划。
6. 打开当前Grok正常UI，只观察不发消息/不改账号。当前Connect Apps为设置内页面，与11月13独立面板参考不同，见grok-current-connect-apps.png。尚不判定为所有账号全量改版。后续冻结用户认可参考，不能自动追新版。
7. 只读核实CI缺少视觉/浏览器必跑阶段；性能probe仅覆盖导航/资源/首屏，不把它当拖动/输入性能门槛。拖拽代码风险与已复现故障分开记录。
8. 查证React/ESLint/Playwright/GitHub官方资料；演讲视频定位成功但正文/字幕未获取完整原始记录，不声称逐句核实用户所给总结。GitHub connector仓库搜索不可访问，本地今天issue已完整读到，无必要扩大权限。

问题→原因→措施→验证：
- 001→两个布局所有者→共享Toolbar/close slot→几何断言+三分类/多断点截图。
- 上下文丢失→分类卸载清除query/filter→目录session管理导航暂态→等加载完成的跨分类往返测试。
- 反复偏离→参考未冻结、验收未成为必过门槛→版本化goldens+静态边界+流程/动效/性能门槛→人为坏改动必须失败、同构建发布。

计划：001-ui-drift-analysis-plan.md。待实施事项保持待办，不标“已修复”；无需用户重复解释历史方向。无测试套件重跑，因为本轮只有文档与只读分析，不能拿重跑单测当本轮体验证据。
