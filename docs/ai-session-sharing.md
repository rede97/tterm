# AI Session Sharing (设计稿)

> 状态:**规划中**,尚未实现。本文档定义产品形态与 AI agent 接入协议。

TTerm 可以把任何一个终端会话(本地 shell / SSH / 串口)**实时共享**给一个 AI agent:AI 能看到终端的全部输出、能代替你敲键盘;你在自己的窗口里实时看到 AI 的每一步操作;随时一键切断,AI 立即失去所有访问权。

## 为什么这是不一样的做法

让 AI 操作终端,常见方案是让 AI 自己 spawn 一个 shell(无头、你看不见过程),或者截图 + OCR(慢、脆、丢上下文)。TTerm 的做法是**把真人终端的字节流直接分一路给 AI**:

- **你看得见** —— AI 的每次输入都走真实 PTY,回显在你的窗口里,和你自己敲键盘完全同一条渲染路径
- **上下文完整** —— AI 拿到的是原始字节流(含退出码、颜色、TUI 状态),不是截图猜测
- **权限收敛** —— 分享令牌只绑定单个会话,吊销即失效;hub 只监听 `127.0.0.1`,不暴露任何网络端口
- **随时切断** —— 点一下 tab 上的"共享中"角标,连接立刻被踢断,令牌作废

## 协议

分享建立在 TTerm 的统一 WebSocket hub 之上(进程内唯一监听端口,path 路由):

```
ws://127.0.0.1:<port>/pty/<session-id>?token=<share-token>
```

- `port` / `share-token` 由"分享会话"操作生成(右键 tab → Share with AI → 复制链接)
- 帧协议:**Binary 帧 = 原始 PTY 字节**;下行是终端输出,上行写入等同于键盘输入
- 分享令牌与主令牌分级:主令牌(TTerm 前端持有)全权;分享令牌限单会话,支持只读模式
- 吊销分享 → hub 向 AI 端发送 WS Close 帧并删除令牌,重连用旧令牌返回 403

## Agent 接入示例

### Python(`websockets` 库,~20 行)

```python
import asyncio, re, websockets

ANSI = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07")

async def pilot(url: str):
    async with websockets.connect(url) as ws:
        # 上行:发字节 = 敲键盘(\r = 回车)
        await ws.send(b"ls -la\r")
        # 下行:收 Binary 帧 = 终端输出(含 ANSI 转义,按需清洗)
        async for frame in ws:
            text = ANSI.sub(b"", frame).decode("utf-8", "replace")
            print(text, end="")

asyncio.run(pilot("ws://127.0.0.1:PORT/pty/tab-1?token=SHARE_TOKEN"))
```

### Node.js(`ws` 库,~20 行)

```js
import WebSocket from "ws";

const ANSI = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07/g;
const ws = new WebSocket("ws://127.0.0.1:PORT/pty/tab-1?token=SHARE_TOKEN");

ws.on("open", () => ws.send(Buffer.from("ls -la\r"))); // 上行 = 键盘输入
ws.on("message", (data) => {                            // 下行 = 终端输出
  process.stdout.write(data.toString("utf8").replace(ANSI, ""));
});
ws.on("close", () => console.log("share ended (revoked or session exited)"));
```

两个例子都能直接跑:不需要 SDK、不需要鉴权头(浏览器 WS 客户端不支持自定义头,所以令牌在 query 里)、不需要消息编解码层 —— 拿到 URL 的 5 分钟内就能让 agent 上线。

## 给 agent 开发者的注意点

- **输出是原始 PTY 字节**,含 ANSI 转义与全屏 TUI 重绘(vim/htop)。行式命令用上面的正则清洗即可;要精确还原屏幕状态,建议接一个 headless 终端解析库(Python 的 `pyte`、Node 的 `xterm-headless`)
- **上行是字节级键盘输入**:发 `b"q"` 就是按 q,发 `b"\x03"` 就是 Ctrl+C。没有"命令"概念,交互式程序自然可用
- **`\r` 不是 `\n`**:回车发 `\r`(终端行规约),串口会话按配置可能是 `\r\n`
- **收到 Close 帧**意味着:会话退出,或用户切断了分享 —— 两者都不应重试,旧令牌已作废
- **只读分享**(可选模式)下上行写入会被静默丢弃,适合"AI 看着、人来操作"的结对场景

## 安全模型

| 层 | 机制 |
|---|---|
| 网络面 | hub 只绑 `127.0.0.1`,本机以外不可达;云端 AI 无法直连,需本地 agent 桥接 |
| 令牌 | 分享令牌为一次性随机串,绑定**单个**会话,与 TTerm 前端主令牌隔离 |
| 权限 | 可选只读模式;上行写入与真人输入经同一把锁串行化,不会撕裂字节流 |
| 吊销 | 一键切断:删除令牌 + 向活跃连接发 Close;会话关闭/进程退出同样自动失效 |

## 实现路线(开发侧)

1. relay 注册表下行通道 mpsc → `tokio::sync::broadcast`(多订阅者)
2. hub 增加分享令牌表 + 握手回调两级鉴权(主令牌 / 分享令牌)
3. `pty_share_create` / `pty_share_revoke` 命令;吊销触发活跃连接 Close
4. 前端:tab 右键菜单 "Share with AI"、共享中角标、一键切断
5. 迭代项:只读模式、ANSI 清洗模式、分享链接二维码/剪贴板格式
