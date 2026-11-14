# newbot 连续迭代索引

更新：2026-11-14。用途：串联本次 Grok 对齐、行为修复、插件体系和实际部署，后续工作先读本索引，再读对应计划、进度与证据。历史“完成”仅代表当轮验收范围，不替代当前运行核实。本文是记录索引，不新增实施授权。

## 用户持续要求

- 日常聊天优先，工具与设置按需展开；沿用 Grok 的布局、配色、图标、折叠和交互习惯，保留 newbot 能力，减少冗余说明。
- 插件底层优先 Codex 原生多商店；Claude/Grok 等生态通过后续转换器接入，不能把研究结论写成已实现兼容。
- 选择的专家/技能/插件不应持续占据发送框或用户消息；专家是提示词与能力组合，最新要求为独立分类。
- 推荐问题必须来自上下文；发送立即反馈；正文与附件分开；执行流程紧凑、有真实状态、思考默认折叠，滚到边缘能继续查看聊天。
- 必须验实际实例与公开入口，不以源码、模拟测试或旧截图替代部署验收。

## 各轮记录入口

| 轮次/主题 | 计划与调查 | 实施、验证及边界 |
| --- | --- | --- |
| 初次 Grok 界面分析与重构 | [分析](grok-ui-analysis.md)、[计划](grok-ui-plan.md) | [进度](grok-ui-progress.md) |
| 实际部署与真实模型 | [计划](grok-ui-deploy-plan.md) | [进度](grok-ui-deploy-progress.md) |
| 字体、文案与细节精修 | [计划](grok-ui-refine-plan.md) | [进度](grok-ui-refine-progress.md) |
| 固定三问复发与动态补充 | [计划](context-followups-plan.md) | [进度](context-followups-progress.md) |
| 聊天发送与能力展示流程 | [计划](grok-chat-flow-plan.md) | [进度](grok-chat-flow-progress.md) |
| 执行过程图标和折叠 | [计划](grok-icon-process-plan.md) | [进度](grok-icon-process-progress.md) |
| 导航图标尺寸/轮廓 | [计划](grok-nav-icons-plan.md) | [进度](grok-nav-icons-progress.md)、[复核](grok-nav-icons-verdict.md) |
| 插件中心与设置整体交互 | [反馈](grok-plugin-system-feedback.md)、[计划](grok-plugin-system-plan.md) | [进度](grok-plugin-system-progress.md)、[复核](grok-plugin-system-verdict.md) |
| 深层表单、Codex 多商店、附件 | [反馈](grok-deep-plugins-feedback.md)、[计划](grok-deep-plugins-plan.md)、[研究](grok-deep-plugins-research.md) | [进度](grok-deep-plugins-progress.md)、[复核](grok-deep-plugins-verdict.md) |
| 紧凑流程、滚动衔接、URL推断、独立专家 | [反馈](grok-workflow-contracts-feedback.md)、[计划](grok-workflow-contracts-plan.md) | [进度](grok-workflow-contracts-progress.md)、[复核](grok-workflow-contracts-verdict.md) |
| 连接器布局、官方安装、OAuth与局部CA | [计划](connector-contracts-plan.md) | [进度](connector-contracts-progress.md)、[复核](connector-contracts-verdict.md) |
| 分享地址失效恢复 | [计划](share-recovery-20261114-plan.md) | [进度](share-recovery-20261114-progress.md)、[证据](share-recovery-20261114-evidence.json) |

## 需要保留的因果结论

