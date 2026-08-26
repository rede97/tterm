# UI draft ↔ app parity gap

对照标准：

1. **显示与交互 100% 对齐**设计稿（`docs/*-preview.html` + `docs/ui/tokens.css`）。
2. **Settings：布局与按钮严格 1:1**（row wells、间距、按钮宽 148px / 主次样式 / 落位、卡片与磁贴形态）。不得「语义接近即可」。
3. **可见性列表用左侧 checkbox**（已定案，不用 toggle）。

- App：`feat/ui-redesign-migration`
- 审计：2026-08-26（Q8、Settings 全面板复审）

**结论一句话：** **CLOSED（2026-08-26 同日收口）** — Q8、S4–S12 全部落地并过实机截图验收。Profile/SSH 可见性已回左侧 checkbox（L3）；Settings layout/按钮 1:1（L1/L2）完成；关窗确认已进 src（confirmCloseWindow 默认 on）。

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
| **Q8** | 下拉 `fixed` 悬浮；panel 滚动条 overlay，不挤横向布局 | **DONE**（fixed + portal body；glass 兼容；overlay 滚动条） |

稿：`docs/quickpanel-preview.html`（`placeSelectMenu` + overlay）。实现：`absolute` + `overflow:auto` → 打开 Flow 等下拉挤出经典滚动条。

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
| 下拉 | 与 QP 同族自定义 select（随 **Q8** fixed 悬浮） | Settings 里再退回 native（modal 内亦尽量同族） |

---

## E. 汇总与顺序

| 面 | 开放 |
|----|------|
| Quick panel | **Q8** |
| Settings | **S4–S11**；layout/按钮严格 1:1 |
| Confirm | 关窗确认待落地；粘贴已有 |

### 建议实现序

1. **S8** shell header + **row wells**（全面板受益）  
2. **S9 / S11** 实心与 modal 按钮 **148**  
3. **S4** Profile（+ SSH 可见性）→ **checkbox / check-row**  
4. **S5** SSH 分区、工具条、host 行、字段序  
5. **S6 / S7** `.theme-new` 磁贴；Appearance/Serial 余量  
6. **Q8** select fixed + overlay 滚动条  
7. **Confirm**：关窗确认（有 tab）+ Settings `confirmCloseWindow`；粘贴确认已在 `paste.ts`，对齐 [`confirm-preview.html`](../confirm-preview.html)

### Confirm dialogs（已落地）

| 场景 | 状态 |
|------|------|
| 多行粘贴 | **DONE** — cf 壳 + 行数 + 前 8 行 preview + 风险 meta |
| 关窗（有活动 tab） | **DONE** — 后端 `CloseRequested` 拦截 → 前端 cf 模态（danger）；X 按钮 / Alt+F4 / 任务栏同路径；Cancel 不关闭 |

实机验收：X 点击弹出 warn 模态、文案含 tab 数、Cancel 保窗；截图对齐 `confirm-preview.html`。
### ����

- ���� `docs/settings-preview.html` ����岢�Ž�ͼ���иߡ�well����ť����������checkbox ��Ե���롣
- ���⡸Show in new-tab menu�������ٳ��� switch��
- �ش����� tab �� ȷ�ϣ��� tab / ���� off �� ֱ�ӹء�
