# UI draft ↔ app parity gap

对照标准：

1. **显示与交互 100% 对齐**设计稿（`docs/*-preview.html` + `docs/ui/tokens.css`）。
2. **Settings：布局与按钮严格 1:1**（row wells、间距、按钮宽 148px / 主次样式 / 落位、卡片与磁贴形态）。不得「语义接近即可」。
3. **可见性列表用左侧 checkbox**（已定案，不用 toggle）。

- App：`feat/ui-redesign-migration`
- 审计：2026-08-26（Q8、Settings 全面板复审）

**结论一句话：** **CLOSED（2026-08-26 同日收口）** — Q8a（select fixed+portal）与 **Q8b（真 overlay 浮层滚动条，`ui/overlay-scroll.ts`）** 均落地并过实机验收；Settings L1–L3 / S4–S12、关窗确认、粘贴确认已落地。

---

## Status legend

| 标记 | 含义 |
|------|------|
| **DONE** | 已与设计稿对齐 |
| **OPEN** | 未对齐；Settings 项默认视为 **layout/button blocker** |
| **OK\*** | 有意偏离（须在稿或本文注明） |
| **LOCKED** | 已定案，实现必须遵守 |

---

## A. Quick panel

| # | 项 | 状态 |
|---|----|------|
| **Q1–Q4, Q6** | bolt / Esc / Copy / Forward 色 / 选中底 | **DONE** |
| **Q5 / Q7** | Skin 即时；Select 键盘增强 | **OK\*** |
| **Q8a** | 下拉 `fixed` + portal body，不进 panel `scrollHeight` | **DONE**（`select.ts` placeSelectMenu + portal；glass 兼容） |
| **Q8b** | panel 滚动条 **overlay**，不挤 148 控件列 | **DONE** — 隐藏原生条 + JS 浮层 thumb（`ui/overlay-scroll.ts`，panel 与 Settings 全面板；e2e 验收：溢出时控件列 right 不动、无 classic gutter） |

**Q8b 核查（2026-08-26）：已闭环。** 结论同下表——CSS 无路可走，落地为隐藏原生条 + `ui/overlay-scroll.ts` 浮层 thumb（scroll/ResizeObserver 同步，Revert 全量重建自愈）。`.tt-scroll` 保留给无 148 约束的面（palette 等 classic 可接受处）。

**背景核查（为何 CSS 无解）：**

