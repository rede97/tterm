# IME 悬浮组合镜像 — 设计定稿

隐藏光标 TUI（pi / Claude Code 等 agent 界面）中的中文输入方案。本文档为
最终设计稿，合并原 Plan C 设计文档与 Plan A/B 否决复盘。

## 问题

agent TUI 隐藏硬件光标（`ESC[?25l`），把真光标停在行尾或角落，自己绘制假
光标。xterm 的 IME 支持假设"真光标即输入点"，于是：

- xterm 的 `.composition-view`（拼音组合串显示）按**真光标坐标**渲染且
  **无边界钳制** → 拼音被挤到窗口最右侧并超出窗口；
- 系统 IME 候选窗跟随隐藏 textarea 的位置，同样落在真光标处。

## 架构

```
用户打字（IME 激活）
   │
   ▼
xterm 隐藏 textarea（持有焦点，组合发生地）
   │  compositionstart / update / end（标准 DOM 事件）
   ▼
FloatingCompositionMirror（纯展示 DOM）   ←── 锚点：_imeAnchorCell()
   │                                          （inverse 扫描 + 众数过滤器）
   │ 组合期间：
   │  · 隐藏 xterm .composition-view（避免双份）
   │  · textarea Proxy 冻结位置（系统候选窗定位）
   ▼
compositionend → 提交文本走 xterm 原生通路 → PTY（零改动）
   │
   ▼
镜像立即消失（上屏即隐）
```

### 三条不可违背的边界

1. **纯展示**：镜像只读 composition 事件，永远不获得焦点
   （`pointer-events: none`、不可 tab 聚焦），永远不向终端注入任何字符。
   提交路径一行代码都不碰。
2. **定位链复用**：锚点 = `_imeAnchorCell()`（inverse 扫描 → 众数过滤器回退），
   候选窗定位 = `_patchImeFreeze()` Proxy。镜像只是同一个锚点的第二个消费者。
3. **条件抑制**：只在光标隐藏时抑制 `.composition-view`（光标可见的普通 shell
   保持 xterm 原生内联组合，零回归）。

## 定稿行为（真实输入法实测选定）

- 镜像底部与锚点行下沿齐平（inline 观感），多行折行向上生长；
- 上屏即隐（停留 0ms + 淡出 0ms）；Esc 取消立即消失；
- 半透明 0.8、无边框；
- 启用模式三档 `auto`（仅光标隐藏时）/ `always` / `off`
  （`setImeMirrorMode`，持久化 localStorage），默认 `auto`；
- 锚定一次防漂移；每次 update 重新钳制，镜像永远完整处于终端可视区内。

## 仍然正确、不得破坏的既有组件

| 组件 | 作用 |
|---|---|
| `_imeAnchorCell`（inverse 单元格扫描） | 光标隐藏时在视口中找假光标；找不到回退到过滤器 |
| `CursorPositionFilter`（众数/稳定运行） | 快速移动/动画场景下取最稳定的光标位置，防候选窗飘动；tab 激活即开始采样（天然预热，解决冷启动首锚偏差） |
| `_patchImeFreeze`（textarea style Proxy） | 组合期间把隐藏 textarea 冻结在锚点 → **系统候选窗位置正确** |

## 被否决的方案（保留结论，避免重走弯路）

### Plan A：抑制 composition-view —— 否决

光标隐藏时用 CSS 隐藏 xterm 的 composition-view，假设拼音由系统候选窗呈现。
**根本缺陷（真实输入法实测）**：现代 TSF 应用（Chromium/WebView2）向 IME 声明
"我自己渲染组合串"，微软拼音的候选窗**只显示候选词，不回显拼音**。隐藏
composition-view 后拼音在屏幕上彻底消失。抑制得越干净，问题越完整。
结论：只做减法的方案不成立；组合显示是必须有承担者的功能。（该机制后来作为
Plan C 的一部分回归 —— 抑制双份显示，拼音由镜像承担。）

### Plan B：直接钉住 textarea / 重定位 composition-view —— 否决

定时器直接把隐藏 textarea 设置到计算锚点（不用 Proxy）。**根本缺陷（探针
实测）**：xterm 在每次渲染/光标移动时都会把 textarea 重设回真光标，钉入在
两次刷新之间必然被覆盖。与 xterm 的内部行为正面竞争赢不了；Proxy 之所以
有效，正因为它拦截的是写入本身而不是事后覆盖。同理 composition-view 由
xterm 按 buffer 坐标定位且不支持钳制 —— 每多一个拦截点，就多一处 xterm
升级时的碎裂面。结论：方向本身错误 —— 在别人的渲染管线里抢所有权。

## 关键根因：1px textarea 杀死真实组合（实施期实测）

镜像上线后真机出现"只显示第一个字母就被打断，候选窗跳到左上角"。根因：
xterm 的 `CompositionHelper.updateCompositionElements()` 用
`.composition-view` 的 `getBoundingClientRect()` 推导 textarea 尺寸；抑制
CSS（`display:none`）使 rect 全 0，**textarea 被压成 1px×1px、lineHeight
0px**（xterm 源码注释自述 "Ensure the text area is at least 1x1, otherwise
certain IMEs may break"）。真实 TSF 组合期间文本寄存在 textarea 内，1px 高
的编辑框让 IME 在首个 update 后中止组合；冻结随之解除，候选窗跳左上角。

**修复**：冻结 Proxy 除 width/left/top 外同步钳住 `height`/`lineHeight`
（各取一个完整单元格尺寸），组合期间 textarea 永远是 1×1 完整格子。辅以
镜像布局读取移出事件派发（rAF）。

## 验证方法论（最终裁决链）

- **真实输入法的人工验证是最终裁决**。合成事件（派发 CompositionEvent）
  与 CDP `Input.imeSetComposition` 都与真实 TSF 路径有差异 —— Plan A 的
  致命缺陷和 1px textarea 根因都只有真实 IME 能暴露（合成事件不经过 TSF，
  textarea 尺寸无关紧要）。
- **e2e spec 守回归**（`bun run test:e2e:ime`）：正常 shell 内联组合 + 提交
  入 PTY、隐藏光标检测、Proxy 锚点冻结、镜像 DOM 行为。
- **ConPTY 只在备选屏（alt screen）转发光标可见性** —— 这是构造确定性
  隐藏光标 fixture（`ESC[?1049h` 包裹）的关键知识，已写入 spec 注释。
- 开发期诊断：`__tterm.imeTrace(on)`、
  `__tterm.imeDebug({suppress, reanchor})`。
