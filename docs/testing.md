# TTerm 自动化测试框架

三层测试金字塔，覆盖从纯逻辑到真实应用窗口的无人值守测试。

| 层 | 工具 | 范围 | 命令 | 耗时 |
|---|---|---|---|---|
| L0 后端单元测试 | Rust `#[cfg(test)]` | 命令解析、环境变量展开、换行互转、字体后缀剥离、串口参数，外加 relay/deadmode 异步集成测试 | `bun run test:rust` | 秒级（编译后） |
| L1 前端单元测试 | Vitest | 纯逻辑：hysteresis 适配算法、SSH 配置解析/生成、字体栈构建/解析 | `bun run test` | ~1.5s |
| L2 DOM 集成测试 | Vitest + happy-dom | 菜单渲染（mock Tauri IPC）：串口枚举列、禁用态、详情回退 | `bun run test` | 同上 |
| L3 端到端测试 | tauri-driver + WebdriverIO | 真实应用窗口：启动、标签栏、新建标签、终端视口 | `bun run test:e2e` | ~30s |

## L0 — Rust 后端单元测试

测试以 colocated `#[cfg(test)] mod tests` 形式分布在各功能模块内（100+ 用例 / 12 模块，以 `cargo test` 输出为准），与实现同文件、随实现演进：

| 模块 | 覆盖（用例数以 `cargo test` 输出为准，勿在此钉死） |
|---|---|
| `relay.rs` | WebSocket relay 全链路：路由、token、echo/EOF、掉线重连、kick、dead mode + Enter 重生、自动重连 |
| `share.rs` | AI 分享 HTTP API：prompt、屏幕快照、输入、限流、吊销、三类会话表 |
| `deadmode.rs` | in-band 断联协议：模式复位、提示、Enter、重生预滚动 |
| `cmdparse.rs` | 命令解析与环境变量展开 |
| `newline.rs` | 换行模式互转（含跨分包与二进制保护） |
| `serial.rs` | 串口参数映射、DTR/flow 恢复、newline 泵路径 |
| `serial_win.rs` | Windows PuTTY RTS/CTS DCB 位域（仅 Windows） |
| `pty.rs` | PTY resize、工作目录、Windows shell 探测 |
| `tray.rs` | 托盘注册表、owner 选举、进程存活 |
| `fonts.rs` | 系统字体后缀剥离 |
| `demo.rs` | demo / mock 串口会话 |
| `sshclient/` | 内嵌 SSH：认证、shell、转发、keygen/install、hashed known_hosts、split-UTF8 |

`relay.rs` 的用例是对真实 `WsHub` 的 `tokio::test` 异步集成测试，无需手动起进程即覆盖休眠重连、半开槽位释放等关键路径。

```sh
bun run test:rust        # = cargo test --manifest-path src-tauri/Cargo.toml
```

注意：首次运行需编译整个 Tauri 依赖树（数分钟），之后增量编译很快。

## L1/L2 — Vitest（前端）

- 配置：`vitest.config.ts`（happy-dom 环境）
- 用例：`tests/*.test.ts`（hysteresis 适配、SSH 配置解析/生成、字体栈构建、profile/context 菜单渲染、quick panel、confirm 对话框、OSC 解析等）
- L2 通过 `vi.mock("@tauri-apps/api/core")` 替换 IPC 层，在 happy-dom 中渲染真实菜单 DOM

```sh
bun run test          # 单次运行
bun run test:watch    # 监听模式
```

## L3 — 端到端（真实应用无人值守）

### 架构

```
wdio (WebdriverIO) ──WebDriver──> tauri-driver ──> msedgedriver ──> WebView2 (tterm.exe)
                                        ▲
                        e2e/drivers/msedgedriver.exe（版本钉定）
```

- `tauri-driver`：Tauri 官方 WebDriver 桥梁（已安装至 `~/.cargo/bin`，`cargo install tauri-driver --locked`）
- `msedgedriver`：必须与 WebView2 运行时版本匹配，钉定在 `e2e/drivers/`（**不入库**，见 .gitignore；当前文件的版本以 `e2e/drivers/Driver_Notes` 为准——150.0.4078.83 已在 151.x 运行时上验证可用，升级运行时后需重新核对）
- `e2e/wdio.conf.js` 自动完成：启动 vite dev server → 等待 1420 端口 → 启动 tauri-driver → 等待 4444 端口 → 执行 `e2e/specs/*.e2e.js` → 清理全部子进程

