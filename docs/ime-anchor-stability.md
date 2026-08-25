# IME 候选窗锚定稳定性：高频重绘下的跳变问题

> 状态：问题确认 + beta 修复（v2.2.5-beta.1）。**真人输入法专项验收与后续计划见 `docs/backlog.md`（IME 节）**——本项未关。
> 关联：`docs/ime-composition.md`（Plan C 总体设计）、`src/util/imefreeze.ts`、`src/util/imebox.ts`。

## 1. 现象

- IME 候选窗在 composition 开始时位置正确，**约一拍后被移动到屏幕左上角（0,0）**；
- 浮动组合镜像（ImeBox）同步消失；
- 间歇出现，**稳定复现条件：在持续高频重绘的 Agent TUI（如 Codex/Claude）中输入中文**；
- 偶发出现 Windows 原生输入框（IME/TSF 回退自绘），但汉字始终能正常进入终端。

普通 shell 不复发：光标可见、buffer 安静、几何稳定。

## 2. 根因（代码级）

OS 候选窗位置完全由 xterm 隐藏 textarea 的 `left/top` 决定。当前实现有三条时序脆弱路径：

1. **锚定依赖瞬态几何**（`imefreeze.ts pxPos()`）：
   - `element.clientWidth/clientHeight` 在布局瞬变（resize、面板开合、隐藏 tab）时短暂为 0；
   - `cellDimensions()` 在渲染器重建瞬态可能返回 0 宽高；
   - `imeAnchorCell()` 在重绘中途帧找不到反色假光标（或误选同为反色的 spinner/进度条）。
   三者任一发生，`Math.max(0, …)` 钳制都会把结果算成 `(0,0)`。
2. **200ms re-anchor 把错误位置写实**（`imefreeze.ts` refreshTimer）：
   冻结设计的本意是 compositionstart 锚一次、全程不动（ImeBox 头注 *anti-drift core*）。re-anchor 间隔在安静 tab 无害，在高频重绘 tab 是把瞬态/错误位置定期写进 textarea 的泵——"开始正确、立刻跳走"正是 start 锚对、第一拍 re-anchor 写错。
3. **显示所有权随帧翻转**（`tab.ts refreshImeClasses()`）：
   `ime-mirror-on`（抑制 xterm composition-view 的 CSS class）每次 render 按当时的 `cursorHidden` 重算。Agent TUI 在输入区经常显隐光标 → composition 中途 mirror 与 xterm composition-view 的显示权翻转 → 时而镜像、时而原生框、时而消失。

Windows TSF/IMM32 双栈与 IME 厂商差异是触发面的放大器；**输入链路（textarea → xterm → PTY）始终完好**，所以汉字总能进终端——这是表现层问题，不是系统 bug，也不是输入链路 bug。

## 3. 修复（beta 范围，刻意保守）

1. **几何无效即跳过**：`pxPos()` 在 `clientWidth/clientHeight` 为 0（隐藏 tab、布局瞬变）或 cell 尺寸缺失/为 0 时返回 `null`——compositionstart 冻结与 200ms re-anchor 都跳过该拍，任何路径不再写 `(0,0)`。
2. **显示所有权在 composition 期间锁定**：`refreshImeClasses()` 在本 tab 有进行中的 composition（`imeBox.isComposing`）时不再翻转 `ime-mirror-on`，所有权以 compositionstart 时的判定为准，compositionend 后恢复随帧计算。

明确不做（留给后续版本）——清单与勾选用例见 `docs/backlog.md`：

- 反色扫描置信度（多反色格/扫描失败的锚点保持）；
- re-anchor 的默认开关策略重审（是否回归"单次锚定"）；
- 远端/多窗口场景的额外回归矩阵。

## 4. 验证

- 单元测试：0 尺寸/缺度量的瞬态拍断言 textarea 不被写 `(0,0)`；composition 期间 `ime-mirror-on` 不翻转；
- 既有基线：`bun run test`、`bun run lint`、`bun run build`、`cargo test`、`e2e/specs/ime.e2e.js` 全绿；
- **真人 IME 专项测试**（关闭 backlog 项之前必做）：见 `docs/backlog.md` 勾选清单。自动化不能代替 TSF。
