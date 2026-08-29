# README 演示分镜

> 状态：**草稿。** 先改本文，再写 e2e / Python / OBS，再开拍。  
> 仓库只收三条 GIF：`docs/images/hero.gif` · `agent.gif` · `share.gif`。没有第四条，也没有 `sessions.gif`。  
> 中英 README 同一套画面，只换文件，不另拍英文版。MP4 母带本地留着，不进 git。单文件尽量 **小于 5 MB**。

本文只定「拍什么、多长、用哪一层驱动」。不写实现路径和机位预设。

---

## 0. 微调入口

已锁定的主张、时长、驱动分层见 §1–§5。**开拍前只需补下面几格**（直接改本文，或按编号回复）。

| # | 项 | 现状 | 请填 |
| --- | --- | --- | --- |
| **Build** | 拍哪个二进制 | 建议：**真 `tauri build` / 3.0.0 NSIS**。不另做演示 SKU。**不要** `NODE_ENV=demo_script`（见 §2.3）。片中驱动不靠 `__tterm` | 点头 / 改成「debug 但藏调试项」 / Vite `--mode` 拍片变体 |
| **B-agent** | 本地 Agent 画面 | Working 动画 + Oh My Posh；会话是 Windows 本地 tab | **哪一个 Agent**（Claude Code / Codex / Pi / Kimi / Hermes / 其它：___）；OMP 主题/段长什么样；标签名（如 `agent`） |
| **C-proto** | 真机夹具协议 | 真 ESP32 + Arduino AT + 本机 Python 服务；产品仓库不成功能 | Python 监听 `127.0.0.1:___`；AT 子集（至少型号 / 关联 Wi‑Fi / 起网络 / TCP 透传）；固件连服务的端口 |

可选、拍前再定即可（不定也不挡改剧本）：

| 项 | 默认 | 可改成 |
| --- | --- | --- |
| C 导出宽度 | 与 B 并排约 430px（会挤） | 改全宽 |
| A 时长 | 约 14s（比原 7s 长：palette + 新 SSH + QP） | 剪辑压秒 |
| C 艺术字 | `Connect Success！`（预写，不要现场现算） | 换文案需同时改固件/服务 |

改定前 **不写** 录屏编排 / e2e，**不开拍**。Arduino 与 Python 等 **C-proto** 点头再落盘（建议路径 `drafts/demo/`）。

---

## 1. 三条片子


| 槽 | 文件 | README | 时长 | 标题（第一卖点） | 落地（不是标题） |
| --- | --- | --- | --- | --- | --- |
| **A** | `hero.gif` ~880px | 主视觉 | **~14s** | 干净 UI；开箱主题/字体；`Ctrl+P` / `Ctrl+Shift+P`；QP 远程端口 | 树莓派 `btop`、ubuntu `nyancat`、Remote 8000 |
| **B** | `agent.gif` ~430px | 与 C 并排 | **~8s** | 系统 NF 一次配置置顶；本地 Agent TUI 真中文输入 | Oh My Posh 图标、Working 刷新 |
| **C** | `share.gif` ~430px 或全宽 | 与 B 并排 | **~10s** | 玻璃下拉 / 玻璃 QP；Profile=AT；Share 让 AI 管串口 | 真 ESP32、`Connect Success！` |


循环落点：A = QP 里刚加上的 Remote `8000 → 127.0.0.1:8000`（后面 ubuntu 上 `nyancat` 仍在跑）；C = 艺术字 **Connect Success！**。C 幕 4 只看串口回显，后期约 **2×** 倍速。

---

## 2. 通则

### 2.1 原则

