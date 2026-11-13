# 正文排版与内容强调色（B 方案）

日期：2026-11-12。来源：用户提供的 TUI 截图 `.issue/2026-11-12/image-3.png` 与反馈「字之间间隙非常短，阅读吃力」。先做了 base / A / B 三版对比实验，用户选择按推荐落地 B。

## 决策

- **强调预算**：一个暖色 `--entity`（深色 `#f5a742`，浅色 `#a86412`）用于内容实体——行内代码/标识符、列表序号；链接改用交互蓝 `--accent`（深色 `#8ab4f8`，浅色 `#2563eb`）。蓝色表示“可点/系统”，暖色表示“内容实体”，两种语义不混。
- 备选（已截图，未采用）：全部用暖色（`color-1-single.png`）；链接蓝 + 有序序号改灰（`color-3-numbers-muted.png`）。序号改灰更安静，但列表结构变弱，所以保留暖色序号。
- **去掉行内代码底色**：`.prose .inline-code` 改为透明背景、无左右内边距，保留等宽字体；代码块与表格不受影响，`.inline-code` 在正文以外的位置（工具详情等）仍保留胶囊。
- **加粗层级**：`.prose strong` 550 → 600，让关键句能跳出来。

## 排版数值（改动前后）

| 项目 | 之前 | 现在 |
| --- | --- | --- |
| 正文字号 | 15px | 16px |
| 行高 | 1.85（27.75px） | 2.0（32px） |
| 字距 | 默认（0） | `0.07em`（1.12px） |
| 行内代码 / 链接字距 | 同上 | `0.02em`（0.2752 / 0.32px） |
| 段间距 | 18px | 22px |
| 列表项间距 | 5px | 8px |
| 用户气泡 | 15px / 无字距 | 16px / 1.8 / `0.07em` |
| 行内代码 | `#303030` 胶囊 + 正文色 | 透明底 + 暖色 |
| 链接 | 仅下划线、正文色 | 交互蓝 + 下划线 |
| 有序列表序号 | 正文色 | 暖色 |

字距经过三轮：`0.03em`（0.465px）→ `0.045em`（0.6975px）→ `0.07em`（1.12px）。用户两次反馈“仍然紧挨着”，最终把正文字距拉到 0.07em，并让行内代码/链接保持 `0.02em`——宽字距只服务于中文正文，拉丁标识符和路径不应被拆散。对比台阶（15.5px 下）：0.02em=0.31px、0.03em=0.465px、0.045em=0.6975px、0.06em=0.93px。截图 `tracking-0.02/0.03/0.045/0.06.png`：0.06 对拉丁词（URL、`INVALID_MESSAGE`）已经开始散，0.045 是中文够松、英文还成词的上限区间；再往上应该改用更大的行高而不是继续加字距。

## 字体栈

```
Inter, "Segoe UI", "Noto Sans", system-ui, "Noto Sans CJK SC",
"PingFang SC", "Hiragino Sans GB", "Source Han Sans SC",
"Microsoft YaHei", sans-serif
```

原因是原来的栈在 Linux 上拉丁字符落到 Liberation Sans、中文落到 Noto Sans CJK SC，两种字的字面大小和字重观感不一致，会放大「挤」的感觉。现在 Linux 用 Noto Sans（拉丁）+ Noto Sans CJK SC（中文）配对；macOS 走 system-ui / PingFang；Windows 走 Segoe UI / 雅黑。

## 对比度

- `#f5a742` on `#1a1a1a`：8.4:1
- `#a86412` on `#ffffff`：4.7:1（AA 正文达标）
- 行内代码去掉底色后不再有 1.32:1 的块状对比，行文连续。

## 验证

- `npm run build` 通过；`npm test` 501 项（500 通过 / 1 既有跳过 / 0 失败）。
- 用构建产物 CSS 渲染同一段技术长回答，实测计算样式：15.5px / 30.23px / 0.465px / 行内代码 `rgb(245,167,66)` 且透明背景 / 序号与链接同色 / strong 600 / 段距 20px。
- 真实页面（隔离 fixture）：用户气泡 15.5px + 0.465px、侧栏与导航布局不变、无横向溢出、控制台 0 错误。
- 公网已切到 `index-CUdvL9G8.css`，实测正文 `16px / 32px / 1.12px`，行内代码 0.2752px、链接 0.32px。
- 截图：`evidence-compare/scale-current-1x.png`、`scale-current-2x.png`（当前版本，1x 为真实像素尺寸）、`dark-base.png`、`dark-final.png`、`dark-final2.png`、`light-base.png`、`light-final.png`、`shell-dark.png`、`shell-light.png`（`dark-A/dark-B` 为实验阶段的 A/B 版本，保留作对照）。

## 边界

- 字距只作用于正文与用户气泡；侧栏、设置、按钮等 UI 文案仍为默认字距，避免整体变松。
- 链接改蓝后与 `--accent` 的其它用途（等待态、焦点环）同色，属于同一语义族；若后续觉得蓝色在正文里太跳，可回落为暖色（`color-1-single.png`）。
- 行内代码去底色后「这是代码」的线索只剩等宽字体；若后续觉得不够，可加回 `var(--hover)` 级别的极弱底色（实验中的 C 方案）。
- 字体栈依赖系统字体：没有 Noto Sans 的环境仍会回落到系统默认，但 CJK 部分会命中 Noto Sans CJK SC 或 PingFang。
