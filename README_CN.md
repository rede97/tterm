<p align="center">
  <img src="https://raw.githubusercontent.com/rede97/tterm/main/src/assets/tterm.svg" width="128" alt="TTerm" />
</p>

<h1 align="center">TTerm</h1>

<p align="center">
  为 AI Agent 适配的新一代快速轻量 Windows 终端。<br/>
  冷启动 < 1 秒 · agent TUI 里也能流畅打中文 · 为嵌入式工程师把串口做到极致。
</p>

<p align="center">
  <a href="https://github.com/rede97/tterm/actions/workflows/ci.yml"><img src="https://github.com/rede97/tterm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/rede97/tterm/releases/latest"><img src="https://img.shields.io/github/v/release/rede97/tterm" alt="Release" /></a>
  <a href="https://github.com/rede97/tterm/blob/main/LICENSE"><img src="https://img.shields.io/github/license/rede97/tterm" alt="License" /></a>
</p>

> [English](README.md)

## 为什么选 TTerm

### 为 AI Agent 工作流而生

- **把活会话交给你的 AI agent** — 右键标签页 → *Share with AI*，把链接贴给本地
  agent 即可。链接本身就是说明书：agent 拉取字符级屏幕快照（不截图、不 OCR、
 兼容 TUI——连假光标在哪都知道），还能替你敲键盘；你实时看着它每一步操作，
 一键即可切断。一切不出 127.0.0.1。（[协议](docs/ai-session-sharing.md)）
- **快** — 冷启动 < 1 秒，安装包 ~5 MB，空闲内存 < 30 MB，没有 Electron 的臃肿
- **中文输入，为 Agent TUI 而生** — pi、Claude Code 这类隐藏光标的 TUI 里，
  其他终端的拼音组合串要么彻底消失、要么飘到远处角落。TTerm 把组合串直接
  悬浮在输入点上，候选窗如影随形，上屏即隐——在 agent 里打中文和在普通
  shell 里一样跟手
- **SSH 一键直达任意主机** — 自动读取 `~/.ssh/config`，秒连服务器，无需任何配置
- **直达工作目录，开箱即用** — Shift+点击 `+` 选择文件夹（右键弹出最近目录），默认 shell 直接在所选目录启动；用 NSIS 安装后还可以在资源管理器里右键文件夹 → **Open in TTerm**——切到项目目录就能开始 agent 开发（pi、Claude Code）

### 为嵌入式工程师优化

- **串口利器** — 硬件开发友好：设备自动枚举（USB VID:PID）、一键打开、
  波特率即点即切不断连、换行模式（LF 阶梯、CR 覆盖都有解）、输入模式
  （直发 / 本地回显 / 整行编辑），设备参数按 VID:PID 记忆
- **休眠不掉线** — 合上笔记本再打开，shell 还在原地。传输层断开时 TTerm
  在后台静默重连——无弹窗、不丢历史。会话真正结束（shell 退出、串口拔出）时，
  重连提示直接打印在终端里：按一下回车即重生——不用找焦点、没有挡路的弹窗

### 更多亮点

- **主题画廊** — 12 款内置配色 + 自动导入 Windows Terminal 方案，所见即所得

| 主界面 | 新建标签菜单 |
| :---: | :---: |
| <img src="docs/images/screenshot.png" width="410" alt="主界面" /> | <img src="docs/images/screenshot-profiles.png" width="410" alt="新建标签菜单：本地 shell、SSH 主机、串口" /> |
| 主题画廊 | 快速进入工作目录 |
| <img src="docs/images/screenshot-themes.png" width="410" alt="设置中的主题画廊" /> | <img src="docs/images/screenshot-browse.png" width="410" alt="文件夹选择 + 最近目录 —— 一键在任意工作目录启动 shell" /> |

## 下载

从 [Releases](https://github.com/rede97/tterm/releases/latest) 获取安装包（NSIS / MSI）。

## 性能

| 对比项 | TTerm (Tauri) | Hyper (Electron) |
|--------|---------------|-------------------|
| 安装包 | ~5 MB | ~60 MB+ |
| 冷启动 | < 1s | ~3-5s |
| 空闲内存 | < 30 MB | ~150 MB+ |

## 从源码构建

```sh
bun install
bun run tauri build
```

技术栈：Tauri v2 (Rust) + xterm.js，本地 WebSocket 回环传输终端数据。
测试与开发文档见 [docs/testing.md](docs/testing.md)。

## 路线图

- [x] ~~**AI 会话共享**~~ —— 把任意活跃会话（本地 shell / SSH / 串口）通过一条可吊销的链接交给本地 AI agent：agent 打开链接即读懂用法，拉取字符级屏幕快照（不截图、不 OCR、兼容 TUI），还能代替你敲键盘。你实时看着它每一步操作，一键即可切断。（[设计稿 + agent 接入指南](docs/ai-session-sharing.md)）
- [ ] 分屏显示
- [ ] 配色方案自定义编辑器
- [x] ~~串口终端~~ · ~~断线重连~~ · ~~主题系统~~ · ~~OSC 9;4 进度条~~

## 许可

MIT
