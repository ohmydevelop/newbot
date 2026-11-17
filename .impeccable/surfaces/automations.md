# 自动任务

Primary target: web/components/Automations.tsx
Related targets: web/automations.css, web/components/AutomationEditor.tsx, web/components/ConversationNavigation.tsx
Mode: Operate

## Direction contract
THESIS: 把重复聊天工作保存为可检查的计划；每次执行是可继续的会话，不是独立日志仪表盘。
OWN-WORLD: 继承 DESIGN.md 温黑/中性浅色、Noto 字体、共享圆角、参考图标槽及菜单动效。不开新视觉体系。
STORY: 新建聊天下进入任务，选择现有任务或创建，先设何时再写做什么，保存后立即试运行；通过概览/运行记录检查并打开结果。
FIRST VIEWPORT: 原导航保持原宽度和折叠位置；自动任务主区域居中最多848px（含内边距），紧凑标题/搜索/加号，已存任务和分类模板同时可用，桌面双列手机单列轻量行。编辑在同一区域逐级进入；图标名称→触发器→说明/扩展→通知，固定标题和操作、正文单滚动。复用共享Picker/ActionMenu，取消恢复列表位置与焦点。
FORM: seed: none (pinned)。用户指定“尽可能1:1还原它的设计理念”和“侧边栏的新建聊天下面添加自动任务”。2026-11-17补充普通Chrome登录态目录与未保存草稿（桌面1280、手机390）证据，路径006-automations-live-alignment-plan.md。保留用户指定的侧栏入口及Newbot工作区外壳；正文对齐实测紧凑目录/分组/编辑顺序，不复制收费广告或更换整个设置系统。未观察Grok已保存运行历史，不声称全功能或所有像素一致。
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Finish outcome
Verdict: ship for the live-reference alignment round. Independent review found one material issue (768px catalog density with retained sidebar); intrinsic column sizing fixed it and all six catalog captures were reviewed again. Evidence: .issue/2026-11-16/006-automations-live-design-review.md and .impeccable/review/automations-live/. DESIGN.md and PRODUCT.md retained; no shipping raster assets added. This covers observed catalog/editor design and the requested Newbot adaptations, not an exact certification of unobserved Grok saved-task history or external event integrations.

## AUTO-4 refinement
User feedback overrides the previous toolbar acceptance: at 320/390 the 44/36/28px mixed controls and free wrapping felt disorderly. Use one 36px axis, two semantic groups, container-aware icon-only auxiliary tools, a short model label with full accessible title/menu, and preserve mode text and selection summaries. Adjacent catalog surfaces reuse the existing automation identity palette and 32/18px mark, 14/12px copy, and square-round row add action. No new global palette or typography; state colors and header navigation remain intact. Evidence and final disposition: 006-automations-controls-catalog-progress.md.

## AUTO-6 ordinary extension
A task owns one persistent conversation, while each run retains its own status and result record. Extend the existing searchable trigger picker with Webhook/GitHub/Hermes/OpenClaw events. Conditions use the incumbent compact popover, persistent field labels and one-line ellipsis summaries; connection details and masked keys appear only on request. No new global type, palette, shell or motion. Independent review fixed disappearing input semantics and returned ship after all six viewport/theme condition captures were reviewed. Evidence: 007-automation-events-design-review.md and .impeccable/review/automation-events/. DESIGN.md preserved; detector's historical compact-type advisories are recorded, not used to re-theme this extension. No raster assets ship.

AUTO-6 post-run state: when a task gains its conversation link, <=480px detail secondary actions use 44px icon buttons with explicit accessible names/titles; status stays on one line and the primary run action retains text. Desktop text is unchanged. Six post-run viewport/theme captures and a public mobile capture passed geometry checks and independent review.

## AUTO-7D ordinary extension
Installed event plugins contribute sources to the existing trigger picker. Accounts, repository and event filters use the existing nearby popover, with persistent minimal field labels and truncated source summaries. No new typography, palette or motion system. Independent finish verdict: ship within this UI extension after reviewing 18 final captures across 320/390/1280 and both themes. Evidence: `.issue/2026-11-17/001-plugin-event-sources-design-review.md`. Physical mobile, soft keyboard, complete animation and external OAuth remain unverified. Native runtime compatibility blocks deployment; visual ship does not waive that boundary. DESIGN.md retained; no shipping raster added.

## AUTO-7E generic event bridge
Plugin-provided parameter schemas now use the same compact nearby popover. Scalar, boolean and enum fields retain visible semantics; shared type, theme, navigation, Picker and animation remain unchanged. Eight current captures cover320/390/768/1280 in both themes; browser assertions cover configuration→actual stdio mailbox→run, overflow and nested Escape focus restoration. Independent review marked EB-UI-1 resolved after adding a persistent enum label (verdict ship at that fix scope). Evidence: `.issue/2026-11-17/001-event-bridge-design-review.md` and `.impeccable/review/event-bridge/`. DESIGN.md retained; no shipping rasters added. Physical phone/keyboard and real third-party OAuth remain separate, unverified boundaries. The prior native-compatibility blocker was corrected: the deployed pinned0.0.0 binary passed actual plugin install/read/uninstall; npm default mismatch was not a production failure.

## AUTO-7F plugin-only triggers (supersedes AUTO-6 fixed sources)

The trigger picker now lists platform time schedules and installed plugin event declarations only. No fixed business names or legacy condition/secret panels remain. The shared Picker, existing typography, colors, compact parameter fields, menu motion and navigation are unchanged. Self-review of desktop light and mobile dark captures found no new layout defect. Fourteen browser cases cover 320/390/768/1280, both themes, no-provider and installed-provider flows, nested Escape focus restoration, overflow, actual stdio plugin dispatch, and normal/reduced menu motion settling. Evidence: `.issue/2026-11-17/evidence-plugin-only-triggers/` and `.impeccable/review/plugin-only-triggers/`. No shipping raster assets. Physical-phone and third-party OAuth verification are not claimed by this round.

## AUTO-8 direct ingress

User direction: external services send directly to Newbot, or Newbot connects outward through an event plugin. Add a generic 接收事件 option to the existing picker and 接收配置 in saved task details; no mandatory relay installation. Preserve the existing Picker, palette, typography and motion. Four direct-ingress browser cases plus fourteen plugin/menu cases pass; self-review of mobile dark and desktop light screenshots finds no new overflow or hierarchy issue. Clipboard denial has an explicit manual-copy path; successful retry clears the error. Evidence: `.issue/2026-11-17/007-direct-event-ingress-progress.md` and `evidence-direct-event-ingress/`. No new visual assets or global design changes. Browser fixtures are not physical-phone or real-provider proof.

## AUTO-9 trigger groups

The trigger picker separates 时间, 外部事件 and 来自插件 using quiet 12px labels from the incumbent compact-picker visual language. Labels disappear with empty filtered groups and are not focus targets. Existing option buttons remain direct children, preserving geometry and Tab navigation; callers without group metadata are unchanged. Eighteen browser cases pass; mobile dark visual self-review confirms the pinned palette and scrolling layout. Evidence: `.issue/2026-11-18/001-history-reset-trigger-groups-progress.md`. No new assets or global token changes.
