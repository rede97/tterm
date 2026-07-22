# 串口（Serial）会话实现计划

状态：已实现（冒烟测试通过），真机验证待硬件环境
日期：2025-07-22

## 目标

在新建标签菜单中点击串口设备即可打开串口终端会话，支持常用参数配置（波特率等），复用现有 WebSocket 中继与标签架构。

## 架构设计

### 关键决策：串口 I/O 直连 WebSocket，不走 PTY/帧协议

串口不是 PTY（无行列概念、无进程）。旧 `pty_write` 管道帧协议已随死代码清理删除。
串口会话复用与 PTY 完全相同的中继模型：

```
xterm.js <─AttachAddon─> ws://127.0.0.1:<port> <─tokio─> serial port (COMx)
```

- **输入**：xterm → WS 二进制帧 → 串口 write（与 PTY 一致，无需 `pty_write`）
- **输出**：串口 read（100ms 超时轮询）→ mpsc channel → WS → xterm
- **resize**：串口无行列概念，前端 `pty_resize` 对串口 id 静默 no-op
- **close**：前端 `closeTab` 统一调 `pty_kill`，后端同时检查 PTY 与串口会话表

### 后端（`src-tauri/src/lib.rs`）

新增依赖：`serialport = "4"`（打开/读写串口；枚举继续用 `serial_enumerator`）。

```
AppState += serial_sessions: Mutex<HashMap<String, SerialSession>>
SerialSession { cancel: Arc<AtomicBool> }
```

| 命令 | 参数 | 说明 |
|---|---|---|
| `serial_spawn` | `port_name`, `baud_rate`, `data_bits`, `parity`, `stop_bits`, `flow_control` | 打开串口 + WS 中继，返回 `{id, port}`（与 `pty_spawn` 同构） |
| `pty_kill`（扩展） | `id` | 同时检查串口会话表：置 cancel 标志并移除 |

重构：`spawn_pty` 中的 WS 中继提取为 `start_ws_relay(reader, writer, cancel)`，
PTY 与串口共用；串口读循环对超时错误继续轮询并检查 cancel 标志。

参数映射为纯函数（可单测）：`map_data_bits(u8)`、`map_parity(&str)`、
`map_stop_bits(u8)`、`map_flow_control(&str)`；`open_serial()` 封装 builder 链。

### 前端

| 文件 | 改动 |
|---|---|
| `types.ts` | `TabType` 增加 `"serial"` |
| `profiles.ts` | `configSerialBaud`（默认 115200）配置持久化 |
| `tabmanager.ts` | `createSerialTab(port: SerialPort)`：invoke `serial_spawn`（8N1、无流控 + 配置波特率），标签名为端口名（COM3） |
| `profilemenu.ts` | 串口项从禁用态改为可点击，调用 `createSerialTab` |
| `settings.ts` | General 面板新增串口默认波特率选择（9600~921600） |

### 会话参数（v1 范围）

- 波特率：设置面板全局默认值（115200 覆盖 90% 场景）
- 其余固定 8N1、无流控 —— 每端口独立参数配置留待 v2

## 测试策略（无硬件环境）

### 现在做：冒烟测试

1. **Rust 单测**：参数映射函数（合法/非法值）；`open_serial("\\\\.\\COM99")` 等不存在端口**返回 Err 而非 panic**
2. **Vitest**：菜单串口项可点击；点击后以正确参数触发 `serial_spawn`
3. **E2E 回归**：现有 4 例不受影响（串口会话本身需硬件，不做 E2E）

### 有硬件后：真机验证清单

- [ ] USB 转串口（CH340/FTDI/CP210x）插入后菜单即时出现（热插拔重新枚举）
- [ ] 打开会话，短接 TX-RX 自环：键盘输入即时回显
- [ ] 对接真实设备（开发板/交换机 console）：115200 8N1 双向收发正常
- [ ] 波特率不匹配时表现为乱码而非卡死；修改设置后新会话生效
- [ ] 会话打开期间拔掉设备：读循环退出、标签可正常关闭、无进程残留
- [ ] 同一端口被占用（如被其他程序打开）时错误信息可读
- [ ] 关闭标签后端口释放，可被其他程序立即打开

## 后续迭代（不在本期）

- 每端口参数记忆与会话内参数修改
- DTR/RTS 控制信号、break 发送
- HEX 显示模式、时间戳、日志录制（与"会话录制"路线图项合并设计）
