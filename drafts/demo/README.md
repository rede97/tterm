# README 演示注入（场景 1 / `hero.gif`）

接到**已经摆好**的 TTerm 窗口，不启新进程，不用 `window.__tterm`，不改产品包。

WebView2 用环境变量打开 CDP；脚本只发快捷键、改 input、点 `#quick-status` / `+`。

## 拍之前

1. **先设环境变量再开 TTerm**（开着的窗口没有调试口，必须先关再开）：

```powershell
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222 --remote-allow-origins=*"
```

然后启动安装版 TTerm（或你用来出镜的那个 exe）。

2. 窗口 **1234×900**，Cursor 皮肤，毛玻璃关。摆好起始：

   - Settings → Appearance（皮肤 + 字体行 + 画廊第一行同帧）
   - ras SSH 已开，全屏 `btop`
   - ubuntu **不要**预先打开；内嵌 russh；密钥直连

3. OBS 窗口捕获 TTerm，指针可藏（脚本也会 `cursor: none`）。

4. 探活：

```powershell
bun run demo:hero -- --probe
```

应看到 `tauri.localhost` 或 `127.0.0.1:1420` 的 page。

5. 开录后执行（默认倒计时 3 秒）：

```powershell
bun run demo:hero
```

跳过倒计时：`bun run demo:hero -- --countdown=0`

## 镜头里做什么（场景 1）

| 幕 | 脚本 |
| --- | --- |
| 1 | 静帧 1s |
| 2 | `Ctrl+P` → 打 `ras` → Enter |
| 3 | 停 2s（btop） |
| 4 | `Ctrl+Shift+P` → `new ssh tab` → Enter → `ubuntu` → Enter |
| 5 | 焦点进 xterm，打 `nyancat` + Enter，**等 2s** |
| 6 | 点 `#quick-status` → Remote 添加行 `8000` Tab Tab `8000` → 点 `+` |

秒数和滤词在 `hero.mjs` 顶部的 `TIMINGS` / `QUERIES`。

## 场景 2 / `agent.gif`

`uv` 虚拟环境在 `drafts/demo/.venv`（无 PyPI 依赖，只用标准库 SendInput）。

```powershell
cd drafts/demo
uv venv
```

摆场：Font Settings 已开、Search 空、回退链里还没有 NF、本地 Agent tab 在跑 Working。`Ctrl+P` 搜 **`pi`** 时第一项就是它（`QUERIES.gotoTab`）。

```powershell
bun run demo:agent -- --probe
bun run demo:agent
```

只练字体、不打字：`bun run demo:agent -- --skip-ime`

镜头：搜 `jet` → System 列 **+** → 拖到链顶 → Apply → `Ctrl+P` `pi` Enter → 停 1s → bun 拉起 `ime_pinyin.py`（拼音后 **空格** 上屏）。

秒数和滤词在 `agent.mjs` 的 `TIMINGS` / `QUERIES`。

## 注意

- 不要用 `NODE_ENV=demo_script`。不要把这条 CDP 环境变量写进发布包。
- 日常 `tauri dev` 也能探活（同样先设环境变量再开），但出镜请用 NSIS。
- 连不上 `:9222`：窗口是设变量**之前**开的，关掉重开。
