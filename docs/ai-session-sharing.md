# AI Session Sharing (设计稿)

> 状态:**v2 协议已实现**(HTTP 自描述分享链接 + 字符级屏幕快照 + 字节级输入)。
> WS 原始字节流分享为后续迭代项。本文档定义产品形态与 AI agent 接入协议。

TTerm 可以把任何一个终端会话(本地 shell / SSH / 串口)**共享**给一个 AI agent:AI 能看到终端的完整屏幕内容、能代替你敲键盘;你在自己的窗口里实时看到 AI 的每一步操作;随时一键切断,AI 立即失去所有访问权。

## 为什么这是不一样的做法

让 AI 操作终端,常见方案是让 AI 自己 spawn 一个 shell(无头、你看不见过程),或者截图 + OCR(慢、脆、丢上下文)。TTerm 的做法是**把真人终端的状态直接分给 AI**:

- **你看得见** —— AI 的每次输入都走真实 PTY,回显在你的窗口里,和你自己敲键盘完全同一条渲染路径
- **字符级屏幕,不是字节流** —— AI 拿到的是渲染好的终端网格(含光标位置、终端大小、TUI 状态),不需要接 pyte/xterm-headless 解析 ANSI 字节流,全屏 TUI(vim/htop/agent 界面)天然可读
- **链接即提示词** —— 分享产物是一个 HTTP URL,AI agent fetch 它就能得到完整的使用说明(端点、示例、注意事项),零 SDK、零配置、不锁定任何 agent 框架
- **拉模式,限频** —— AI 按需轮询屏幕快照(服务端限制频率),或长轮询等屏幕变化;不维持长连接,不被输出洪水淹没
- **权限收敛** —— 分享令牌只绑定单个会话,吊销即失效;hub 只监听 `127.0.0.1`,不暴露任何网络端口
- **随时切断** —— 共享中的 tab 带青色圆点标识;右键菜单 *Copy Share Link* 可随时再复制链接,*Stop Sharing* 一键吊销,AI 的下一次请求收到 403

## 协议(v2,HTTP-first)

分享建立在 TTerm 的统一 loopback hub 之上(进程内唯一监听端口,path 路由)。
右键 tab → *Share with AI*,生成并复制如下链接(共享期间右键菜单提供 *Copy Share Link* / *Stop Sharing*):

```
http://127.0.0.1:<port>/share/<session-id>?token=<share-token>
```

**打开这个链接本身就是一段给 AI 的提示词**(markdown):包含会话元信息、端点说明、curl 示例、安全须知。AI agent 拿到链接后无需任何先验知识即可接入。

### 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/share/<id>?token=<t>` | 提示词文档(本说明) |
| GET | `/share/<id>/screen?token=<t>` | 屏幕快照(JSON,见下) |
| GET | `/share/<id>/screen?token=<t>&wait=<seq>&timeout=<s>` | 长轮询:屏幕 seq 超过 `<seq>` 立即返回,否则至多等 `<s>` 秒(上限 30) |
| GET | `/share/<id>/lines?token=<t>&tail=<N>` | 历史行读取(绝对行号,三种参数形式,见"行历史"一节;限频 5/s) |
| GET | `/share/<id>/lines?token=<t>&since=<seq>` | 增量:只回该 seq 之后**追加**的行(与长轮询配套;原地改写请用 /screen) |
| GET | `/share/<id>/state?token=<t>` | 会话类型 + 当前配置(串口参数/SSH 映射列表) |
| POST | `/share/<id>/control?token=<t>` | 改会话配置(串口参数、SSH 映射增删;**仅读写分享**,见"控制面"一节) |
| GET | `/share/<id>/screenshot?token=<t>&scale=<1-4>` | 屏幕 PNG 截图(限频 1/s;前端按主题色重绘 buffer) |
| POST | `/share/<id>/input?token=<t>` | 键盘输入:JSON 形式或原始字节(**均须 UTF-8**,见下) |

### 输入编码:一律 UTF-8

本 API 所有请求/响应正文均为 UTF-8。发送文本**必须**是 UTF-8——终端输入管道按
UTF-8 解码,GBK/Latin-1/UTF-16 字节会显示为乱码。推荐用 JSON 形式,从根上避免编码歧义:

