<p align="center">
  <img src="docs/images/logo.svg" width="96" alt="TTerm" />
</p>

<h1 align="center">TTerm</h1>

<p align="center">
  <strong>AI Agent 时代，为 Windows 开发工作重新设计的轻量、快速反应任务终端。</strong><br/>
  承载本地、远程和设备上的工作流，而不仅仅是工具。<br/>
  快速切入本地、SSH、串口任意会话。针对中文输入优化和 Agent TUI 能一起用。冷启动不到一秒。
</p>

<p align="center">
  <a href="https://github.com/rede97/tterm/releases/latest"><strong>Download for Windows</strong></a>
  ·
  <a href="README_EN.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/rede97/tterm/actions/workflows/ci.yml"><img src="https://github.com/rede97/tterm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/rede97/tterm/releases/latest"><img src="https://img.shields.io/github/v/release/rede97/tterm" alt="Release" /></a>
  <a href="https://github.com/rede97/tterm/blob/main/LICENSE"><img src="https://img.shields.io/github/license/rede97/tterm" alt="License" /></a>
</p>

<!-- 演示动画：把 GIF 放到对应路径后取消下面的注释。
     docs/images/hero.gif      冷启动 + 命令面板 + 新开会话
     docs/images/share.gif     Share with AI
     docs/images/sessions.gif  本地 / SSH / 串口
<p align="center">
  <img src="docs/images/hero.gif" width="880" alt="TTerm" />
</p>
<p align="center">
  <img src="docs/images/share.gif" width="430" alt="Share with AI" />
  &nbsp;
  <img src="docs/images/sessions.gif" width="430" alt="Local, SSH, and serial" />
</p>
-->

<p align="center"><em>演示动画制作中。下列截图为占位，完成后替换为 GIF。</em></p>

| 终端与 Agent | 本地、SSH 与串口 |
| :---: | :---: |
| <img src="docs/images/screenshot.png" width="410" alt="TTerm 中运行的 CLI AI Agent" /> | <img src="docs/images/screenshot-profiles.png" width="410" alt="本地 Shell、SSH 主机与串口设备入口" /> |
| 主题与字体 | 从项目目录开始 |
| <img src="docs/images/screenshot-themes.png" width="410" alt="TTerm 主题与字体设置" /> | <img src="docs/images/screenshot-browse.png" width="410" alt="选择项目目录或最近使用的目录" /> |

## 为什么是 TTerm

### 轻，而且快

冷启动不到 1 秒。安装包约 7 MB。空闲内存低于 30 MB。给开发工作用，而不是再做一个功能更多的传统终端。

### 三种会话，一套工作流

本地 Shell、SSH、串口都是一等标签：同一套新建、切换、重连和分享。笔记本休眠或短暂断线后静默恢复，滚动历史还在。

### 让 AI 看见真实现场

**Share with AI** 把正在运行的会话交给本地 Agent：字符级屏幕（滚动区、颜色、光标、TUI），不是截图或 OCR。授权后 Agent 可以回写按键。服务只听 `127.0.0.1`。协议见[会话分享](docs/ai-session-sharing.md)。

Windows 上 Agent TUI 常会藏光标，输入法组合串和候选窗跟着跑偏。TTerm 在输入点附近重建组合显示，中文（以及日文、韩文）可以在隐藏光标的 TUI 里正常打字。

### 开箱即用

内嵌主题和等宽字体，SSH 客户端也在安装包里。读已有的 `~/.ssh/config` 就能连，不用再配一套工具链。

### 纯键盘，命令式

切标签、开会话、改串口和转发，都可以从命令面板打出来。默认快捷键兼容 VS Code 习惯（`Ctrl+Shift+P` / `Ctrl+P` / `Ctrl+Tab`），日常不必碰鼠标。

## 功能

- **本地** — 读取 Windows Terminal Profile；从指定目录开 Shell；资源管理器 **Open in TTerm**
- **SSH** — 内建客户端；读取 `~/.ssh/config`；密码和口令在标签里输入；主机指纹对话框；本地 / 远程 / SOCKS5 转发
- **串口** — 自动发现设备（USB VID/PID）；运行中改波特率；直发 / 回显 / 整行；流控与 RTS/CTS/DTR/DSR；Profile 保存输入与换行
- **主题与字体** — 内嵌配色和等宽字体，装完就能用
- **命令面板** — `Ctrl+Shift+P`；`Ctrl+P` 跳转标签；操作可全键盘完成
- **会话恢复** — 休眠或短暂传输中断后重连，保留历史
- **低占用** — Tauri + xterm.js；终端字节走本机 WebSocket，不经过 IPC

## 适合谁

并非只面向中文用户。快启动本身就是一块好用的 Windows 终端；把 **Share with AI** 接到正在跑的 SSH 或串口上，运维和嵌入式工程师也能用来辅助远程排障和现场调试。

- 在 Windows 上把 Claude Code、Codex、Pi 等 CLI Agent 当主工具
- 需要立刻切进本地、SSH、串口任意会话的开发与运维
- 用 AI 看着同一段远程日志或串口输出做诊断的嵌入式工程师
- 用中文（以及日文、韩文）和 Agent 交流，被 Windows IME / TUI 打断过
- 习惯 VS Code 快捷键、希望终端也能纯键盘操作
- 在意启动速度、内存和数据不出本机

## 下载

从 [Releases](https://github.com/rede97/tterm/releases/latest) 下载 Windows 安装包（NSIS / MSI）。

## 快捷键

| 操作 | 默认 |
| --- | --- |
| 命令面板 | `Ctrl+Shift+P` |
| 跳转标签 | `Ctrl+P` |
| 最近标签 | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| 新建本地标签 | `Ctrl+T` |
| 关闭标签 | `Ctrl+W` |
| 设置 | `Ctrl+,` |
| 全屏 / Zen | `F11` / `Shift+F11` |
| 新窗口 | `Ctrl+Shift+N` |

可在设置 → 键盘改绑定。终端内查找：在终端里 **Shift+右键**。

## 从源码构建

```sh
bun install
bun run tauri build
```

技术栈：Tauri v2（Rust）+ xterm.js。开发与测试见 [docs/testing.md](docs/testing.md)。

## 许可

[MIT](LICENSE)
