# UI/UX 操作入口树 + 回归测试计划

对照 [`uiux-principles.md`](../uiux-principles.md)（UX-02 可见路径、UX-04 同一动作同一结果、UX-07 键盘一等）。  
命令 id / 默认绑定 SSOT：[`src/core/commands.ts`](../../src/core/commands.ts)。  
金字塔与跑法：[`docs/testing.md`](../testing.md)。

**覆盖标记**

| 标记 | 含义 |
|------|------|
| **L2** | Vitest + happy-dom（`tests/*.test.ts`） |
| **L3** | 真实窗口 e2e（`e2e/specs/*.e2e.js`） |
| **M** | 必须人手（IME/TSF、托盘、真 SSH/串口、视觉毛玻璃） |
| **GAP** | 行为入口存在，自动化未钉住 |

状态（2026-08-27 晚）：人手 §11.1 已确认。L2 全量已跑；L3 补 `settings` / palette 会话过滤 / `find` / `tabmenu`。设计稿 HTML 在 [`drafts/`](../../drafts/)，与本文 markdown 分目录。

---

## 0. 横切不变量（先验这些）

- 同一动作多入口（按钮 / 右键 / 快捷键 / palette）走同一 handler — UX-04
- Chrome 浮层互斥：tab 右键、终端右键、profile ▾、最近文件夹、下拉、Quick Panel、**Ctrl+P / Ctrl+Shift+P** 不能叠开 — `tests/chrome-popups.test.ts` **L2**
- 下拉 `position:fixed` + portal `<body>`（glass 含块不吞菜单）— `tests/select.test.ts` **L2**；QP 溢出不挤 148 列 — `tests/overlay-scroll.test.ts` **L2** + `e2e/specs/q8b.e2e.js` **L3**
- Frosted overlays：`overlayGlass` → `body.tt-glass` → `--tt-glass-*`（菜单 / `.tt-select-menu` / QP）。Settings 触发器保持实心。**L2** store 迁移 + Appearance 开关；视觉 **M**
- Chrome 中文：Settings / QP / kit 走 `--tt-ui`（Inter → Segoe → YaHei）；tab / profile ▾ / palette 行走 `--tt-mono`（JetBrains → Consolas → Noto SC/JP/KR → YaHei，**不能**先落到泛 `monospace`=SimSun）。栈 **L2** `tests/fontconfig.test.ts`；字形 **M**（happy-dom / e2e 都不渲染真实字体）
- `#tab-bar` 32px、容器 2px padding、IME CSS 与 `FADE_MS` — 布局 **GAP**（fit 间接 **L2** hysteresis）；IME **M**
- Apply vs 即时：chromeSkin / overlayGlass 即时；SSH `~/.ssh/config` 与多数 Settings 行走 Apply — **L2** settings-\*

---

## 1. 窗口 chrome

```
窗口
├── 标题栏拖动区（非按钮）                    L2 windowdrag
├── #settings-btn 齿轮 → Settings 伪标签      L2 settingsshell / settings-revert
│                                             L3 settings.e2e（齿轮 + Ctrl+,）
├── #quick-actions 闪电图标 → Quick Panel     L2 quickpanel  L3 quickpanel
├── #btn-park-tray 停到托盘                   GAP（IPC tray_park_window）M 托盘
├── #btn-minimize / #btn-maximize             GAP
├── #btn-close → window-close-requested       L2 confirm（对话框壳）
│   └── 关窗确认（confirmCloseWindow）         L2 confirm；接线 wiring GAP
└── 系统托盘菜单
    ├── Restore window
    ├── 每窗口条目
    └── Quit TTerm                            M（原生菜单）L0 tray.rs 部分
```

快捷键：`tterm.closeWindow`、`tterm.newWindow`（`ctrl+shift+n`）— keymap **L2** 分发；真开窗 **L3 GAP**。

---

## 2. 标签栏

```
#tab-bar
├── 标签
│   ├── 单击切换                              L3 app.e2e（含底边点击）
│   ├── 拖拽排序 SortableJS                   L3 app.e2e
│   ├── 悬停 tooltip 全名                     L3 app.e2e
│   ├── OSC 9;4 进度条                        L2 osc  L3 app.e2e demo
│   ├── 选中 pill（Cursor skin）/ 填满（VS Code） M + tokens；自动化 GAP
│   ├── × 关闭
│   │   ├── confirmCloseTab → 扩大确认 X      L2 closetab
│   │   └── Shift+× 跳过确认                  L2 closetab
│   └── 右键 → 标签上下文菜单（§3）
├── 溢出滚动 + #tab-overflow-count            L2 tabstrip  L3 app.e2e 钉住 + ▾
├── #new-tab +
│   ├── 单击 → 默认本地 profile               L3 app.e2e
│   ├── Shift+单击 → 选文件夹开壳              L2 dirmenu（pick IPC mock）
│   └── 右键 → 最近文件夹菜单
│       ├── Browse…
│       ├── 最近项
│       └── Clear history                     L2 dirmenu
└── #new-tab-menu-btn ▾ → profile 菜单
    ├── Local（隐藏项不出现；DEV: Demo/Anime） L2 profilemenu  L3 anime
    │   └── CJK 名（命令提示符）               栈 L2 fontconfig；字形 M（对照 Settings 下拉）
    ├── SSH hosts                             L2 profilemenu
    └── Serial 端口                           L2 profilemenu
```