| 声称 | 实际 |
|------|------|
| `overflow-y: overlay` 浮空不占 gutter | Chromium / WebView2 已移除有效 `overlay`；`@supports (overflow-y: overlay)` 不可靠，多数路径仍是 `overflow-y: auto` |
| `.tt-scroll` / 全局 `::-webkit-scrollbar { width: 8px }` 是 overlay | Chrome 文档：[设 `::-webkit-scrollbar` 的 width/height 会强制 classic scrollbar](https://developer.chrome.com/docs/css-ui/scrollbar-styling)（专用 gutter，内容区变窄） |
| `scrollbar-gutter: auto` | 只表示「不预留空 gutter」；classic 条出现时仍会吃宽度 |

因此：内容本身过高（Serial + modem 等）出现竖条时，**会横向挤布局**。下拉打开不再额外挤条（Q8a），与「条本身不挤」是两件事。

稿侧同风险：`docs/quickpanel-preview.html` 仍写 `overflow-y: overlay` + 注记「须为 overlay」；`docs/ui/scroll.css` 的「floating / no gutter」在 Chromium 上对设了 width 的 webkit 条不成立。
---

## B. Tab / Palette

| # | 状态 |
|---|------|
| **T1–T6** / **P1–P3** | **DONE** |

---

## C. Settings — 定案与总表

### 定案（LOCKED）

| ID | 定案 |
|----|------|
| **L1** | Settings **布局 1:1**：section / row / gallery / modal 结构、间距、对齐与稿一致。 |
| **L2** | Settings **按钮 1:1**：实心次要按钮与 Homepage / Configure / Check for Updates / Copy / toolbar 主按钮共用 **`--tt-btn-width: 148px`**（高约 28）；主按钮 / ghost 样式与落位跟稿。Modal Save/Cancel 同宽。 |
| **L3** | **可见性 = 左侧 checkbox**（`.check-row` + `.check-box`）。Toggle / `.qp-switch` 仅用于单一功能开/关（Built-in SSH、Frosted、Bell…）。 |

### 总表

| # | 项 | 状态 |
|---|----|------|
| **S1–S3** | 自定义 select / skin swatch / 按钮 token 已挂一部分 | **DONE\***（实心 148 与 row well 仍缺 → 见下） |
| **S4** | Profile / SSH host **可见性 → 左侧 checkbox** | **DONE**（`.check-row`/`.check-box` 全套；pending 至 Apply） |
| **S5** | SSH 面板 layout + 按钮 1:1 | **DONE**（Client/Hosts/Keys 分区、toolbar 主+ghost 148、✎/⋯/×、编辑走 modal、字段序 Alias\|User·HostName\|Port、upload/keygen 自定义下拉） |
| **S6** | Appearance 主题 gallery + New Theme 磁贴 1:1 | **DONE**（`.theme-new` 磁贴；gallery 保留 Built-in/Custom 分组 = OK\*，稿扁平与产品分组取舍已定） |
| **S7** | Serial Profile gallery + New Profile 磁贴 + editor 按钮 1:1 | **DONE** |
| **S8** | Shell：panel header、row wells、sidebar/padding | **DONE**（header 随 nav、well 行、侧栏 188、20/24/28、dirty dot） |
| **S9** | 通用实心按钮 148（Homepage / Configure / Updates / Keys Copy…） | **DONE**（`.settings-link-btn.solid`） |
| **S10** | General：Bell / Paste / **Confirm close window** / Data | **DONE**（开关 + 后端 CloseRequested 钩 + cf 模态；`window_request_close` 未确认路径） |
| **S11** | Modal 脚按钮 148（Theme / Serial / Host editor） | **DONE** |
| **S12** | Keyboard | **DONE** |

---

## D. Settings 1:1 审计（复审）

对照：`docs/settings-preview.html` ↔ `src/settings/*` + `src/styles.css` + `src/ui/lit.ts`。

### D0. Shell

| 差异 | 稿 | 实现 | 级别 |
|------|----|------|------|
| 面板标题区 | `.settings-header`（h2 + 描述随 nav 变） | **无** | layout |
| 行容器 | `.row`：well 底 + 边框 + `padding: 10px 12px` | `.settings-item-row`：裸 flex，**无 well** | layout |
| 侧栏宽 | 188px | 200px | polish |
| 内容 padding | `20px 24px 28px` | `24px` | polish |
| section 间距 | 28px | 24px | polish |
| dirty 提示 | 文案 + `.dot` | 仅文案 | polish |
| Apply/Revert | 主 / ghost | 有 `min-width: 148`；样式类名不同，接近 | 按钮 · 接近 |

### D1. General

| 差异 | 稿 | 实现 | 级别 |
|------|----|------|------|
| Homepage | `.homepage-btn` **148×28** 灰实心 | `.settings-link-btn`，**无 148** | 按钮 |
| Check for Updates | `.link-btn.solid` 148 灰 | accent link 风，无固定宽 | 按钮 |
| Scrollback | 窄 input **宽 148** | stepper（±） | layout / 控件 |
| Bell / Paste | 稿注「稍后」stub | **已完整实现** | OK\*（保留；row 须井格化） |
| Data（Open / Reset） | 稿无 | **有** | OK\* 或搬出；若留则跟 row/按钮规范 |

### D2. Appearance（S6）

| 差异 | 稿 | 实现 | 级别 |
|------|----|------|------|
| Frosted / Font / Size 行 | `.row` well | 无 well | layout |
| Configure 字体 | `.link-btn.solid` 148 | `.settings-link-btn` | 按钮 |
| 主题说明文案 | 强调「只改终端，不改 Settings/tab」 | WT 导入说明为主 | copy |
| Gallery 分组 | 稿静态为**扁平** grid | Built-in / Custom **分组标题** | layout（若 1:1 扁平则去分组；或改稿承认分组） |
| **New Theme** | `.theme-new` 磁贴（+ 圆、标题、hint） | `+ New Theme` **link 按钮** | layout |
| Theme Editor 脚 | Save/Cancel **min 148** | `.te-btn` 无 148 | 按钮 |
| Skin 卡 | 有 swatch | **DONE** | — |

### D3. Profile（S4）

| 差异 | 稿 | 实现 | 级别 |
|------|----|------|------|
| 默认 profile 行 | 有 desc + `.set-select` | 无 desc | copy / layout |
| 可见性说明 | 「Checkbox on the left — same as SSH」 | 「Uncheck to hide」（toggle 话术） | copy |
| **可见性控件** | **左 checkbox** + `check-row` / `is-off` | **右 `qp-switch`** + 临时灰底 | **控件 · LOCKED** |
| check-row CSS | 稿完整 `.check-*` | **`styles.css` 无对应** | layout |

### D4. SSH（S5）

| 差异 | 稿 | 实现 | 级别 |
|------|----|------|------|
| 分区标题 | Client / Hosts from ~/.ssh/config / Keys | SSH Configuration / Imported Hosts / SSH Keys | layout / copy |
| Host 工具条 | **主色 + Add Host** + **ghost Reload**，均约 **148** | Add 在 titleEnd；Reload 与 Open File 链在一行 | layout · 按钮 |
| Open File | 稿工具条无 | 有 | layout（可保留但勿破坏工具条 1:1） |
| Host 行 | **左 checkbox** + meta；✎ / **⋯** / × | **左 toggle** + 展开；文案 Edit/Delete | 控件 · layout |
| 编辑交互 | 点 ✎ → **modal**；列表不靠展开承载 Clear/Upload | 行展开出详情；Clear/Upload 在展开区 | layout |
| Host 编辑器字段序 | Alias\|User，HostName\|Port | Alias\|HostName，User\|Port | layout |
| Keys Copy / Generate | 实心 148；Generate 主按钮工具条 | accent Copy；Generate titleEnd | 按钮 · layout |
| Upload/Keygen 下拉 | 自定义 select | **native `<select>`** | 控件 |
| Editor 脚按钮 | min 148 | 无 | 按钮 |

### D5. Serial（S7）

| 差异 | 稿 | 实现 | 级别 |
|------|----|------|------|
| Defaults 行 | `.row` well + select | itemRow，无 well | layout |
| Gallery / 卡片 / 编辑器字段序 | Built-in+Custom、summary、Input→Enter→NL→Flow | **基本一致** | DONE\* |
| **New Profile** | `.theme-new` 磁贴 | `+ New Profile` link 按钮 | layout |
| Editor 脚 | min 148 | 无 | 按钮 |

### D6. Keyboard

结构 / 搜索 / chip 捕获：**大体 DONE**。Hint 文案略长 → copy。

### D7. 控件对照（LOCKED）

| 场景 | 必须用 | 禁止 |
|------|--------|------|
| 多条「是否出现在新标签菜单」 | 左 **checkbox** + `check-row` | 右/左 **toggle** |
| 单一功能开/关 | 右 **toggle**（`.qp-switch`） | — |
| 行尾实心次要 CTA | **148×~28** 灰实心（稿 `.link-btn.solid` / `.homepage-btn`） | 无宽限 accent 链接顶替 |
| 新建 Theme / Profile | **`.theme-new` 磁贴** | 纯文字 `+ New …` link |
| 下拉 | 与 QP 同族自定义 select（随 **Q8a** fixed 悬浮） | Settings 里再退回 native（modal 内亦尽量同族） |

---

## E. 汇总与顺序

| 面 | 开放 |
|----|------|
| Quick panel | **Q8b**（panel overlay 滚动条；Q8a 已 DONE） |
| Settings | 见上表（多数 DONE；以实机为准） |
| Confirm | 粘贴 / 关窗均已落地 |

### 建议实现序

1. **S8** shell header + **row wells**（全面板受益）  
2. **S9 / S11** 实心与 modal 按钮 **148**  
3. **S4** Profile（+ SSH 可见性）→ **checkbox / check-row**  
4. **S5** SSH 分区、工具条、host 行、字段序  
5. **S6 / S7** `.theme-new` 磁贴；Appearance/Serial 余量  
6. **Q8a** select fixed+portal（**DONE**）；**Q8b** panel overlay 滚动条（**OPEN** — webkit `width` → classic gutter）  
7. **Confirm**：关窗确认（有 tab）+ Settings `confirmCloseWindow`；粘贴确认已在 `paste.ts`，对齐 [`confirm-preview.html`](../confirm-preview.html)

### Confirm dialogs（已落地）

| 场景 | 状态 |
|------|------|
| 多行粘贴 | **DONE** — 标题旁 `N lines` header meta + **可编辑**等宽 textarea（`cf-body-flush` 高视区）；无 Security 脚注；确认后粘贴**编辑后**内容 |
| 关窗（有活动 tab） | **DONE** — 后端 `CloseRequested` 拦截 → 前端 cf 模态（danger，无 meta 行）；X 按钮（`window_request_close`）/ Alt+F4 / 任务栏同路径；Cancel 不关闭 |

滚动条统一：`docs/ui/scroll.css` 的 `.tt-scroll` 为草稿事实源；落地 `styles.css` 有对等全局块（Chrome 121+ 不得设 `scrollbar-width/color`，否则带回箭头条）。**注意：** 统一样式 ≠ overlay 不挤布局（见 **Q8b**）。

实机验收：X 点击弹出 warn 模态、Cancel 保窗；粘贴模态可编辑预览与稿一致（截图）。
