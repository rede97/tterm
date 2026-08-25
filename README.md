<p align="center">
  <img src="https://raw.githubusercontent.com/rede97/tterm/main/src/assets/tterm.svg" width="128" alt="TTerm" />
</p>

<h1 align="center">TTerm</h1>

<p align="center">
  <strong>为 CLI Agent 重新设计的 Windows 开发终端。</strong><br/>
  让 AI 进入本地、SSH 与串口中的真实开发现场，并让中文输入和 Agent TUI 交互真正可用。
</p>

<p align="center">
  <a href="https://github.com/rede97/tterm/actions/workflows/ci.yml"><img src="https://github.com/rede97/tterm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/rede97/tterm/releases/latest"><img src="https://img.shields.io/github/v/release/rede97/tterm" alt="Release" /></a>
  <a href="https://github.com/rede97/tterm/blob/main/LICENSE"><img src="https://img.shields.io/github/license/rede97/tterm" alt="License" /></a>
</p>

> [English](README_EN.md)

## 终端正在成为 AI 开发环境的一部分

当 CLI Agent 开始参与开发，终端不再只是命令的输入输出窗口。它同时承载代码生成、构建、部署、远程操作、日志观察和人机协作，也决定了 Agent 能看到什么、用户能否自然地接管操作。

真实开发也很少只发生在本机 Shell 中。Linux 软件开发可能主要通过 SSH 在远端完成；嵌入式开发还需要持续观察串口；同一个任务则可能由本地 CLI Agent 协调这些环境。需要 AI 帮忙时，关键现场往往散落在多个会话里，只能依靠复制日志、截图和反复解释来传递上下文。

在 Windows 上使用中文与 CLI Agent 交互，还会遇到另一个长期被低估的问题：TUI 隐藏或移动光标后，输入法组合串和候选窗可能消失、错位，甚至远离实际输入位置。纯英文输入感受不到它，但对以中文思考和表达的开发者，它会持续打断工作。

TTerm 来自这组具体需求：

- 终端应当是 CLI Agent 开发工具的一部分，而不只是承载 Agent 的容器；
- AI 不只阅读粘贴出来的一段日志，而是理解正在运行的开发现场；
- 本地 Shell、SSH 和串口是同一套开发工作流中的一等会话；
- 中文输入以及 Agent TUI 的显示和交互在 Windows 上应该自然、稳定；
- 工具应当轻、快，并在 Windows 上开箱即用。

TTerm 的目标不是复刻一个功能更多的传统终端，而是成为 Windows 上与 CLI Agent 结合使用的开发工具。远程 Linux 开发、嵌入式调试和中文 Agent 交互，是这一目标下彼此连通的核心场景。

## 让 AI 进入真实开发现场

TTerm 可以把一个正在运行的会话分享给本地 AI Agent。Agent 获得的是字符级终端状态，而不是截图或 OCR 结果，因此能够理解滚动区域、颜色、光标和 TUI 界面，并在授权后向会话发送输入。

这意味着你可以让 AI：

- 在远程 Linux 环境中查看构建、部署和服务运行状态，并继续执行诊断；
- 持续观察串口输出，捕捉复位、异常日志和状态变化；
- 阅读本地 CLI 工具或 TUI 的完整现场；
- 在你可见、可随时终止的会话中协助操作。

分享服务仅监听 `127.0.0.1`。右键会话标签选择 **Share with AI**，将生成的链接交给本地 Agent 即可。协议与能力边界见[会话分享协议](docs/ai-session-sharing.md)。

## 本地、SSH 和串口是同一种开发上下文

对 TTerm 来说，远程主机和硬件设备不是附加功能，而是 CLI Agent 可能需要理解和操作的开发环境。

### 远程 Linux 开发

TTerm 自动读取 `~/.ssh/config`，让已有的远程开发环境直接成为终端 Profile。内置 SSH 客户端在标签里输入密码和密钥口令（与 OpenSSH 相同），主机指纹用对话框确认，并支持本地、远程和 SOCKS5 端口转发；会话发生短暂传输中断时可以自动恢复并保留历史。