1. **卖点先于场景。** 树莓派 / 彩虹猫 / ESP32 是切过去之后的现场，不要写成教程标题。
2. **键盘优先，不露鼠标。** 切换器、下拉、QP 停够读；指针隐藏，观众会脑补「点过」。
3. **真 IME 才拍 IME。** 只要 B；系统输入法 + 扫描码。合成 `CompositionEvent`、剪贴板、`pyautogui.write("你好")` 都不算。本条 GIF 不是 IME 验收清单（那仍要人手，见 backlog）。
4. **Share 不露真 token。** 链接形态（`127.0.0.1`）要能看出来；query 打码或一次性会话。
5. **不拍失败路径。** 指纹、断线、关窗确认、报错框都不进这三槽。Settings 不逛六页。
6. **毛玻璃按槽。** A / B **关**；C **开** `overlayGlass`（下拉 / QP / 菜单必须看出霜化）。字略大，细笔画会糊。
7. **不从空桌面开机。** 窗口已开、会话已连。人提前摆好起始位；C 从与 A 相同的树莓派 SSH 接着拍，不必重播彩虹猫。
8. **片中脚本，开拍前人手。** 摆窗、烧录、`btop` / `nyancat` 预装、OBS 开录仍是人；镜头里的点击和快捷键一律脚本。指针仍隐藏，QP 的点按由脚本点控件。

### 2.2 拍摄环境（建议）


| 项 | 建议 | 备注 |
| --- | --- | --- |
| 包 | **真 release**（`tauri build` / 3.0.0 NSIS） | 见 §2.3；不要用 `cargo build --release` 冒充 |
| 窗口 | **1234×900**，不要全屏、不要改尺寸 | 三槽同一；导出再缩到 880 / 430 |
| DPI | **100%** | 125/150 字糊 |
| 皮肤 | **Cursor** | 三槽同一，不要 VS Code |
| 毛玻璃 | A / B 关；C 开 `overlayGlass` | Appearance 即时生效，不要录开关 |
| 字体 | 15–16px；CJK 走 Noto / 雅黑栈 | |
| 配色 | 深底、对比够 | 终端方案不要浅色 |
| 取景 | **只录 TTerm 窗口** | OBS **窗口捕获**，不要显示器/桌面/任务栏 |
| 指针 | **隐藏系统鼠标** | 菜单自己展开即可 |
| 暖机 | SSH / 真 ESP32 / Agent 已连 | A / C 不拍冷启动；C 固件 + Python 服务已在跑 |
| 输入法 | A / C 英文；B 微软拼音 | B 只发扫描码 |

录制：OBS 窗口捕获 → **MP4 母带**（30 fps 够）→ **gifski**（约 12–15 fps）。不要 Game Bar 直接出 GIF。

### 2.3 驱动分层（改定后再实现）

镜头里不露鼠标。下拉、QP、Share、字体 + / 拖链都要发生（菜单和列表在动），用脚本点元素或发键。

**不要另做「纯演示版」产品。** 仓库里已经有三套二进制，不要再加第四套 SKU：


| 二进制 | 前端 | 入画会露出 | `__tterm` | 配置目录 |
| --- | --- | --- | --- | --- |
| `tauri dev` / `cargo build` debug | Vite DEV | **Demo TTY / Anime TTY**（profile ▾）；**MOCK-LOOP / MOCK-NL**（串口列） | 有 | `%APPDATA%/…/dev/`（与安装版隔离） |
| `cargo build --release` + `bun run test:e2e:release` | 仍是 `NODE_ENV=development` 的压缩包 | **仍有 Demo/Anime TTY**（前端 DEV）；MOCK 口没有（后端已 release） | 有 | 安装版目录（会写脏日常配置） |
| **`tauri build` / NSIS** | `import.meta.env.DEV === false` | 无调试项 | **没有** | 安装版目录 |


现有 `e2e/specs/*.e2e.js` **不能**打进 NSIS：几乎每一条都 `waitUntil(window.__tterm)`。  
WebDriver（tauri-driver → WebView2）**可以**驱动 NSIS 窗口：发真实快捷键、点 CSS/aria。不能 `mgr.switchTo()`，切 tab 用 `Ctrl+Tab` / `Ctrl+P` / 点标签，和镜头里要卖的东西一致。

建议拍 **NSIS**，片中驱动是 `drafts/demo/hero.mjs`：对**已开窗口**走 WebView2 CDP（环境变量开 9222），发快捷键 / 点 `#quick-status`，**不**注入 `__tterm`、**不**用 QA `e2e/specs`。IME 仍走 Python 扫描码，与包无关。