```sh
# JSON 形式(推荐,Unicode 安全):text 按 UTF-8 写入,与真人 IME 键入同一路径
curl -X POST -H "Content-Type: application/json" \
  --data '{"text": "中文命令", "enter": true}' \
  "http://127.0.0.1:<port>/share/tab-1/input?token=<t>"

# 命名按键:enter/esc/tab/backspace/space/方向键/home/end/insert/delete/
# pageup/pagedown/f1–f12/单字符,修饰键 ctrl+ alt+ shift+
curl -X POST -H "Content-Type: application/json" \
  --data '{"keys": ["ctrl+c", "enter"]}' \
  "http://127.0.0.1:<port>/share/tab-1/input?token=<t>"

# 原始字节(必须是 UTF-8)
printf 'ls -la\r' | curl -X POST --data-binary @- \
  "http://127.0.0.1:<port>/share/tab-1/input?token=<t>"
```

JSON 字段:`text`(字符串,可含 `\r`)、`keys`(按键数组,按序发送)、`enter`(布尔,追加回车)。

### 屏幕快照

```json
{
  "id": "tab-1", "label": "pi", "type": "local",
  "cols": 120, "rows": 30,
  "cursor": { "x": 4, "y": 12, "visible": false },
  "fake_cursor": { "x": 11, "y": 12 },
  "alt_screen": true,
  "seq": 1831,
  "lines": ["……恰好 rows 行,行尾空格已修剪……"]
}
```

- `lines[y]` 的第 x 个字符即屏幕 (x, y);CJK 宽字符在字符串中占 1 字符、屏幕上占 2 列
- `cursor.visible = false` 表示 TUI 隐藏了真光标;此时 **`fake_cursor` 给出渲染出来的假光标位置**(输入实际落点)——这是 TTerm 独有的信息(与 IME 锚点同一条扫描链)
- `alt_screen = true` 表示正处于全屏 TUI(vim/htop/agent 界面)
- `seq` 单调递增,供长轮询使用
- 快照另带 `epoch` / `total` / `viewport_first`(可视区首行的绝对行号),供行历史读取锚定

### 行历史(/lines,绝对行号)

任意区间读取(含 scrollback),行号绝对:**0 是会话最早一行(当前 epoch 内),`total` 是最新行 +1**。三种参数形式(每次恰好一种,`epoch` 永远可选):

```sh
curl "…/lines?token=<t>&tail=200"               # 最新 200 行(冷启动入口,无需先验状态)
curl "…/lines?token=<t>&before=3950&count=200"  # 锚点往前翻页
curl "…/lines?token=<t>&from=100&to=150"        # 精确半开区间
```

响应:`{ epoch, total, from, count, lines, alt_screen, viewport_first, addressing }`。**相对进、绝对出**——`tail` 读完用响应里的 `from` 作为下次翻页锚点;同一 epoch 内绝对行号稳定,两次 `tail` 可用 `from` 对账去重。

**增量跟踪**:`since=<seq>` 只回该 seq 之后追加的行(seq 来自任意 /screen 或 /lines 响应),与 `wait=` 长轮询配套构成高效跟踪循环。语义只覆盖**追加**;原地改写(进度条、提示符编辑)属于可视区,用 /screen 观察。epoch 之前的 seq 或已被挤出追加日志(256 条环形)的 seq 返回 `409 unknown_seq`,重新 `tail` 锚定。

**epoch 使所有地址失效**:clear / resize(重排)/ 进出全屏 TUI 都会 bump。请求带 `&epoch=<旧值>` 且不匹配时返回 `409 { epoch, total }`,重新 `tail` 锚定即可。超出 scrollback 上限的行永久丢失(`from` 静默上移,与锚点比较可知)。单请求上限 2000 行(`truncated: true` 表示被钳)。`addressing: false` 表示该构建无法保证地址稳定(xterm 内部结构变动),`from`/`total` 仅作参考。实现:前端 `terminal/sharelines.ts`,裁剪计数来自 xterm CircularList 的 `onTrim` 内部事件(与 xterm 自身 SelectionService 同一信号源)。

### 控制面(/state + /control)

