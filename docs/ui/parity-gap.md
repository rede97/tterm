# UI draft ↔ app parity gap

对照标准：**100% 与设计稿同显示、同交互**。

- Drafts: `docs/*-preview.html`、`docs/index.html` UX log、`docs/ui/tokens.css`
- App: `feat/ui-redesign-migration`（`edca2f7` 迁移 → `ed6a827` QP 1:1 → `5110486` parity 收口）
- 审计 / 复核：2026-08-26

**结论一句话：** **CLOSED** — `5110486` 收口全部 blocker；T4 chip 显示回归与 `.tab` 注释 nit 已于复核当日修掉（`colorPreview` 初始 `display:none` 移除 + 宽注释 108–180）。仅余 OK\* 有意增强（Q5 即时生效、Q7 键盘导航）。

---

## Status legend

| 标记 | 含义 |
|------|------|
| **DONE** | 已与设计稿对齐 |
| **BUG** | 代码意图对齐，但有回归/漏线 |
| **OK\*** | 有意偏离（增强或产品模型），可接受 |

---

## A. Quick panel

| # | 项 | 状态 | 备注 |
|---|----|------|------|
| **Q1** | 闪电默认中性色；Sharing → 蓝 bolt；仅断开红点 | **DONE** | `#quick-status` → `--tt-chrome-text`；`[data-state=shared]` → `--tt-bolt` |
| **Q2** | Esc 只关下拉，面板保持开 | **DONE** | `closeAllSelects()`；关面板靠空白 / bolt |
| **Q3** | Copy → `Copied` ~900ms | **DONE** | 就地改按钮文案 |
| **Q4** | Forward Local `#4da6ff`；sentence-case 标题 | **DONE** | 固定三色；无 uppercase tracking |
| **Q5** | Skin / glass 即时生效 | **OK\*** | 走 `configStore.set` 即时（UX-05），不经 Apply — 比稿的「侧栏 demo」更符合产品 |
| **Q6** | 下拉选中底 | **DONE** | `--tt-selected`（= 稿 `--qp-accent-fill`） |
| **Q7** | Select 键盘 | **OK\*** | Arrow/Enter + `.active` 保留为增强 |

主体 wells / pills / custom select / share reveal / glass / CONNECTED≠Share / LED / switch / 148×28 / weight 500 —— 已在。

---

## B. Tab bar / 菜单

| # | 项 | 状态 | 备注 |
|---|----|------|------|
| **T1** | 菜单 / Profiles hover = tab 灰（非主题蓝） | **DONE** | `--tt-tab-active` |
| **T2** | 终端右键末项仅 Duplicate（无 New Tab） | **DONE** | |
| **T3** | Profiles mono | **DONE** | `font-family: var(--tt-mono)` |
| **T4** | 颜色预览 12×12 圆 + 无色 hatch | **BUG** | CSS + `.empty` 已写；`colorPreview.style.display = "none"` 初始化后打开菜单未清，chip 永不显示。修：`display = ""` |
| **T5** | Profiles 半径 6 / 阴影 / 列 min 200 | **DONE** | |
| **T6** | Tab 宽 108–180 | **DONE** | CSS 已改；`.tab` 注释仍可能写旧 200/120 |

关 tab 确认条、Duplicate 首项、无 Port Forward、overflow `+N` —— 已对齐。

---

## C. Command palette

| # | 项 | 状态 | 备注 |
|---|----|------|------|
| **P1** | 命令清单扩展 | **DONE** | Share Start/Stop、Duplicate、Close Window、SSH auto-reconnect、Add L/R/D Forward、Remove All |
| **P2** | Port Forward 同 overlay | **DONE** | 独立 dialog / `forwardeditor` 已删；palette 内 list + 三步添加 |
| **P3** | 滚动条 / 分组 | **DONE** | 细滚动条 + `pal-cat` 分组（共用 tab-switcher 壳，非独立 `pal-sb` 类名） |

New Tab → Local/SSH/Serial、临时 SSH、Serial 二级、`>` 翻转 —— 已有。

---

## D. Settings

| # | 项 | 状态 | 备注 |
|---|----|------|------|
| **S1** | 自定义 select（与 QP 同族） | **DONE** | `ui/select.ts` → general / profile / serial |
| **S2** | Skin 对角 swatch | **DONE** | `.skin-swatch` |
| **S3** | 按钮 148px + title weight | **DONE** | `--tt-btn-width` / `--tt-title-weight`；subsection 标题偶有硬编码 600 |

Serial 画廊、Theme editor、Keyboard Ctrl+P / Ctrl+Shift+P、Apply 写 SSH —— 已有。

---

## E. 汇总（复核后）

| 面 | 开放项 |
|----|--------|
| Quick panel | 无 blocker（Q5/Q7 为 OK\*） |
| Tab / 菜单 | **T4 BUG**；T6 注释 nit |
| Palette | 无 |
| Settings | 无 blocker |

### 下一步

无 — 本文档已于 2026-08-26 复核关闭。T4 实际修法：删除创建期的
`colorPreview.style.display = "none"`（`.empty` hatch 类即无色态表达，
无需隐藏）；`tests/contextmenu.test.ts` 新增 chip 可见性回归断言。