片中分层不变：


| 层 | 适合 | 不适合 |
| --- | --- | --- |
| **开拍前人手** | 开窗 1234×900、摆 Settings 起始、ras 上 `btop`、插 ESP32、烧固件、Python 服务、OBS 开录 | 镜头里的任何点击和快捷键 |
| **JS（CDP 注入，`drafts/demo/`）** | A 全段；B 字体选择器 + 切 tab；C 幕 1–3 | **真 IME**；真 ESP32 电波 |
| **Python `SendInput` 扫描码** | 仅 B：拼音「中文输入法」 | chrome 编排 |

若改用 debug 仅为了 `__tterm`：开拍前必须藏 Demo TTY、Anime TTY、MOCK 口（C 的 profile ▾ 会拍到）。不要把 `test:e2e:release` 当成「看起来像正式版」——那条路径前端仍是 DEV。

**`NODE_ENV=demo_script` 不可行。** `NODE_ENV` 只有 `development` / `production` 两档；写成别的值 Vite/依赖行为未定义，且 **管不到** `import.meta.env.DEV`（那是 Vite `mode`），更 **管不到** Rust 的 `debug_assertions`（MOCK 口）。PowerShell 也不能写 `NODE_ENV=… cmd`。

若仍想「压缩包 + 有钩子 + 无 Demo/Anime」，正确旋钮是 **`vite build --mode demo_script`** + 显式 `VITE_*`（例如只开 `__tterm`，Demo TTY 仍跟 `DEV`）。这是本机拍片变体，**不能**进 `v*` 发布；还要单独关 updater（它只跳过 `DEV`，生产 mode 会弹更新框）。后端 MOCK 口仍要 release/`--features`，mode 解决不了。默认仍建议 NSIS + 只发键，不走这条。

Chrome 用 JS、拼音用 Python，不要混成一个会假打字的页面脚本。场景 1：`drafts/demo/hero.mjs`。场景 2：`drafts/demo/agent.mjs` + `ime_pinyin.py`（`uv venv`，bun spawn）。说明见 `drafts/demo/README.md`。

### 2.4 本轮不拍

Settings 除 A 的 Appearance 静帧、B 的字体选择器以外的其它页；主题滚动挑选；字体选择器里点 Nerd Fonts 外链；A / B 开毛玻璃；C 里录玻璃开关对比；Settings 里编辑转发表（A 只拍 QP 加一条 Remote）；Trust & Connect；密码打在 tab 里；死模式 / 重连长等待；托盘、多窗口、Zen / 全屏；桌面或任务栏入画；看得见的鼠标指针 / 点击高亮；失败、报错、确认框；在 C 的 QP 里逐项改 I/O（只切 Profile = AT）。

这些可以以后做 changelog 或文档插图，不挤 README 三槽。

---

## 3. 分镜 A — `hero.gif`（已按摆场改定）

**窗口 1234×900。** 人提前摆好起始：已在 **Settings → Appearance**；树莓派 SSH 已连，全屏 `btop`（**不用 tmux**，窗不够分）；ubuntu 主机在 `~/.ssh/config` 里，尚未打开。本条不用 `Ctrl+Tab`。

秒数是建议剪辑尺，拍完可压。**SSH 已上传密钥，无密码，选中即可连。** 不要指纹 / Trust & Connect / 密码框；连接闪一下即可，不必为握手加时长。


| 幕 | 秒（建议） | 画面在卖什么 | 操作 | 驱动 |
| --- | --- | --- | --- | --- |
| **1** | 0–1 | UI + 主题/字体 | 静帧，不点不滚 | 开拍前预置 |
| **2** | 1–2.5 | `Ctrl+P` 按名跳转 | 搜 `ras`，列表停够认，Enter → 已打开的树莓派 SSH | 发键 |
| **3** | 2.5–4.5 | 真 SSH TUI | 全屏 `btop` 已在刷，不打字 | 开拍前预置 |
| **4** | 4.5–7 | `Ctrl+Shift+P` 命令面板 | 打开 palette → **New SSH Tab** → 输入 `ubuntu` → **第一项** 连接 | 发键 |
| **5** | 7–9.5 | 命令 → 图形 | 打 `nyancat` + Enter，**等 2s** | 发键 |
| **6** | 9.5–14 | Quick Panel 远程端口 | 点 `#quick-actions` 打开 QP；**Remote (-R)** 添加行：`8000` Tab Tab `8000` → 点 **+** | 点控件 + 发键 |