这使远程构建、部署、日志分析和故障诊断能够留在同一套 Agent 工作流中，而不必把关键上下文搬回本机。

### 嵌入式与串口调试

串口并不是 TTerm 的附加窗口。它和本地 Shell、SSH 一样拥有独立标签、历史记录、断线状态和会话控制。

- 自动识别串口设备及 USB VID/PID；
- 运行中切换波特率，无需关闭标签；
- 支持直发、本地回显与整行编辑；
- 可配置 Enter 与接收数据的换行处理；
- 支持软件/硬件流控以及 RTS、CTS、DTR、DSR；
- 设备重新插入后自动恢复会话；
- 使用 Profile（Normal / Log / AT 等）保存会话输入与换行方式；波特率与流控在连接侧单独调节。

当问题只在设备运行现场出现时，你可以让 AI 与你看到同一段持续变化的串口输出，而不再反复复制日志。

## 为 Agent TUI 与中文输入优化

CLI Agent 广泛使用全屏刷新、隐藏光标、复杂滚动区和持续输出。这些交互放大了 Windows 终端中原本不明显的显示、滚动、光标和输入问题。TTerm 将 Agent TUI 作为主要工作负载持续测试和优化，而不是只保证普通命令行可以运行。

部分 Agent TUI 会隐藏真实光标，Windows 输入法因此无法把拼音组合串和候选窗放在正确位置。TTerm 会在终端输入点附近重建组合串显示，让中文输入在隐藏光标、全屏 TUI 和普通 Shell 之间保持一致。

这项优化首先服务中文用户，同时面向日文、韩文等依赖 IME 组合输入的 CJK 工作流持续完善。

## 一个窗口连接整个开发现场

- **本地项目**：读取 Windows Terminal Profile，支持从指定目录启动 Shell；安装后可从资源管理器直接选择 **Open in TTerm**。
- **SSH**：自动读取 `~/.ssh/config`，密码在终端标签中输入，支持密钥、主机指纹确认以及本地、远程和 SOCKS5 端口转发。
- **串口**：自动发现设备，并通过 Profile 保存会话参数。
- **会话恢复**：笔记本休眠或短暂传输中断后静默重连，保留终端历史。
- **低资源占用**：基于 Tauri 与 xterm.js，冷启动小于 1 秒，安装包约 7 MB，空闲内存小于 30 MB。

| 终端与 Agent 会话 | 本地、SSH 与串口入口 |
| :---: | :---: |
| <img src="docs/images/screenshot.png" width="410" alt="TTerm 中运行的 CLI AI Agent" /> | <img src="docs/images/screenshot-profiles.png" width="410" alt="本地 Shell、SSH 主机与串口设备入口" /> |
| 主题与字体预览 | 从项目目录开始工作 |
| <img src="docs/images/screenshot-themes.png" width="410" alt="TTerm 主题与字体设置" /> | <img src="docs/images/screenshot-browse.png" width="410" alt="选择项目目录或最近使用的目录" /> |

## 适合谁

TTerm 尤其适合：

- 在 Windows 上把 Claude Code、Pi 等 CLI Agent 作为主要开发工具的开发者；
- 通过 SSH 长期进行 Linux 软件开发、部署和运维调试的开发者；
- 希望 AI 协助分析串口现场的嵌入式开发者；
- 主要使用中文与 CLI Agent 交流，受到 Windows IME 和 TUI 交互问题影响的开发者；
- 同时依赖本地 Shell、SSH 或串口，希望减少上下文搬运的人；
- 重视启动速度、资源占用和本地数据边界的终端用户。

如果你只需要英文 Shell 和基础命令执行，系统终端可能已经足够。TTerm 的价值集中在以 CLI Agent 为中心，并跨越本地、远程主机和设备现场的开发工作流。

## 下载

从 [Releases](https://github.com/rede97/tterm/releases/latest) 下载 Windows 安装包（NSIS / MSI）。

## 从源码构建

```sh
bun install
bun run tauri build
```

技术栈：Tauri v2（Rust）+ xterm.js。本地 WebSocket 回环传输终端数据。

测试与开发说明见[测试文档](docs/testing.md)。

## 许可

MIT