### 首次设置

**配置隔离**：debug 构建（`tauri dev`、e2e、cargo test 二进制）的应用状态全部落在 `%APPDATA%/com.rede.tterm\dev\` 子目录（config.json / keybindings.json / themes.json / serial-profiles.json / 托盘注册表），与正式安装版完全隔离——e2e 随便改配置也不会污染日常使用的实例。仅 window-state 插件仍共享父目录（窗口几何，无害）。

```sh
# 1. 安装 tauri-driver（已装可跳过）
cargo install tauri-driver --locked

# 2. 下载与 WebView2 运行时匹配的 msedgedriver 到 e2e/drivers/
#    查询本机 WebView2 版本：
powershell "(Get-ItemProperty 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}').pv"
#    下载（替换版本号）：
curl -L -o edgedriver.zip https://msedgedriver.azureedge.net/<版本>/edgedriver_win64.zip
#    解压 msedgedriver.exe 到 e2e/drivers/

# 3. 构建 debug 二进制
cd src-tauri && cargo build

# 4. 运行
bun run test:e2e
```

### 关键陷阱（已规避，勿回退）

1. **IPv6 回环**：所有地址必须用 `127.0.0.1`，禁止 `localhost`。`tauri.conf.json` 的 `devUrl` 已改为 `http://127.0.0.1:1420`（Windows 上 `localhost` 优先解析 `::1`，而 vite 只绑 IPv4，会导致 WebView2 加载失败页）。
2. **debug 二进制走 devUrl**：`cargo build`（非 release）的 `generate_context!` 使用 devUrl 而非内嵌 dist，因此 E2E 必须先起 vite dev server。
3. **`.cmd` 不能用 `shell:false` spawn**：vite 通过 `node node_modules/vite/bin/vite.js` 直启，保证测试结束可完整清理进程树。
4. **`active` 类在标签元素上**：`.terminal-instance` 没有 `active` 类，可见实例用 `style.display !== "none"` 判定；WebDriver 的 `isDisplayed()` 对 canvas 组件不可靠，用 `getBoundingClientRect()` 非零尺寸断言。
5. **msedgedriver 版本必须匹配 WebView2 运行时**，否则 tauri-driver 无法创建会话。

### CI 接入要点（Windows runner）

- GitHub Actions `windows-latest` 自带 WebView2；需按上面步骤下载匹配版本的 msedgedriver 和 `cargo install tauri-driver`（均可缓存）
- E2E 前先 `bun install && cd src-tauri && cargo build`
- 无人值守无需显示服务器，WebView2 在 CI 会话中可正常创建窗口

UI/UX 操作入口树、**重跑决策 / 待补自动化 / 必须人手**：[`docs/ux-entry-tree.md`](ux-entry-tree.md) §9–12。
设计稿 HTML：[`drafts/index.html`](../drafts/index.html)（与 markdown 分目录）。

- 只改 `--tt-ui` / `--tt-mono` 回退：重跑 `bun run test tests/fontconfig.test.ts`，**不要**为计算 `fontFamily` 加 e2e。
- 未动 tab 宽 / QP 行 / palette 列表 / 互斥打开：L3 UI 五件套不必重跑。
- 字形、毛玻璃观感、Cursor pill、真人 IME：人手，见该文档 §11 与 [`docs/backlog.md`](backlog.md)。

## 测试已发现的真实缺陷（回归保护）

1. `parseSshConfig` 的 `Host *` 通配符在非末尾位置时泄漏为普通主机（已修复）
2. `hysteresis` 在极小容器下可返回 0 列（退化网格），已加最终 min 钳制
3. 会话死亡后终端遗留 alt screen / 滚动区 / DEC 图形字符集等模式，会覆盖或错位重连提示——`deadmode` 的复位序列（含光标先存后恢复）已回归保护
