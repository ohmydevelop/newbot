# A2UI 现代化重构：范围、决策与验收

日期：2026-11-12。来源：用户转述的第三方建议（完整重构、组件生态、Design Tokens、Bento、智能组合、安全隔离、UI/UX Skill、真实浏览器验收）。本文件先固定边界与可量化指标，再按阶段实施。

## 一、边界：采用什么、拒绝什么

| 建议 | 决定 | 理由 |
| --- | --- | --- |
| 遵循官方 A2UI 协议（Schema 驱动 / Catalog / Renderer / Action） | **已在做** | `shared/a2ui-catalog.ts` 用 Zod 定义组件并自动生成工具的 JSON Schema；`web/components/a2ui/catalog.tsx` 是 Catalog+Renderer；动作经服务端 `a2ui/action` 回传 |
| shadcn/ui | **不引入** | 它是 Tailwind + copy-in 组件，项目是纯 CSS + 既有组件体系；引入会产生两套样式来源。审美目标用 Design Tokens 达成 |
| Base UI | **不引入** | 与已在使用的 Radix（dropdown/dialog）职责重叠 |
| Tailwind CSS | **不引入运行时** | 构建里只有 `@tailwindcss/vite` 插件，界面并未使用原子类；A2UI 面板用组件级 CSS 变量即可 |
| Lucide | **已用** | 图标统一走 `lucide-react` |
| ECharts | **已用** | A2UI Chart 复用同一实例，只补主题色板 |
| Motion | **不引入** | 微交互用 CSS transition/`prefers-reduced-motion` 足够，避免为动画增加 50KB+ |
| EasyUI 等 jQuery 组件 | **拒绝** | 运行时模型（DOM 操作 + 字符串模板）与 React 白名单渲染、CSP、Schema 校验冲突 |
| 自定义组件注册与扩展 | **部分采纳** | 已有机制：新增组件 = 一份 Zod schema + 一个渲染器；但只允许白名单，模型不能注册 |
| 多主题 / 响应式 / 精细排版 | **采纳** | 现有 light/dark 两套 token；本次补 A2UI 自己的排版刻度与响应式规则 |
| Bento Grid | **采纳为组件** | 新增 `Grid`（2–4 列 + `spans`），不改造既有 Row/Column |
| 流式更新 | **已有，保持** | A2UI 是一次工具调用内增量 `updateDataModel`/`updateComponents`；不引入 token 级流式协议（工具调用本身原子） |
| 禁止 HTML/JS 注入 | **保持为不变量** | CSP `default-src 'none'`、无 HTML 组件、严格 Zod、动作白名单，已有测试覆盖 |
| UI/UX Skill | **采纳为内容** | 仓库已有 skills 机制，新增一份设计决策 skill，不写进代码逻辑 |
| 真实浏览器验收 | **采纳** | fixture 服务 + Playwright，桌面/移动 × 浅/深，共 12 张截图 |

## 二、组件扩展（仅 v2 rich catalog）

| 组件 | 目的 | Schema 要点 |
| --- | --- | --- |
| `List` | 多条状态/日志/条目 | `children: id[]`、`variant: plain \| bordered`；bordered 用分隔线，行高紧凑 |
| `Grid` | Bento 布局基础 | `columns: 2 \| 3 \| 4`、`children: id[]`、`spans?: number[]`（与 children 对齐，1..columns） |

不新增 `Card`：surface 本身就是卡片，嵌套卡片会让层级失真。

## 三、Design Tokens（A2UI 专属）

在 `web/styles.css` 增加一组只服务于 A2UI 的变量，避免和聊天正文/设置面板抢语义：

```
--a2ui-radius-panel: 18px;   --a2ui-radius-field: 12px;
--a2ui-pad: 24px;            --a2ui-gap: 16px;
--a2ui-font: 15.5px;         --a2ui-line: 1.75;  --a2ui-track: 0.04em;
--a2ui-label: 13.5px;        --a2ui-caption: 13px;
```

层次：画布（`--bg`）< 面板（`--menu-bg`）< 字段（`--surface`）；主按钮用 `--accent`（蓝=可点），行内标识符保持 `--entity`（暖黄=内容）。

## 四、AI 设计决策流程（写进工具描述与 skill）

1. **判意图**：监控/趋势 → Dashboard；收集输入 → Form；并列信息 → Workbench；纯文本 → 不用 A2UI。
2. **定主结构**：Dashboard = `Column[Heading, Grid(3×Metric), Chart, List]`；Form = `Column[Heading, Caption, Row(fields), 多选, 长文本, Row(Buttons)]`；Workbench = `Column[Heading, Caption, Grid(2)[Column(Text,List), Chart], SourceLink]`。
3. **选组件**：数字 → `Metric`；序列 → `Chart`；条目 → `List`；图片 → `Image`；来源 → `SourceLink`。
4. **控密度**：1 个标题、≤1 条说明、3–8 个内容组件；Row 最多 4 列，Grid 最多 4 列。
5. **一次成树**：`createSurface` + `updateComponents`（一次给全）+ `updateDataModel`。
6. **失败修正**：读 `error`/`hint`，改一次，仍失败就退化为纯文本。

## 五、可量化验收

| 指标 | 目标 | 验证方式 |
| --- | --- | --- |
| 面板排版 | 15.5px / 1.75 / 0.04em；标题 18px；说明 13px | 浏览器 computed style 断言 |
| 层次对比 | 画布/面板/字段三层背景均可区分（ΔL ≥ 1.1） | 计算样式 + 截图 |
| 圆角 | 面板 18 / 字段 12 / 按钮 12 或胶囊 | 计算样式 |
| 组件数 | v2 catalog = 12（新增 List、Grid） | catalog 单测 + `/api/runtime/capabilities` |
| 协议兼容 | v1 消息与既有 fixture 仍可渲染 | 既有 A2UI 测试全绿 |
| 安全 | HTML/JS、未知组件、非法动作仍被拒绝 | 既有安全测试 + 新增 schema 测试 |
| 三场景 | Dashboard / Form / Workbench 各浅色+深色、1280+375 截图共 12 张 | Playwright 截图 + 交互断言 |
| 响应式 | 375px 无横向滚动；Grid 在窄屏降为 1 列 | 截图 + `scrollWidth` 断言 |
| 交互 | 表单提交回传一次、List/Grid 渲染无重复节点、Chart 成功初始化 | Playwright 交互 + 控制台 0 错误 |
| 工程 | `tsc`、`npm test`、`npm run build` 通过 | 命令输出 |

## 六、交付物

1. `shared/a2ui-catalog.ts`：`List`、`Grid` schema；`parent` 关系扩展。
2. `web/components/a2ui/catalog.tsx`：两个渲染器 + 注册。
3. `web/components/a2ui/style.css` / `web/styles.css`：Tokens、面板/字段/按钮/列表/网格样式、响应式。
4. `server/a2ui-tool.ts`：描述加入布局配方、组件预算与 List/Grid。
5. 测试：catalog schema、组件数、渲染器注册、场景截图与交互。
6. 文档：`docs/a2ui-catalog.md`、`docs/a2ui-agent.md` 同步组件与流程。
7. 证据：`.issue/2026-11-12/evidence-a2ui/`（12 张截图 + 断言输出）。

## 七、不做的部分

- 不引入新的前端框架/样式框架，不重写现有聊天与设置界面。
- 不做 token 级流式 A2UI（工具调用原子返回）。
- 不做任意自定义组件注册（模型只能使用内置白名单）。
- 不做 `Card` 嵌套与任意 CSS/布局表达式（安全性优先）。