**不要：** 冷启动、指纹框、密码框、Settings 其它五页、关窗确认、IME、tmux、`Ctrl+Tab`。不要把 btop / nyancat 写成这条标题。ubuntu 用 **内嵌 SSH**（QP 转发作 embedded-only）。

### 3.1 幕 1 — Appearance

同一帧里同时看见：Chrome Skin 两张卡（Cursor 选中）、字体行（家族 + 字号，bundled 等宽如 JetBrains Mono）、Color Scheme 画廊至少一整行、顶栏 Settings 伪标签 + 已有 SSH 标签。

侧栏停在 Appearance。滚动条停在「皮肤 + 字体 + 画廊第一行」刚好满窗；挤不下就**页内滚**，**不要改窗口尺寸**。1 秒只看。

### 3.2 幕 2 — Ctrl+P → ras

`Go to Tab…`（`Ctrl+P`）。滤词 **`ras`**，切到已经打开的树莓派会话（会关掉 Settings）。列表要停够认。不要靠 MRU 垫片。

### 3.3 幕 3 — 树莓派 btop

开拍前 `btop` 已在跑，占满终端。不要录 `btop` 启动，不要 tmux 分屏。

### 3.4 幕 4 — Ctrl+Shift+P → New SSH Tab → ubuntu

1. `Ctrl+Shift+P` 打开命令面板（`Show Command Palette…`）
2. 滤出 **New SSH Tab**，Enter（进入 `SSH hosts` 页）
3. 输入 **`ubuntu`**，停够认，**选第一项** 连接（密钥已在对方，**无密码**，直接进 shell）

`known_hosts` 里已有该主机，不要 Trust & Connect。

### 3.5 幕 5 — nyancat

ubuntu 提示符空闲后现场打 `nyancat` 回车（每个字母只入一次）。开跑后 **等 2s** 再打开 QP 配端口。演示机预先装好，不录 apt。`Ctrl+C` 不必进 GIF。

### 3.6 幕 6 — QP Remote 8000

焦点已在 ubuntu 内嵌 SSH tab。

1. 点标题栏闪电 `#quick-actions` 打开 Quick Panel（指针隐藏，脚本点）
2. 滚到 **Port forwards → Remote (-R)** 添加行（Listen port | Target host | Target port | +）
3. Listen port 打 **`8000`**
4. **Tab** 到 Target host（空着，提交时默认 `127.0.0.1`）
5. **Tab** 到 Target port，打 **`8000`**
6. 点该行 **+**（`Add Remote forward`）

即 Remote `-R`：远端听 8000，转到本机 `127.0.0.1:8000`。不要改 Local / Dynamic，不要进 Settings 转发表。

### 3.7 开录前