Go to Tab：`ctrl+p` — **L2** tabswitcher **L3** shortcuts。  
Ctrl+Tab / Ctrl+Shift+Tab MRU — **L3** shortcuts。  
关闭当前：`ctrl+w` — **L3** shortcuts。

---

## 3. 上下文菜单（chrome popup）

### 3.1 标签右键

Duplicate Tab · Open in New Window · Change Tab Color（色板 / Reset）· Rename · Share with AI | Copy Share Link | Stop Sharing · Close · Close Right · Close Others

- 渲染 / 键盘模型 / 放置：**L2** `contextmenu.test.ts`
- Duplicate / Rename / 颜色 / 新窗口：**L2** 菜单项存在；动作效果 **GAP**
- Close Right / Close Others：**L3** tabmenu.e2e
- Share 三态：**L2** 可见性部分；真分享 **L3** share / quickpanel

### 3.2 终端右键

Copy · Copy as HTML · Paste · Clear · Find · Export Text · Open in New Window · Duplicate Tab

- **L2** contextmenu（项 + 键盘）
- Copy/Paste 真剪贴板 **L3** clipboard.e2e
- Shift+右键 Clear **L3** app.e2e
- Shift+右键 Find：**L2** search.test.ts；**L3** find.e2e
- Export / Copy as HTML **GAP**

键盘：↑↓ Enter Esc · 颜色子菜单 ← → — **L2** menukeys + contextmenu。

---

## 4. Command Palette / Quick Open

入口：`ctrl+shift+p`（Show Palette，Settings 可绑，不在 palette 分组列表）· `>` 从 Go to Tab 翻入。

```
Palette（KEY_COMMANDS.group 且 commandListed）
├── Tab
│   ├── New Local Tab          ctrl+t     二级：本地 profile 列表
│   ├── New SSH Tab                       二级：~/.ssh/config hosts
│   ├── New Serial Tab                    二级：COM 口
│   ├── New SSH Temporary Tab             二级：user@host + MRU（ssh-history）
│   ├── Duplicate Tab
│   ├── Close Tab              ctrl+w
│   └── Go to Tab…             ctrl+p     实际是 quick-open，不在 > 列表
├── View
│   ├── Toggle Quick Panel
│   ├── Toggle Full Screen     F11
│   ├── Toggle Zen Mode        Shift+F11
│   └── Open Settings          ctrl+,
├── Share     when unshared / shared
│   ├── Share with AI
│   └── Stop Sharing
├── SSH       when ssh / ssh-embedded
│   ├── Port Forwarding…       二级：一行 spec（L|R|D）
│   ├── Toggle Auto-reconnect
│   └── Clear SSH Temporary History
├── Serial    when serial
│   ├── Set Profile / Baud / Flow / Input mode（二级列表）
│   ├── Disconnect / Reconnect
│   └── Toggle Auto-reconnect
├── Terminal: Clear
└── Window: New Window / Close Window
```

Settings → Keyboard **仍列出**无 `group` 的命令：Show Palette、Next/Prev Tab、New Tab (default profile)、Add Local/Remote/Dynamic Forward、Remove All Forwards。

Footer：`↑↓` Select · `↵` Open/Connect/Add · `⇥` Complete · `Del` Remove。

- 根列表、会话过滤、二级、port-forward spec：**L2** palette / keymap / forwardspec / ssh-history
- 开 palette + New Local Tab、空 Backspace 回 tabs、本地 tab 隐藏 Port Forward/Baud：**L3** palette.e2e
- F11 / Zen / Ctrl+P / Ctrl+Tab / Ctrl+W：**L3** shortcuts
- Open Settings：**L3** settings.e2e（齿轮 / Ctrl+,）；palette 入口 **L3 GAP**
- Quick Panel / Share / Serial 二级 / Temp SSH：**L3 GAP**

---

## 5. Quick Panel

`#quick-actions` 或 `tterm.toggleQuickPanel`。Settings 打开时按钮禁用。

