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

### Beta 已做的保守修复（代码已合，验收未关）

- 几何无效（元素 0 尺寸、缺 cell 度量）时**跳过**该拍，不再把 textarea 钳到 `(0,0)`。
- composition 期间锁定 `ime-mirror-on` 显示所有权，不随 TUI 闪烁光标翻转。

### 明确留给后续的计划（beta 未做）

- [ ] 反色扫描置信度：多反色格 / 扫描失败时保持上一锚点，避免误选 spinner。
- [ ] 重审 200ms re-anchor 默认策略（是否回到 compositionstart 单次锚定）。
- [ ] 远端 SSH / 多窗口场景的额外回归矩阵。

### 专项测试清单（关闭本项前勾完）

环境：Windows + WebView2；至少微软拼音；有条件再测搜狗 / 其他 TSF。

- [ ] 普通 shell（光标可见）：拼音镜像或原生 inline、候选窗位置、上屏正确。
- [ ] 隐藏光标 fixture / Agent TUI 备选屏：镜像出现在输入点附近，候选窗不跟真光标跑到角落。
- [ ] **持续刷新的 Agent TUI 中连续组词**：候选窗是否仍跳 `(0,0)`、镜像是否消失、是否冒出原生框。
- [ ] composition 中途：resize、切 tab、开关 quick panel / 设置。
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
