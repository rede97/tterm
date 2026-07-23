<p align="center">
  <img src="https://raw.githubusercontent.com/rede97/tterm/main/src/assets/tterm.svg" width="128" alt="TTerm" />
</p>

<h1 align="center">TTerm</h1>

<p align="center">
  一个快、小、专注的 Windows 终端。<br/>
  本地 Shell、SSH、串口，一个不少 —— 安装包却只有 ~5 MB。
</p>

<p align="center">
  <a href="https://github.com/rede97/tterm/actions/workflows/ci.yml"><img src="https://github.com/rede97/tterm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/rede97/tterm/releases/latest"><img src="https://img.shields.io/github/v/release/rede97/tterm" alt="Release" /></a>
  <a href="https://github.com/rede97/tterm/blob/main/LICENSE"><img src="https://img.shields.io/github/license/rede97/tterm" alt="License" /></a>
</p>

<p align="center">
  <img src="docs/images/screenshot.png" width="820" alt="TTerm 运行截图" />
</p>

> [English](README.md)

## 为什么选 TTerm

- **快** — 冷启动 < 1 秒，打开即用，没有 Electron 的臃肿
- **小** — 安装包 ~5 MB，空闲内存 < 30 MB
- **串口利器** — 硬件开发友好：设备自动枚举（USB VID:PID）、一键打开、
  波特率即点即切不断连、换行模式（LF 阶梯、CR 覆盖都有解）、输入模式
  （直发 / 本地回显 / 整行编辑），设备参数按 VID:PID 记忆
- **SSH 原生集成** — 自动读取 `~/.ssh/config`，主机一键连接
- **断线不怕** — 会话断开后按一下回车，原地重连
- **主题画廊** — 12 款内置配色 + 自动导入 Windows Terminal 方案，所见即所得

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

- [ ] **AI 会话共享** —— 把任意活跃会话（本地 shell / SSH / 串口）通过一条可吊销的 WebSocket 链接交给本地 AI agent：你实时看着它每一步操作，一键即可切断。不截图、不 OCR,agent 直接拿原始字节流。（[设计稿 + agent 接入指南](docs/ai-session-sharing.md)）
- [ ] 分屏显示
- [ ] 配色方案自定义编辑器
- [x] ~~串口终端~~ · ~~断线重连~~ · ~~主题系统~~ · ~~OSC 9;4 进度条~~

## 许可

MIT