- [ ] **1234×900**，只录 TTerm；Cursor 皮肤，毛玻璃关
- [ ] 用 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 --remote-allow-origins=*` **之后**再开 TTerm（`bun run demo:hero -- --probe` 能看到 page）
- [ ] 起始：**Settings → Appearance**（皮肤 + 字体行 + 画廊第一行同帧可见）
- [ ] 树莓派 SSH **已打开**，标签能被 `ras` 滤到；全屏 `btop` 在跑；**无 tmux**
- [ ] `~/.ssh/config` 里有 **ubuntu** 主机；开拍时 **未打开** 该 tab；内嵌 russh 已开
- [ ] 密钥已上传，**无密码可直接连**；`known_hosts` 已信任；ubuntu 上 `$PATH` 有 `nyancat`
- [ ] QP 转发表是空的（否则「+」拍成重复行）
- [ ] 输入法英文；通知关掉

---

## 4. 分镜 B — `agent.gif`（已定）

**总长 ~8s**（2+1+1 字体，1s 切 tab，3s 输入）。并排槽字要够大；搜索框和 Fallback Chain 必须入画。

内置 JetBrains Mono **不是** Nerd Font。本条把系统里已装的 **JetBrainsMonoNL NF** 塞进回退链并提到最前。不拍下载字体、不打开 Nerd Fonts 外链。


| 幕 | 秒 | 画面在卖什么 | 操作 | 驱动 |
| --- | --- | --- | --- | --- |
| **1a** | 0–2 | 系统 NF 加入候选 | Font Settings 已开；搜 `jet`；**System** 列点 **+**（不要点 Built-in） | e2e |
| **1b** | 2–3 | 第一优先 | Fallback Chain 把刚加入的 NF **拖到最顶**（链要能看见在动） | e2e 拖拽 |
| **1c** | 3–4 | 保存 | 点选择器 **Apply**（会 `configStore.set` 并关窗） | e2e |
| **衔接** | 4–5 | 配置结束就是干活 | `Ctrl+P` 搜 `pi`（第一项），Enter 确认（不要点标签、不要 Ctrl+Tab） | 发键 |
| **2** | 5–8 | Agent TUI + 真 IME | Working 已在刷新；先入画 ~1s，再打 **中文输入法** | Python 扫描码 |


**不要：** 装字体过程、Settings 底栏再点一次 Apply、Ctrl+Tab、剪贴板/合成 CompositionEvent。切 tab 只挂起 Settings，没有未保存确认框。

### 4.1 字体选择器

开拍时对话框已打开（Appearance → Font Family → Configure），光标在 Search。不要把「点 Configure」算进 2 秒。

Windows 家族名可能是 `JetBrainsMonoNL Nerd Font` / `… Nerd Font Mono` / `… NF`。开录前确认搜 `jet` 能在 System 列命中。`+` 是 append，必须再拖到链 **第一行**（OMP/Agent 图标才走 NF）。对话框下半预览（含 ``）可以入画，不要在预览里打字。

TTerm **不内嵌** Nerd Fonts。演示机预先装好。

### 4.2 本地 Agent + IME

标签名要能被 `pi` 滤到且是第一项。`Ctrl+P` 打 `pi` 后 **Enter** 确认。切过去先让 Working 入画约 1 秒再打字。幕 2 的 3 秒 **快打** 五字「中文输入法」：拼音打完 **空格上屏**（`zhongwen` 空格、`shurufa` 空格），不要缩成「中文」、不要加到 4s。

要求只有：持续刷新、光标隐藏或假光标、能打字。具体 Agent / OMP 见 **§0 B-agent**。

微软拼音，空格上屏：


| 顺序 | 扫描码 | 上屏 |
| --- | --- | --- |
| 1 | `z h o n g w e n` → Space | 中文 |
| 2 | `s h u r u f a` → Space | 输入法 |


焦点在终端（xterm 隐藏 textarea）。组词时 **ImeBox 贴在输入点**，候选窗不跳 `(0,0)`——Working 动画就是为了把这个拍出来。禁止 `pyautogui.write`、Ctrl+V、e2e `CompositionEvent`。

### 4.3 开录前

- [ ] 系统已装 JetBrainsMonoNL NF；搜 `jet` 在 System 列看得到
- [ ] 回退链里 **还没有** 该 NF（否则「加入」拍成打勾）
- [ ] 字体选择器已打开、Search 空、Fallback Chain 可见；毛玻璃关
- [ ] 本地 Agent tab 已开，OMP + Working 在跑；点字体 Apply 之前 Settings 仍盖在上面
- [ ] 微软拼音；Python 只发键（`uv venv` 在 `drafts/demo/`，bun 会 `spawn` `ime_pinyin.py`）
- [ ] Agent 标签能被 `pi` 滤到且排第一（改 `QUERIES.gotoTab`）

---

## 5. 分镜 C — `share.gif`（已定）

**总长 ~10s**。开拍前 `overlayGlass` **已开**；窗口停在与 A 相同的树莓派 SSH tab。


| 幕 | 秒 | 画面在卖什么 | 操作 | 驱动 |
| --- | --- | --- | --- | --- |
| **1** | 0–2.5 | 玻璃下拉 + 一等串口入口 | 标题栏 **+ 右侧 ▾**（不是点已有 tab）；停 0.6–1s 看霜化（后面树莓派隐约可见）；Serial 列选定制 ESP32 | e2e |
| **2** | 2.5–5 | 玻璃 QP + 一步 AT | 打开 Quick Panel；**Profile → AT**（`line` + Enter CRLF）；再停 ~0.5s | e2e |
| **3** | 5–6.5 | Share 入口 | 关 QP；右键 **串口 tab** → **Share with AI**；链接形态可见，**token 打码**；标签青色点（overlay，不挤宽） | e2e |
| **4** | 6.5–8.5 | AI 管串口（人不打 AT） | **只留串口 tab**，不叠 Agent 窗口。回显：型号 → Wi‑Fi → 连上 Python 服务；后期 **约 2×** | 真设备 + 后期倍速 |
| **5** | 8.5–10 | 成功收束 | 透传日志后打出预写艺术字 `Connect Success！` | 固件或服务推一帧 |


**不要：** 录玻璃开关、手打一长串 AT、Wi‑Fi 密码特写、完整 token、MOCK 串口、从零 `pip install`。波特率已是 115200 则不动；Disconnect / Reconnect 不要点。

主张：同一窗口里 SSH 和串口是同一套 chrome；同一套分享协议打在设备会话上，远程 ESP32 不用装 Agent。树莓派 / ESP32 / 成功字是落地，不要拍成「ESP32 教程」。

### 5.1 幕 4 回显（仍要能扫到结果）


| 节 | 串口上应能认出 | 例（固件侧，不必原样） |
| --- | --- | --- |
| 型号 | 查询回报 | `AT+GMR` → 芯片/版本 |
| Wi‑Fi | 关联成功 | `AT+CWJAP=...` → `WIFI GOT IP` |
| 网络 | 服务起来 | 按固件（HTTP / TCP） |
| 透传 | 连上本机 Python | 固件 TCP 连上 → 服务端打连接日志 |


配网若仍太长：预先打到「已关联」，倍速只留「型号 → GOT IP → CONNECT」三拍。协议细节见 **§0 C-proto**。

幕 5 是收束不是第四个卖点。字要够大，430px 缩小后仍能认。不要现场现算艺术字。

### 5.2 夹具（改定后再写）

产品仓库里不做成功能。演示机两份脚本即可：

| 件 | 职责 |
| --- | --- |
| Arduino 固件 | 串口 AT：查型号、配 Wi‑Fi、起网络、TCP 连本机服务 |
| Python 服务 | 本机监听；打印连接日志；配合打出 `Connect Success！` |

不要 MOCK 口、不要纯软件冒充设备。本机 Agent 打开分享链接发 AT，**不出镜**。

### 5.3 开录前

- [ ] `overlayGlass` 开（A / B 可另存一份关玻璃的配置）
- [ ] 树莓派 SSH 已连，停在能认出的 `btop` 或提示符
- [ ] **真实 ESP32** 已插、固件已烧；profile 菜单里端口/产品名可认
- [ ] Python 服务已在听 `127.0.0.1`；艺术字已写进固件或服务
- [ ] 本机 Agent 已能打开分享链接发 AT（不出镜）
- [ ] 演示 SSID 可用；不要把真实密码定格在画面上

---

## 6. 拍完之后

1. 文件放到 `docs/images/hero.gif`、`agent.gif`、`share.gif`（只有这三条）。README 路径已按此预留。
2. 取消 `README.md` / `README_EN.md` 里演示动画注释，删掉「制作中」和四张占位截图（或只留一张静帧）。
3. 不改安装包图标；不把 MP4 推进仓库。