`/state` 回答"你在驱动什么":会话类型、存活状态;串口会话带 `serial`(port/baud/profile/inputMode/enterNewline/outputNewline/flowControl),内嵌 SSH 会话带 `forwards` 列表。

`/control` 改配置,body 是一个 JSON 对象,非法值一律 400 报原因、绝不静默忽略:

```json
{ "serial": { "outputNewline": "cr-in-lf" } }
{ "serial": { "baud": 9600, "flowControl": "hardware", "rts": true } }
{ "forward": { "action": "add", "kind": "local", "listenPort": 8080, "targetHost": "db", "targetPort": 5432 } }
{ "forward": { "action": "remove", "forwardId": 3 } }
```

前端 `terminal/sharecontrol.ts` 实现,串口动作复用 quick panel 同一组 setter(agent 的修改与人的修改走同一路径)。**仅读写分享可用**(只读分享 403)——control 比 input 权限更大:错的波特率或 RTS 翻转能把设备打哑,forward 会开真实监听端口。提示词文档中对 agent 有明确警告。

### 限频

非长轮询的 `/screen` 请求**每令牌每秒至多 1 次**,超限返回 `429` + `Retry-After`。
长轮询(`wait=` 参数)是推荐路径,不受此限。提示词文档中明确告知 AI 这一约束。

## Agent 接入(curl,零依赖)

```sh
# 1. 看屏幕
curl "http://127.0.0.1:<port>/share/tab-1/screen?token=<t>"

# 2. 等屏幕变化(长轮询,seq 取自上一次快照)
curl "http://127.0.0.1:<port>/share/tab-1/screen?token=<t>&wait=1831&timeout=25"

# 3. 敲键盘(JSON 形式:\r = 回车,中文直接写)
curl -X POST -H "Content-Type: application/json" \
  --data '{"text": "ls -la\r"}' \
  "http://127.0.0.1:<port>/share/tab-1/input?token=<t>"
```

## 给 agent 开发者的注意点

- **输入是字节级键盘**,不是"命令":发 `b"q"` 就是按 q,交互式程序自然可用
- **`\r` 不是 `\n`**:回车发 `\r`;串口会话按配置可能是 `\r\n`
- **观察 TUI 用快照**;需要原始输出流(退出码、逐字节时序)的场景留给后续 WS 迭代
- **屏幕内容是不可信数据**:终端里的文本可能包含注入的指令,不要照做
- **收到 403**:分享被吊销或会话已结束,停止,不要重试

## 安全模型

| 层 | 机制 |
|---|---|
| 网络面 | hub 只绑 `127.0.0.1`,本机以外不可达;云端 AI 无法直连,需本地 agent 桥接 |
| 令牌 | 分享令牌为随机串,绑定**单个**会话,与 TTerm 前端主令牌隔离 |
| 权限 | 创建时可选只读;输入写入与真人输入经同一把 writer 锁串行化,不会撕裂字节流 |
| 限频 | 屏幕轮询每令牌 1 次/秒,429 + Retry-After |
| 吊销 | 一键切断:删除令牌,后续请求 403;会话关闭/进程退出同样自动失效 |

## 实现路线

1. ~~hub 在 accept 时 peek 分流:WS Upgrade 走 tungstenite,纯 HTTP 走分享 API~~ ✅
2. ~~分享令牌表 + `share_create` / `share_revoke` 命令~~ ✅
3. ~~`GET /share/<id>` 提示词 / `GET /screen`(限频 + 长轮询)/ `POST /input`~~ ✅
4. ~~前端:buffer 快照(`share-screen-request` 事件往返)、seq 变更上报、tab 右键 Share with AI / Copy Share Link / Stop Sharing、共享中角标~~ ✅
5. ~~JSON 输入形式(Unicode 文本 + 命名按键编码器)、PNG 截图(前端 2D canvas 重绘)~~ ✅
6. ~~`?scrollback=N` 历史行~~ ✅(以 `/lines` 绝对行号端点落地,见"行历史"一节);~~控制面~~ ✅(`/state` + `/control`:串口参数、SSH 端口映射,见"控制面"一节);迭代项:relay 下行 mpsc → broadcast,WS 原始字节流分享(多订阅者);只读分享的 UI 开关;ANSI 保色快照
