# TTerm

基于 Tauri v2 + xterm.js 构建的 Windows 终端模拟器。追求小体积、高性能、低资源占用，专注于终端内容本身而非华而不实的界面。

> [English](README.md)

## 理念

Hyper（Electron）终端体积臃肿、内存占用高、启动慢，且存在终端边距过大、IME 输入异常、配色方案被覆盖等问题。Windows Terminal 功能尚可但扩展性差，SSH/串口等常用操作定位繁琐。

TTerm 去掉多余设计，只关注三件事：**高效操控**、**清晰的终端显示**、**快速启动**。

## 功能

- **多标签终端** — 无限标签，支持本地 Shell（cmd.exe / PowerShell）和 SSH 远程连接
- **SSH 配置集成** — 自动解析 `~/.ssh/config`，一键连接远端主机
- **Windows Terminal 配置导入** — 读取 WT 的 `settings.json` 和扩展片段，复用已有配置（VS、WSL、Azure、Git Bash、MSYS2）
- **配置可见性控制** — 在设置中自由开关导入的配置，隐藏后不会丢失
- **标签上下文菜单** — 右键标签可新建、改名、换颜色、复制、导出文本、关闭右侧/其他
- **终端上下文菜单** — Shift+右键可复制（纯文本/HTML）、粘贴、清屏、搜索、导出、新建标签
- **终端内搜索** — Ctrl+Shift+F 打开搜索栏
- **设置面板** — 通用、外观、配置三栏布局，支持渲染器切换、回滚缓冲区、粘贴选项、标签宽度模式
- **自定义窗口装饰** — 无原生标题栏，VS Code 风格标签栏集成窗口控制按钮
- **新建窗口** — 从右键菜单启动新应用窗口
- **配置持久化** — 所有设置跨会话保留

## 性能

| 对比项 | TTerm (Tauri) | Hyper (Electron) |
|--------|---------------|-------------------|
| 安装包 | ~5 MB | ~60 MB+ |
| 冷启动 | < 1s | ~3-5s |
| 空闲内存 | < 30 MB | ~150 MB+ |

## 技术栈

- **前端**: TypeScript + Vite + xterm.js v6 + Lucide Icons
- **后端**: Rust + Tauri v2 + portable-pty
- **通信**: Tauri invoke/event 桥接，PTY 输入输出通过事件流传输
- **打包**: NSIS 安装包 (~5 MB)

## 开发

```sh
# 安装依赖
bun install

# 前端开发
bun run dev

# 完整 Tauri 应用开发
bun run tauri dev

# 构建
bun run tauri build
```

## 路线图

- [ ] 串口（Serial）连接支持
- [ ] Telnet 协议支持
- [ ] 分屏显示
- [ ] 自定义配色方案配置界面
- [ ] 终端会话录制与回放

## 许可

MIT