```
Quick Panel（qpPanelView）
├── 头：标题 / 元信息 / CONNECTED|DISCONNECTED 胶囊
├── AI Share（所有会话）
│   ├── Share this session
│   └── URL + Copy
├── Session（SSH）
│   └── Auto-reconnect
├── Port forwards（仅 embedded SSH）
│   └── createForwardTable（+ Local/Remote/Dynamic、删行）
└── Serial
    ├── Session：Auto-reconnect、Disconnect|Reconnect、Profile、Baud、Frame
    ├── I/O：Input mode、Enter sends、Output newlines
    └── Modem lines：Flow、RTS/DTR、CTS/DSR LED
```

- 本地 / SSH / Serial DOM 与动作：**L2** quickpanel / qp-view-parity / serialctl / forwardtable
- 开面板、Share 真链、Serial 选择、禁用：**L3** quickpanel.e2e
- 毛玻璃 **M**；QP 开时其它 chrome 关掉 **L2** chrome-popups

---

## 6. Settings（伪标签，Apply / Revert）

入口：齿轮 · `ctrl+,` · palette Open Settings。Suspend 保 DOM。

```
Settings
├── General
│   ├── About → Homepage
│   ├── Updates：自动检查、Check for Updates
│   ├── Terminal：Renderer、Scrollback、Bell
│   ├── Paste：多行警告、Trim
│   ├── Closing：关标签确认、关窗确认
│   └── Data：Open Directory、Reset All
├── Appearance          chromeSkin / overlayGlass 即时，其余 Apply
│   ├── Chrome Skin：Cursor Mono / VS Code Dark
│   ├── Frosted overlays
│   ├── Font Family → Configure（font picker 拖拽排序）
│   ├── Font Size
│   └── Color Scheme 卡片：选中、Duplicate、Edit（custom）、+ New Theme
├── Profile
│   ├── Default Profile 下拉
│   └── WT 导入列表（左 checkbox 可见性）
├── SSH                 Apply 同时写 ~/.ssh/config
│   ├── Built-in SSH client
│   ├── Hosts：+ Add、Reload、Open File
│   │   └── 行：checkbox、Edit、⋯ Clear KnownHosts / Upload Key、Delete
│   └── Keys：+ Generate（Name/Algo/Passphrase）
├── Serial
│   ├── Default baud / Default Frame
│   └── Profiles 卡片：设默认、Duplicate/Edit、+ New
│       └── 编辑器：Name、Enter、output NL、flow、Delete 确认
└── Keyboard
    └── 搜索 + 点击 chip 重绑（冲突检测）直到 Apply
```

- 面板可见性 / Revert / dirty footer：**L2** settings-revert
- General 更新：**L2** settings-updates
- Appearance 画廊 / 字体拖拽：**L2** settings-theme **L3** theme / fontdrag；**皮肤 + 毛玻璃开关 L2 今日补**
- Profile / SSH / Serial / Keyboard：**L2** 对应 settings-\* / shortcutspanel
- Settings 整页 e2e（Apply 写盘、SSH 写 config）：**L3 GAP**
- Reset All / Open Directory：**GAP**（危险，保持 L2 mock）

---

## 7. 会话内模态 / 终端附属

```
确认壳（kit/shell confirm）
├── 关窗 / 删主题 / 删串口 profile / 更新安装     L2 confirm / modal
└── 多行粘贴确认                                 L2 paste  L3 clipboard 部分

SSH 认证（必须应答一次）
├── 密码/口令：嵌入式会话走终端无回显；否则 modal  L2 sshauth
└── Host key TOFU / mismatch modal               L2 sshauth
    真 SSH 握手                                  M / L3 GAP

Find 条：输入、上/下一个、关                      L2 search  L3 find.e2e

Tab 内联 Rename                                  GAP

Dead-mode：红字 + Enter 重生；exit 0 关标签       L0 deadmode  L3 app.e2e

链接：自动 URL / OSC 8                            L2 links  L3 links.e2e
```

---

## 8. 终端输入与渲染（非 chrome，回归必带）

| 面 | 覆盖 |
|----|------|
| IME / 候选窗锚定 | **M** `docs/backlog.md`；合成 **L2** imebox/imefreeze/imefilter；**L3** ime.e2e 不替代真人 |
| 粘贴 trim / 警告 | **L2** paste |
| 串口换行 / MOCK-LOOP | **L2** serialinput **L3** app.e2e |
| 横向 drift / 滚动 | **L3** scrolldrift |
| omp 字节流 | **L2** omp-stream **L3** ompfreeze |
| Anime TTY | **L3** anime |
| 分享 HTTP | **L2** sharecontrol/sharelines **L3** share.e2e |
| PTY 尺寸 / SSH fit | **L2** ssh-size hysteresis **L0** pty |

