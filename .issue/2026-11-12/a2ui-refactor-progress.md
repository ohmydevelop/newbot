# A2UI 现代化重构：进度

对应计划：`a2ui-refactor-plan.md`。日期：2026-11-12。

## 已完成

| 项 | 内容 | 证据 |
| --- | --- | --- |
| 边界 | 采用 A2UI 协议 / Radix / ECharts / Lucide；拒绝 shadcn、Base UI、Tailwind 运行时、Motion、EasyUI，原因写入计划 | 计划文件第一节 |
| 组件 | v2 新增 `List`、`Grid`（2–4 列 + spans），catalog 10 → 12 | `shared/a2ui-catalog.ts`、`tests/a2ui-catalog.test.ts` |
| 树校验 | 运行时 DAG 校验补上 List/Grid 子节点，否则报 `INVALID_TREE` | `shared/a2ui-runtime.ts` |
| Design Tokens | `--a2ui-*`（圆角/间距/字号/行高/字距）；画布 < 面板 < 字段三层；主按钮 `--accent`；复选框改用 accent | `web/styles.css`、`web/components/a2ui/style.css` |
| 图表主题 | 深浅两套序列色板（暖黄/蓝/紫/绿/灰），单序列隐藏图例，标题 13px | `web/components/a2ui/catalog.tsx` |
| 内容约束 | 工具描述加入三种布局配方与 3–8 组件预算 | `server/a2ui-tool.ts` |
| 三场景 | Dashboard / Form / Workbench，浅/深 × 桌面/移动共 12 张 | `evidence-a2ui/*.png` |
| 自动化 | `npm run test:a2ui-scenarios` 启动隔离实例并断言样式、Grid 列数、移动端溢出、控制台错误 | `scripts/test-a2ui-scenarios.mjs` |

## 实测结果

- 面板：15.5px / 27.125px 行高 / 0.62px 字距 / 18px 圆角；Grid 在 1280px 下 3 列。
- 表单：字段背景为画布色 + 1px 描边，半径 12px；主按钮 `rgb(37,99,235)`（浅色 accent）；动作 `创建任务 / 取消`。
- 三个场景移动端 `scrollWidth - innerWidth = 0`；控制台错误 0。
- `tsc` 通过；相关 A2UI 测试 53 项通过（含新增 catalog 断言）。

## 未完成 / 边界

- 未引入任何第三方 UI 框架；视觉提升通过 token 与自定义渲染器完成（与计划一致）。
- `Card` 未新增（surface 即卡片）。
- 未做 token 级流式 A2UI；增量更新沿用既有 `updateDataModel`/`updateComponents`。
- UI/UX Skill 尚未作为技能包落地；当前以工具描述承载设计决策流程，后续可抽为 `SKILL.md`。
- shadcn/Base UI/Motion/EasyUI 的迁移方案被明确排除，理由见计划表。
