---
name: tauri-e2e-testing
description: Pitfalls and setup details for unattended E2E testing of this Tauri v2 app (tauri-driver + WebdriverIO + WebView2 on Windows). Use when writing, running, or debugging E2E tests, modifying wdio config, updating WebView2/msedgedriver, or when E2E sessions fail to start or page fails to load.
---

# Tauri E2E Testing（Windows 无人值守）

本项目 E2E 链路：`wdio → tauri-driver(:4444) → msedgedriver → WebView2 (tterm.exe)`。
完整框架文档见 `docs/testing.md`，配置在 `e2e/wdio.conf.js`。以下全是踩过的坑，改动前必读。

## 致命陷阱（不要回退这些规避措施）

### 1. IPv6 回环：永远用 `127.0.0.1`，禁止 `localhost`

- Windows 上 `localhost` 优先解析为 `::1`，而 vite 只绑 IPv4 → WebView2 加载 Chrome 错误页（`TITLE: localhost`，SOURCE 是错误页 HTML）。
- `src-tauri/tauri.conf.json` 的 `devUrl` 必须是 `http://127.0.0.1:1420`。
- wdio 的 `hostname`、waitForPort、诊断 curl 全部用 `127.0.0.1`。
- **症状识别**：WebDriver 会话创建成功但任何元素都找不到 → 先 `browser.getUrl()` + `getPageSource()` 看是不是错误页。

### 2. debug 二进制走 devUrl，不走内嵌 dist

`cargo build`（非 release）的 `generate_context!` 在 debug_assertions 下加载 devUrl。因此 E2E 必须先起 vite dev server，改 devUrl 后必须重新 `cargo build` 才生效。

### 3. msedgedriver 版本必须精确匹配 WebView2 运行时

- 查版本：`powershell "(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}').pv"`
- 下载：`https://msedgedriver.azureedge.net/<版本>/edgedriver_win64.zip`，解压到 `e2e/drivers/`（已在 .gitignore，41MB 不入库）。
- WebView2 自动升级后必须重新下载匹配版本，否则 tauri-driver 无法创建会话。

## 进程管理陷阱

### 4. `.cmd` 不能 `shell:false` spawn

`spawn("bun.cmd", …, { shell: false })` 在 Windows 上静默失败（error 事件），dev server 永远起不来。**正确做法**：`spawn(process.execPath, ["node_modules/vite/bin/vite.js"])` 直启 node 进程。

### 5. 进程树清理

- `shell:true` 的 cmd 包装被杀后，孙进程（vite/bun）会残留占端口。用 `taskkill /pid <pid> /T /F` 杀整棵树。
- 调试 E2E 时**必须后台运行 + 日志文件**（`(bun run test:e2e > /tmp/e2e.log 2>&1 &) && sleep 75 && tail`），stdio inherit 会让子进程hold住管道导致同步调用挂起超时。
- 残留排查：`netstat -ano | grep -E ":1420|:4444" | grep LISTEN`，按 PID `Stop-Process -Force`。

### 6. 端口就绪竞态

spawn tauri-driver 后 wdio 会立即连接 4444 → "Unable to connect"。beforeSession 必须依次 waitForPort(1420) → waitForPort(4444) 后再返回。

## 元素断言陷阱（WebView2/WebDriver 特性）

### 7. `isDisplayed()` 对 canvas 组件不可靠

xterm 是 canvas 渲染，WebDriver 可见性判断常返回 false。用 `getBoundingClientRect()` 非零尺寸 + `browser.waitUntil` 断言。

### 8. `active` 类在标签元素上，不在终端容器上

`.terminal-instance` **没有** `active` 类（active 加在 `.tab` 上）。可见终端实例的判定：`[...document.querySelectorAll(".terminal-instance")].find(el => el.style.display !== "none")`。

### 9. 逗号选择器返回 DOM 序第一个匹配

`$(".terminal-instance.active .xterm, .terminal-instance .xterm")` 会命中**已隐藏的第一个标签**（display:none），尺寸恒为 0。复合选择器断言前确认首个匹配是目标元素。

### 10. 真实元素 ID 以 index.html 为准

新建标签按钮是 `#new-tab`（不是 `#new-tab-btn`，那是 `#new-tab-menu-btn` 下拉按钮）。写 spec 前先读 `index.html`。

## Vitest/happy-dom 层（L2）配套陷阱

### 11. `mockClear()` 不清实现

跨用例改 mock 行为必须用 `mockReset()` + 重新 `mockImplementation()`，否则上一个用例的实现泄漏。

### 12. 模块级 DOM 访问

`profilemenu.ts` 顶层即 `getElementById(...)!`：必须先 `document.body.innerHTML = …` 再 `await import()`，且每个用例 `vi.resetModules()` 避免模块缓存。

### 13. mock Tauri IPC

`vi.mock("@tauri-apps/api/core", () => ({ invoke: mockFn }))` 必须在 import 任何 app 模块之前声明（vi.mock 提升）。

## 验证清单（改完 E2E 相关代码后）

1. `bun run build` — tsc + vite 零警告
2. `bun run test` — Vitest 34 例
3. `bun run test:e2e` — 4 例（后台跑，查 /tmp/e2e.log）
4. `netstat -ano | grep -E ":1420|:4444"` — 确认无残留监听
