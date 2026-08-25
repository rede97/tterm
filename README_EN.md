<p align="center">
  <img src="https://raw.githubusercontent.com/rede97/tterm/main/src/assets/tterm.svg" width="128" alt="TTerm" />
</p>

<h1 align="center">TTerm</h1>

<p align="center">
  A Windows development terminal redesigned for CLI agents.<br/>
  Bring AI into live local, SSH, and serial sessions—with Chinese input and agent TUI interaction that actually work.
</p>

<p align="center">
  <a href="https://github.com/rede97/tterm/actions/workflows/ci.yml"><img src="https://github.com/rede97/tterm/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="https://github.com/rede97/tterm/releases/latest"><img src="https://img.shields.io/github/v/release/rede97/tterm" alt="Release" /></a>
  <a href="https://github.com/rede97/tterm/blob/main/LICENSE"><img src="https://img.shields.io/github/license/rede97/tterm" alt="License" /></a>
</p>

> [中文](README.md)

## The terminal is becoming part of the AI development environment

Once CLI agents join the workflow, the terminal is no longer just a command window. It carries code generation, builds, deployments, remote operations, logs, and human-agent collaboration. It also determines what the agent can see and how naturally the developer can take control.

Real development rarely stays inside one local shell. Linux development may happen mainly over SSH. Embedded development adds a live serial console. A local CLI agent may need to coordinate all of them. Today, the important context is often scattered across sessions and passed to AI through copied logs, screenshots, and repeated explanations.

Windows adds another overlooked problem for developers who communicate with agents in Chinese: when a TUI hides or moves the cursor, IME composition text and candidate windows can disappear or land far from the real input position. English-only users may never notice; CJK users encounter it throughout the day.

TTerm starts from four requirements:

- The terminal should be part of the CLI agent toolchain, not merely a container for it.
- AI should understand a live development session, not only pasted excerpts.
- Local shells, SSH hosts, and serial devices should be first-class contexts in one workflow.
- Chinese input and agent TUI display should feel stable and natural on Windows.

TTerm is not trying to reproduce a traditional terminal with more features. Its goal is to become the Windows development terminal used together with CLI agents. Remote Linux development, embedded debugging, and Chinese agent interaction are connected parts of that goal.

## Bring AI into the live development session

TTerm can share a running session with a local AI agent. The agent receives character-level terminal state rather than screenshots or OCR, allowing it to understand scroll regions, colors, cursor state, and TUI interfaces—and, when authorized, send input back to the session.

An agent can therefore:

- inspect builds, deployments, and running services on a remote Linux host;
- observe serial output for resets, errors, and state changes;
- read the full state of a local CLI tool or TUI;
- assist inside a session you can watch and revoke at any time.

The sharing service listens only on `127.0.0.1`. Right-click a session tab, choose **Share with AI**, and give the generated link to a local agent. See the [session sharing protocol](docs/ai-session-sharing.md) for details.

## Local, SSH, and serial are development contexts

Remote hosts and hardware devices are not add-ons in TTerm. They are environments a CLI agent may need to understand and operate.

### Remote Linux development

TTerm reads `~/.ssh/config`, turning existing hosts into ready-to-use profiles. Its built-in SSH client collects passwords and key passphrases in the tab (OpenSSH-style), confirms host keys in a dialog, and supports local, remote, and SOCKS5 forwarding. Short transport interruptions can reconnect without losing scrollback.

### Embedded and serial debugging

Serial sessions have tabs, history, connection state, and session controls just like local and SSH sessions.

- Automatic device discovery with USB VID/PID
- Live baud-rate switching
- Direct, local-echo, and line-editing input modes
- Configurable Enter and received-data newline handling
- Software/hardware flow control and RTS/CTS/DTR/DSR
- Automatic recovery after a device is reconnected
- Profiles for device-specific communication settings

## Optimized for agent TUIs and Chinese input

CLI agents make heavy use of full-screen refreshes, hidden cursors, complex scroll regions, and streaming output. TTerm treats these agent TUI behaviors as primary workloads rather than merely checking that ordinary shells run.

When an agent TUI hides the real cursor, Windows IMEs may lose the correct composition position. TTerm reconstructs the composition display near the terminal input point so Chinese input remains consistent across hidden-cursor TUIs, full-screen interfaces, and ordinary shells.

Chinese is the first priority. Japanese, Korean, and other CJK composition workflows will continue to be tested and improved.

## One window for the development environment

- **Local projects:** Windows Terminal profiles and shells launched directly in a selected directory
- **SSH:** existing OpenSSH configuration; passwords typed in the tab; host-key verification, keys, and port forwarding
- **Serial:** automatic discovery and named session profiles (input / newline modes; baud and flow stay with the link)
- **Session recovery:** silent reattachment after sleep or short transport interruptions
- **Low overhead:** Tauri + xterm.js, sub-second cold start, ~7 MB installer, and under 30 MB idle memory

| Terminal and agent session | Local, SSH, and serial entry points |
| :---: | :---: |
| <img src="docs/images/screenshot.png" width="410" alt="CLI AI agent running in TTerm" /> | <img src="docs/images/screenshot-profiles.png" width="410" alt="Local shells, SSH hosts, and serial devices" /> |
| Themes and fonts | Start from a project directory |
| <img src="docs/images/screenshot-themes.png" width="410" alt="TTerm theme and font settings" /> | <img src="docs/images/screenshot-browse.png" width="410" alt="Choose a project or recent directory" /> |

## Who it is for

TTerm is especially useful for developers who:

- use CLI agents such as Claude Code or Pi as primary development tools on Windows;
- develop, deploy, or debug Linux software mainly over SSH;
- want AI assistance while observing a live serial session;
- communicate with CLI agents mainly in Chinese;
- move frequently between local shells, remote hosts, and hardware devices;
- care about startup speed, low resource use, and local data boundaries.

If you only need an English shell for basic command execution, the system terminal may already be enough. TTerm focuses on agent-centered workflows that cross local machines, remote hosts, and device sessions.

## Download

Download the Windows installer (NSIS / MSI) from [Releases](https://github.com/rede97/tterm/releases/latest).

## Build from source

```sh
bun install
bun run tauri build
```

Stack: Tauri v2 (Rust) + xterm.js. Terminal data is carried over a local WebSocket loopback.

See [testing documentation](docs/testing.md) for development and test instructions.

## License

MIT