---

## 9. 要不要重跑

CJK `--tt-mono` / `--tt-ui` 只改字体回退顺序，不改 DOM、IPC、布局数字。

| 层 | 结论 | 原因 |
|----|------|------|
| L0 `bun run test:rust` | **不必** | 无 Rust 改动 |
| L2 `bun run test` | **已补跑**（2026-08-27 晚） | 新契约在 `tests/fontconfig.test.ts`；60 files / **523** tests |
| L3 UI 五件套 `app` · `shortcuts` · `palette` · `quickpanel` · `q8b` | **不必重跑** | 今早已绿（30 tests）。断言的是 tab 108–180、QP Frame、互斥 DOM。字体栈不会动这些 |
| L3 `theme` · `fontdrag` · `clipboard` | **与 CJK 无关**；1420 空闲时可选 | 早上清单剩的，不是字体回归 |
| L3 钉 `getComputedStyle(…).fontFamily` | **不要加** | 本机有无 Noto / YaHei 会让断言飘；字形只能人手看 |

改 tokens 注释或再加 CSS 回退时：只重跑 `bun run test tests/fontconfig.test.ts`（秒级）。只有再动 tab 宽、QP 行、palette 列表、互斥打开逻辑时才重跑对应 L3。

---

## 10. 还需要补充的自动化（GAP，不要假装已覆盖）

**不要补：** CJK 计算字体、pill 截图、毛玻璃像素。那些是 §11 人手。

**本轮已补 L3：** 齿轮 / Ctrl+, → Settings；本地 palette 无 Port Forward / Baud；Find 条；Close Right / Close Others。

**仍 GAP：**

| 入口 | 建议 | 为什么还空 |
|------|------|------------|
| 关窗确认接线 | L2：`confirmCloseWindow` + mock `window-close-requested` | 对话框壳已有；wiring 未钉 |
| palette Open Settings 命令 | e2e 从 palette 搜 Open Settings | 齿轮 / Ctrl+, 已覆盖同一 handler |

**保持 GAP（自动化成本高或危险）：** Park / 托盘 / 多窗口、Export / Copy as HTML、Settings Apply 写盘 + SSH 写 `~/.ssh/config`、Reset All、真 SSH 握手。托盘有少量 **L0** `tray.rs`。

---

## 11. 必须人手（自动化替不了）

### 11.1 本轮 UI（`tauri dev`）— **已确认**（2026-08-27）

CJK（上次改完还没在真窗口验过）：

- Settings → Profile → Default Profile：`命令提示符` 应是 YaHei / Segoe 链路（此前已符合预期）。
- 标签栏 **▾ Local** 同一项：应接近 Settings，**不是**细宋体 SimSun。
- 若标签标题含中文：tab 胶囊同样走 `--tt-mono` 回退，不应 SimSun。

视觉 / 互斥（L2 只钉 DOM，不钉观感）：

- Settings → Appearance → Frosted overlays：tab/终端右键、▾、`.tt-select` 菜单、Quick Panel 同一层雾；Settings 行控件仍实心。
- 右键与 QP / 下拉不能叠；Ctrl+P 与 Ctrl+Shift+P 不能叠（多级 palette 仍一个 `.pal-overlay`）。
- Cursor 皮肤：选中 tab 为 inset 圆角 pill，不是整格填满。VS Code 皮肤仍是深色填满。
- Ctrl+Shift+P：本地 tab 无 Serial / Port Forward 行；键盘设置里这些命令仍在。

### 11.2 不进本轮关门

- **IME / TSF**：`docs/backlog.md` 专项清单（微软拼音 + Agent TUI）。`ime.e2e` / Vitest 合成事件不替代。
- 托盘停靠、真 SSH 密码/host key、真串口 Modem 线、多窗口 `ctrl+shift+n`。

---

## 12. 执行清单

```
[x] bun run test                          # L1/L2 — 晨 516 → 晚 523（含 chrome CJK 栈）
[x] L3 UI 规格 — 晨 5 files / 30 tests
      app · shortcuts · palette · quickpanel · q8b
[x] 人手 §11.1（tauri dev）               # CJK 字形 + 毛玻璃 + 互斥 + pill + palette 过滤
[x] L3 补测 — settings · palette 过滤 · find · tabmenu
[ ] 可选 L3（1420 空闲，非本轮）：
      bun run test:e2e -- --spec e2e/specs/theme.e2e.js
      bun run test:e2e -- --spec e2e/specs/fontdrag.e2e.js
      bun run test:e2e -- --spec e2e/specs/clipboard.e2e.js
```

IME 真人清单**不**算本轮关门条件。
