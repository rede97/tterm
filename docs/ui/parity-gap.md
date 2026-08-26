# UI draft ↔ app parity gap

对照标准：**100% 与设计稿同显示、同交互**。

- Drafts: `docs/*-preview.html`、`docs/index.html` UX log、`docs/ui/tokens.css`
- App: `feat/ui-redesign-migration`（含 `edca2f7` 迁移）
- 审计日期：2026-08-26

**结论一句话：** Quick panel 的 CSS 骨架已进 `styles.css`，但 bolt / Esc / Copy / Forward 分组等交互与状态反馈仍和稿不一致；其它面最大漏项是菜单 hover、终端 New Tab、Palette 命令与 Port Forward 对话框、Settings 原生 select + skin swatch + 按钮字重宽。

---

## A. Quick panel — 仍未对齐（优先）

| # | 漏项 | 设计稿 | 当前实现 |
|---|------|--------|----------|
| **Q1** | **闪电按钮默认色** | 默认 **白**；Sharing 时才变蓝 bolt；**只有断开显示红点** | 默认就一直 `--tt-bolt` 蓝；shared 状态同色，看不出「分享变色」 |
| **Q2** | **Esc** | Esc **只关下拉**，面板保持开着 | Esc **直接关整个 panel** |
| **Q3** | **Copy 反馈** | 按钮文案 → `Copied`（约 900ms）再回 `Copy` | Toast「Share link copied」，按钮文案不变 |
| **Q4** | **Port Forward 分组色** | Local 固定 `#4da6ff`；标题 sentence case、无 uppercase tracking | Local 用 `--tt-accent`（Cursor 皮肤下变白）；标题 **UPPERCASE + letter-spacing** |
| **Q5** | **皮肤/毛玻璃预览方式** | 侧栏即时切 skin / glass，骨架不跳 | 走 Settings Apply（`chromeSkin` / `quickPanelGlass`）；面板内不能像稿一样当场对比 |
| **Q6** | **下拉选中底** | `--qp-accent-fill`（Cursor 为白洗选中） | 已映射 `--tt-selected`，大体接近；需肉眼确认 Cursor/VS Code 两套是否与稿同帧 |
| **Q7** | **Select 键盘高亮** | 稿主要是点击 | App 有 Arrow/Enter + `.active`（能力更强）；若与稿「纯点击」严格一致，属于**有意增强**，不算漏显示，但交互不完全相同 |

**已对齐（勿再当漏项）：**  
wells / pills / custom select DOM+CSS / share reveal / glass blur / CONNECTED绿≠Share teal / LED / switch 尺寸与动画 / 控件列宽 148×28 / 字重 500 等——主体 CSS 已在。

---

## B. Tab bar / 菜单

| # | 漏项 | 设计稿 | 当前实现 |
|---|------|--------|----------|
| **T1** | **菜单 / Profiles hover** | `--tab-active`（中性 tab 灰，**非主题蓝**） | `--tt-selected`（VS Code 皮肤 hover 变蓝） |
| **T2** | **终端右键末项** | **只有 Duplicate Tab**（不要 New） | 仍有 **New Tab + Duplicate Tab** |
| **T3** | **Profiles 字体** | 整菜单 `var(--mono)` | UI 无衬线，非 mono |
| **T4** | **颜色预览芯片** | 12×12 圆；无色时空心斜线 hatch | 短条；无色时 **隐藏**（无 empty 态） |
| **T5** | Profiles 圆角/阴影/列宽 | 半径 6、阴影更重、列 min≈200 | 半径 4、阴影更轻、min 170 |
| **T6** | Tab 宽约束 | max 180 / min 108 | max 200 / min 120 |

关 tab 确认条、Duplicate 首项、无 Port Forward、overflow `+N` —— 已对齐。

---

## C. Command palette

| # | 漏项 | 设计稿 | 当前实现 |
|---|------|--------|----------|
| **P1** | **命令清单** | Share start/stop 分项；Add Local / Remote / Dynamic；Remove all；SSH auto-reconnect；Duplicate Tab；Close Window… | 单条 Share toggle；一条 **Port Forwarding…**；缺 Duplicate / Close Window / auto-reconnect 等 |
| **P2** | **Port Forward 交互** | **同 overlay 二级流程**（笔记：不另开窗） | `showPortForwardingDialog` **独立对话框** |
| **P3** | **滚动条/分组视觉** | 自定义细滚动条 + Window/Tab/View… 分组标题 | 复用 tab-switcher 壳；无稿同款 `pal-sb`；分组靠命令 title 前缀而非稿的 group 标签 |

New Tab → Local/SSH/Serial、临时 SSH host→password、Serial 二级、Ctrl+P 打 `>` 翻转 —— **已有**。

---

## D. Settings

| # | 漏项 | 设计稿 | 当前实现 |
|---|------|--------|----------|
| **S1** | **下拉控件** | 「与 quickpanel **同族**自定义 select，不用系统菜单」 | General / Profile / Serial 仍是 **原生 `<select class="settings-select">`** |
| **S2** | **Skin 卡片** | 对角 `skin-swatch` 色块预览 | 仅 title + desc，**无 swatch** |
| **S3** | **按钮宽 / 标题字重** | `--set-btn-width: 148px`、`--set-title-weight` 贯穿标题与实心按钮 | token 有 `--tt-btn-width` / `--tt-title-weight`，多数 `.settings-btn` / 标题 **未吃到**（仍散落 600） |

Serial 画廊、Theme editor、Keyboard 含 Ctrl+P / Ctrl+Shift+P、Apply 一次写 SSH —— 功能侧基本已有。

---

## E. 汇总

| 面 | Blocker（必须改才算一样） | 次要视觉 |
|----|---------------------------|----------|
| Quick panel | **Q1–Q5** | Q6–Q7 |
| Tab / 菜单 | **T1–T2** | T3–T6 |
| Palette | **P1–P2** | P3 |
| Settings | **S1–S3** | — |

### 建议收口顺序

1. Quick：Q1–Q4  
2. Tab：T1–T2  
3. Settings：S1–S3  
4. Palette：P1–P2（命令清单 + Port Forward 改为同 overlay）