1. **固定三问并非只改提示词即可修好。** 早期提交保留 fallback；移除后真实模型仍会漏生成协议块。最终采用共享解析和选择、去掉固定兜底、独立上下文补充生成、缓存与过期响应检查。补充不产生新的主任务；失败不伪造问题。真实验证仅覆盖记录中的模型配置。
2. **图标对不上不只是 SVG 路径。** 24 单位坐标误作显示尺寸、共享 CSS 强制 24px 都造成偏差；修复轮廓、实际 18px 尺寸与 24px 槽，并查展开/收起/移动入口。不能仅看组件传参。
3. **插件深层交互需共享导航。** 多套管理页/多层弹窗带来返回、Escape、焦点、滚动位置和错误显示问题；共享目录导航解决这些共同机制。目录与空态必须使用相同过滤结果。
4. **原生协议存在不等于调用链可用。** 多商店首次失败涉及 Runner RPC 白名单；重启又发现 TOML 名称映射问题。需验证注册、同名隔离、安装、技能发现、重启恢复、失败不留注册和来源目录。
5. **专家与流程必须贯穿模型输入/历史恢复。** 最新专家独立分类、可写提示词；提示词需保存、快照化、真正注入模型，同时从用户正文隐藏，纯附件入口也要覆盖。流程状态由原生事件补齐，不能仅改显示文本；嵌套两层滚动均需解除阻断。
6. **部署可用性必须单独验证。** 本地服务、隧道进程存活均不能证明公开入口可用。本次旧双域名 NXDOMAIN、边缘连接失败；重建双隧道并同步精确 origins，核验登录保护、资源和数据。未证明上游为何撤销旧域名。

## 最新约定与历史结论的覆盖关系

- GCF-7 的“专家归技能”已由 GCF-9 独立专家分类取代；旧进度不回写，以保留演变。DESIGN.md 的旧 GCF-7 描述尚有漂移，以 GCF-9 计划及当前 surface brief 为准。
- 旧 wines-metric-switches-under 地址仅用于历史验收。最新主站为 https://renewal-disciplines-fabric-mortality.trycloudflare.com ，运行来源记录在 `.data/public-share.json`；此处记录时间点，不保证临时域名持续有效。
- 当前保留：原数据与配置，原登录密码；备份路径、资源名称与逐表核验见每轮部署记录。密钥、密码、Cookie 不写入 issue。

## 未解决项与不能扩大表述的边界

- 实体手机触摸滚动衔接尚未实测；滚轮与键盘已验证。触屏条件模拟不等于物理触摸验收。
- GCF-10已恢复GitHub空包及详情读取，详见live-plugin-recovery.json；外部GitHub账号与业务工具未验。hids目录显示已连接仍不等于业务工具验收。
- 私有 GitHub 深层链接认证、非 GitHub 深层网页解析未验；内置保留商店不能重复导入，遵守原生限制。
- Claude/Grok 转换器尚未实现；合成目录/模拟模型与真实 Codex/真实模型证据须分开。
- Quick Tunnel 非固定地址；重启/失联后可能更换，长期稳定入口仍需要固定域名部署。
- 记录已落盘；本轮未创建 Git commit，不能把文件存在称为已提交或已推送。

## 后续继续时

先核对最新用户反馈和运行版本，再选对应计划追加新轮次；保留原始反馈与失败证据。更新“问题 → 根因 → 关联入口 → 修复 → 验收/限制”，不要仅留下完成清单。每次部署核验真实入口、资源、认证、数据保留；同一条历史记录不得替代新一轮实测。

## GCF-10 新增因果记录
- 原生官方商店路径属于各自CODEX_HOME；隔离安装必须复制到安装器自己的受信任保留路径。包缓存Git SHA与展示版本不同，不能按展示版本猜路径，不能让读取逻辑创建空包后标已安装；安装与旧缓存迁移必须共享存在/非空检查。
- OAuth回调HTTP 200不是授权完成。native通知名、index会话所有权过滤、配置维护锁、前端attempt匹配必须逐段验证；无chat ID的配置事件也要到达，但只传播安全投影。旧完成不能释放新登录锁。
- TLS必须按连接器origin隔离信任；UI选证书、配置持久化和实际native HTTP工厂缺一不可。合成上游协议通过不代表外部Slack已授权。
- systemd transient服务stop后可能消失，部署前应辨认生命周期；GCF-10已转持久用户单元，未开启开机启动。最终版本/数据/公开入口证据见本轮进度。
