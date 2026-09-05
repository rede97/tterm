# Backlog — 待办与待验

工作项与已知未闭合问题。定稿设计仍在各自文档；这里只跟踪**还要专门做的事**。

## IME — 候选窗锚定（需真人输入法专项测试）

背景定稿：`docs/ime-composition.md`。  
v2.2.5-beta.1 已上线保守修复的细节：`docs/ime-anchor-stability.md`。

合成 CompositionEvent / e2e **不能**代替真实 TSF。本项关闭前必须用人手在 Windows 上用真实输入法验收。

### 已确认的问题（beta 前）

- 在**持续高频重绘**的 Agent TUI（Codex / Claude Code 等）里输入中文时：
  - 候选窗开始位置正确，约一拍后跳到屏幕左上角 `(0,0)`；
  - 浮动组合镜像（ImeBox）同步消失；
  - 偶发出现 Windows 原生输入框（IME/TSF 回退自绘）；
  - **汉字仍能进终端**（表现层问题，不是输入链路断）。
- 普通 shell（光标可见、buffer 安静）不复发。

### 已确认的问题（仍待修）

- ~~**组词中途失焦，镜像不消失**~~：**已修（待真人验收）** — `ImeBox` 在 textarea `blur` 后延后一拍隐藏；空 `compositionend`（取消）立即清掉 preedit，不再走 linger。`imefreeze` 同步在 blur 时解除冻结，避免无 `compositionend` 时锚点钉死。自动化：`tests/imebox.test.ts`、`tests/imefreeze.test.ts`。

### Beta 已做的保守修复（代码已合，验收未关）

- 几何无效（元素 0 尺寸、缺 cell 度量）时**跳过**该拍，不再把 textarea 钳到 `(0,0)`。
- composition 期间锁定 `ime-mirror-on` 显示所有权，不随 TUI 闪烁光标翻转。

### 明确留给后续的计划（beta 未做）

- [ ] 反色扫描置信度：多反色格 / 扫描失败时保持上一锚点，避免误选 spinner。
- [ ] 重审 200ms re-anchor 默认策略（是否回到 compositionstart 单次锚定）。
- [ ] 远端 SSH / 多窗口场景的额外回归矩阵。
- [x] 组词中途失焦时强制隐藏镜像（textarea `blur` / composition 取消路径 + OS 窗口级 `blur` 立即清理冻结与镜像）— 代码已合，待真人 IME 勾选确认。

### 专项测试清单（关闭本项前勾完）

环境：Windows + WebView2；至少微软拼音；有条件再测搜狗 / 其他 TSF。

- [ ] 普通 shell（光标可见）：拼音镜像或原生 inline、候选窗位置、上屏正确。
- [ ] 隐藏光标 fixture / Agent TUI 备选屏：镜像出现在输入点附近，候选窗不跟真光标跑到角落。
- [ ] **持续刷新的 Agent TUI 中连续组词**：候选窗是否仍跳 `(0,0)`、镜像是否消失、是否冒出原生框。
- [ ] composition 中途：resize、切 tab、开关 quick panel / 设置。
- [ ] **组词中途失焦**：点到标签栏 / 设置 / 其他窗口后，镜像应立即消失，无需再打字。（代码已修，请重点验）
- [ ] 点选 IME 候选词时镜像不应被误杀（blur 延后一拍，focus/compositionend 可取消隐藏）。
- [ ] Esc 取消组词；上屏即隐。
- [ ] 模式 `auto` / `always` / `off`（`setImeMirrorMode`）。
- [ ] 若仍复发：控制台 `__tterm.imeDebug({ reanchor: false })`、`__tterm.imeTrace(true)`，记下场景（输出风暴 / resize / 切 tab）与 trace。

自动化基线（不替代上表）：`bun run test:e2e:ime`、相关 Vitest（`imefreeze` / `ime-ownership`）。

### 相关提交 / 文档

- `3671fa2` — fix(ime): stabilize candidate anchor under active refresh  
- CHANGELOG v2.2.5-1（beta 1）IME 条目  
- `docs/ime-anchor-stability.md` — 根因与 beta 范围说明  

---

## 其他（占位）

串口 / SSH / 产品交互等新挂账写在本节下方；不要把已定稿设计再抄一遍。

### Share `/lines?since=` 吃不到首屏写入

- [x] 新会话（尤其串口）xterm 一出生 `buffer.length === rows`（全是空填充行）。第一帧 `recordShareSeq` 就把 append log 从 seed `total:0` 推到 `total:rows`。之后 AT/`OK` 写进这些空行，`total` 不变，`since` 认为无追加。
- 实锤：`/screen` 已是 `["AT","","","OK",…]`，同一 `seq` 的 `GET /lines?since=<该 seq>` 返回 `{ from: rows, count: 0, lines: [] }`。官方 prompt 让 agent 用 `/screen` 的 seq 配 `since=`，首屏会漏光。
- `since=0` 仍能读到（seed），所以不是「完全没记录」，是「用 /screen seq 跟踪」这条文档路径断了。
- 文档把「只覆盖追加、原地改写看 /screen」写进了 `docs/ai-session-sharing.md`；空填充行被写成字不是进度条那种改写，agent 会漏。
- **已修**：`src/terminal/sharelines.ts` 用内容水位（最后非空行 + 光标空行）记 append log，空首帧不再从 0 跳到 `rows`；写入空填充行会推高水位。`tests/sharelines.test.ts` 覆盖空首帧 `since=1` 与交错填入。
- 演示脚本 `drafts/demo/share.mjs` 已改盯 `/screen` 新 `OK`，不依赖 `since`。
