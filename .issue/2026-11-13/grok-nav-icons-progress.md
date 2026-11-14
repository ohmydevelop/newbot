# GCF-6 进度
调查已完成，计划先于产品代码落盘。前轮ship不能替代本轮用户截图；主要漏检为实际显示尺寸18与24的差异，以及近似路径仍保留。

- 首次候选浏览器测量发现第二层共同原因：styles.css:4759强制主导航SVG宽高/flex为24，即使组件传18也被覆盖；插件不受此规则影响。已保留fidelity-initial.json，并修正该共享样式源，不叠加局部补丁。
- ReferenceIcons.tsx 保存采集的静态功能轮廓，所有路径保留原transform与线端/填充；使用currentColor适配主题，无Lottie运行时。主导航和折叠栏三图标传18px，主导航共享CSS也修正到18px；图标留在24px槽中。
- 同类入口：PluginIcon仍由AppIcons统一导出，目录/选择/能力侧栏/执行过程同步继承新路径；Search图形亦统一到ReferenceIcons。历史更多14px及箭头14px采用对应轮廓。
- 类型检查通过；5项图标身份及过程边界回归通过。仅展示几何变化，不修改模型、执行、持久化。搜索入口实际打开并将焦点放在搜索框。
- 最终390px真实浏览器：search/new-chat/plugin均18×18、x=19，点击目标44px；ChevronDown14px。与reference-paths的d/transform/linecap/linejoin逐项相等，fidelity.json所有sizeMatches/pathsMatch为true。前次错误的fidelity-initial保留。
- 桌面1280px展开与收起栏均18px。新建聊天返回空白输入、搜索进入聚焦搜索框、插件打开真实隔离目录并返回，均已点击验证。截图mobile-candidate.png、desktop-candidate.png已目视确认。

- 320px浅色检查无水平溢出，三图标18px、主题色rgb(23,23,23)，无console error；保存mobile-320-light.png。
- 独立复核指出DESIGN.md仍记主导航24px：已纠正Shapes/Navigation两处事实描述，不改变既定风格或产品范围。更多菜单图标补拍有历史项状态。
- 补充有历史项的mobile-candidate.png，More实际14px且全部路径与reference相等，已加入fidelity.json；更多菜单可打开重命名/归档。隔离合成任务已停止，不影响实际用户任务。

- 手机使用touch emulation后pointer:coarse=true、hover:false，More opacity=1、width14；最终截图有更多入口。Enter打开搜索并聚焦搜索框，Escape关闭通过；未做完整键盘遍历审计，计划已标明边界。
- 设计文档补充历史更多/分组箭头14px；计划风险表的已验证项同步关闭，避免记录状态漂移。
- 独立完整复核见 grok-nav-icons-review.md；两项证据/文档缺口修正后的评分 grok-nav-icons-verdict.md 为 disposition: ship，仅覆盖该两项评分，不扩大为全站1:1或动画/完整键盘审计。
- 静态发布完成：使用项目原子发布流程，保留上一代资产；没有重启模型服务。备份 .data/restart-backups/grok-nav-icons-20261113T151422Z 包含旧web及SQLite一致性快照，仅作回滚保障，不修改数据。
- 公开HTML与本地相同；JS index-D7Wj-5bR.js、CSS index-CFNS25Fo.css 逐字节/哈希匹配。PID仍408838，ready=true，配置表哈希不变，旧entry保留。证据deployment.json。
- 线上390x844真实触屏条件coarse=true：search/new-chat/plugin宽18、x19；分组箭头14；17个历史更多图标均14；无横向溢出。live-mobile.png已目视确认，来自用户实际实例，并非隔离数据。

## 最终追踪
GCF-6原图 → 24单位坐标误当24px显示 + CSS强制24 + 近似轮廓 → 展开/收起/移动侧栏及共享插件/搜索 → 参考静态几何、18px图标与24px槽、CSS源规则修正 → fidelity.json、深浅/桌面截图、线上资源与实测：完成。
记录无悬空待验项；范围外为Grok商标/账户照片、动态Lottie效果、完整键盘遍历及全左栏布局复刻。保留newbot品牌和状态能力。无数据库迁移、无模型协议变更、无git提交。
