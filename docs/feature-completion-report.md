# TTerm 功能达成报告

- 版本：v0.1.5（已发布 v0.1.1 ~ v0.1.5 共 5 个版本）
- 报告日期：2025-07-21
- 需求基线：README.md / README_CN.md 中声明的功能清单与路线图（仓库内无独立需求文档）
- 验证方式：源码静态分析（前端 17 个 TS 模块 / 后端 Rust 24 个 Tauri 命令）+ `bun run build` 构建通过、零警告

---

## 一、总体结论

| 分类 | 数量 | 已达成 | 部分达成 | 未达成 |
|---|---|---|---|---|
| README 声明功能 | 13 | 13 | 0 | 0 |
| 路线图功能 | 5 | 0 | 1（串口） | 4 |

README 中声明的全部功能均已实现并经代码验证；路线图 5 项中仅串口（Serial）有进展（端口枚举已实现）。Telnet 已从需求中移除（太小众且不安全）。

## 二、README 声明功能达成明细

| # | 功能 | 状态 | 实现位置与说明 |
|---|---|---|---|
| 1 | 多标签终端（本地 Shell / SSH） | ✅ 达成 | `src/tab.ts`、`src/tabmanager.ts`；每标签独立 PTY 会话，后端 `pty_spawn` / `pty_spawn_ssh` |
| 2 | SSH 配置集成（解析 `~/.ssh/config`） | ✅ 达成 | Rust 端原始文件 I/O（`ssh_read_config_raw`），前端 `profiles.ts` 解析，支持通配符继承 |
| 3 | Windows Terminal 配置导入 | ✅ 达成 | `read_wt_settings` + `read_wt_fragments`（3 个片段目录）；支持 VS（vswhere）、WSL、Azure、Git Bash、MSYS2 |
| 4 | 配置可见性控制 | ✅ 达成 | 设置 > Profile/SSH 面板开关，隐藏仅影响新建菜单，数据不丢失 |
| 5 | 标签上下文菜单 | ✅ 达成 | `contextmenu.ts` `showTabContextMenu`：新建/改名/换色/复制/导出/关闭右侧/其他 |
| 6 | 终端上下文菜单（Shift+右键） | ✅ 达成 | 复制、Copy as HTML、粘贴、清屏、搜索、导出文本、新建标签；捕获阶段处理避免 xterm 拦截 |
| 7 | 终端内搜索（Ctrl+Shift+F） | ✅ 达成 | `search.ts`，基于 `@xterm/addon-search`，搜索词按标签保存/恢复 |
| 8 | 设置面板 | ✅ 达成 | `settings.ts`（619 行），四面板侧栏布局（通用/外观/配置/SSH），动态导入懒加载 |
| 9 | 自定义窗口装饰 | ✅ 达成 | `decorations: false` + `window.ts`；标签栏即标题栏，VS Code 风格窗口控制按钮，拖拽与双击最大化共存 |
| 10 | 新建窗口 | ✅ 达成 | 后端 `open_new_window`，上下文菜单可触发 |
| 11 | 配置持久化 | ✅ 达成 | `{app_config_dir}/config.json`，`read_config`/`write_config`/`delete_config` |
| 12 | 字体管理系统 | ✅ 达成（v0.1.4 新增，超出 README 清单） | `fontconfig.ts`/`fontpicker.ts`：内置 + 系统字体、实时预览、优先级排序、CJK 回退 |

| 13 | 串口设备枚举 | ✅ 达成 | 后端 `serial_list_ports`（`serial_enumerator`）+ 前端 `loadSerialPorts()`；新建标签菜单新增 Serial 列，每次打开菜单重新枚举（支持热插拔），显示端口名、设备名与 USB VID:PID；菜单项禁用态（会话功能未开放） |

## 三、架构与工程实现情况

| 项目 | 状态 | 说明 |
|---|---|---|
| 前后端通信 | ✅ | PTY I/O 经本地 WebSocket（tokio-tungstenite）直连 xterm attach addon，二进制帧零序列化开销 |
| PTY 会话模型 | ✅ | `HashMap<String, PtySession>` 每标签独立 shell + tokio 异步读取任务 |
| 渲染器 | ✅ | WebGL / Canvas 可切换（`@xterm/addon-webgl`） |
| 窗口状态保存 | ✅ | `tauri-plugin-window-state` 自动处理 |
| 循环依赖规避 | ✅ | tab.ts 不依赖 tabmanager.ts；contextmenu 动态导入 |
| 窗口标题跟随终端 | ✅ | `onTitleChange` 已接线（v0.1.4） |
| 构建 | ✅ | `bun run build` 通过，tsc 零错误，vite 零警告 |
| 测试 | ✅ 已建立（三层） | Rust 单元测试 24 例（lib.rs 内嵌）；Vitest 前端单元 + happy-dom DOM 测试 34 例；tauri-driver + WebdriverIO E2E 4 例。详见 `docs/testing.md` |
| 遗留代码 | ⚠️ | `src/terminal.ts` 为孤儿模块（无引用，仅留作参考），建议删除 |

## 四、路线图功能达成情况

| 路线图项 | 状态 | 说明 |
|---|---|---|
| 串口（Serial）连接 | 🟡 部分达成（约 40%） | 端口枚举全链路达成：后端 `serial_list_ports` + 前端枚举加载 + 新建菜单 Serial 列展示。尚未实现：串口会话模型（打开/读写/关闭）、参数配置（波特率/数据位/校验位）、标签接入 |
| 分屏显示 | ❌ 未启动 | 现有架构以标签为单位，每标签一个 xterm 实例，分屏需重构布局模型 |
| 自定义配色方案配置界面 | ❌ 未启动 | 主题目前硬编码于 xterm 初始化配置 |
| 终端会话录制与回放 | ❌ 未启动 | WebSocket 中继层是天然的录制切入点 |
| OSC 9;4 进度条 | ❌ 未启动 | 需 xterm OSC 处理器 + 标签进度 UI |

## 五、已知差距与建议

1. **无正式需求文档** — 建议将本报告基线固化为 `docs/requirements.md`，后续功能按条目跟踪。
2. **串口会话待实现** — 端口枚举已完成，串口菜单项目前为禁用态，需补全串口读写会话（建议后端新增 `serial_open`/`serial_write`/`serial_close` 命令，复用 WebSocket 中继模型）。
3. **无自动化测试** — 关键纯函数（`hysteresis`、`parseSshConfig`/`generateSshConfig`、`buildFontFamily`/`parseFontFamily`）适合作为首批单测对象。
4. **清理孤儿模块** — `src/terminal.ts` 已无引用。
5. **性能指标未验证** — README 宣称的"安装包 ~5MB / 冷启动 <1s / 空闲内存 <30MB"未在本次分析中实测，建议补充基准数据。
6. ~~README 技术栈描述过时~~（已修复） — 通信架构描述已更新为 WebSocket loopback；Telnet 已从路线图移除；串口枚举已加入功能清单。
