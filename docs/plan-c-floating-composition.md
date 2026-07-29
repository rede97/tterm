# Plan C:悬浮组合镜像(Floating Composition Mirror)

> 前置阅读:`docs/bugfix-ime-hidden-cursor.md`(问题定义 + Plan A/B 否决依据)
> 状态:**已完成**(M1/M2 通过,M3 视觉定稿,真实输入法实测确认)
>
> 定稿行为(实测选定):镜像底部与锚点行下沿齐平(inline),多行折行向上生长;
> 上屏即隐(停留 0ms + 淡出 0ms);Esc 取消立即消失;半透明 0.8、无边框。
> 启用模式三档 `auto` / `always` / `off`(`setImeMirrorMode`,持久化
> localStorage),**测试期默认 `always`**,发版前回落 `auto`。
> M2 关键根因(1px textarea 杀死真实组合)已记入 bugfix 文档。

## 目标与非目标

**目标**:光标隐藏的 TUI(pi/claude)中输入中文时,拼音组合串**内联可见**于假光标旁;
组合显示完全由浏览器原生机制承担,不修改 xterm 源码,不触碰输入路径。

**非目标(本期)**:悬浮框美化、动效调优、主题化、设置项 —— 全部放到最后的里程碑。
功能正确优先,外观是最后一层皮。

## 架构

```
用户打字(IME 激活)
   │
   ▼
xterm 隐藏 textarea(持有焦点,组合发生地)
   │  compositionstart / update / end (标准 DOM 事件)
   ▼
FloatingCompositionMirror(纯展示 DOM,新增)   ←── 锚点:_imeAnchorCell()
   │                                             (inverse 扫描 + 众数过滤器,既有)
   │ 组合期间:
   │  · 隐藏 xterm .composition-view(避免双份)
   │  · textarea Proxy 冻结位置(系统候选窗定位,既有)
   ▼
compositionend → 提交文本走 xterm 原生通路 → PTY(零改动)
   │
   ▼
镜像短暂停留 → 淡出
```

### 三条不可违背的边界

1. **纯展示**:镜像只读 composition 事件,永远不获得焦点(`pointer-events: none`、
   不可 tab 聚焦),永远不向终端注入任何字符。提交路径一行代码都不碰。
2. **定位链复用**:锚点 = `_imeAnchorCell()`(inverse 扫描 → 众数过滤器回退),
   候选窗定位 = `_patchImeFreeze()` Proxy。这两个已验证组件原样保留,镜像只是
   同一个锚点的第二个消费者。
3. **条件抑制**:只在光标隐藏时抑制 `.composition-view`(光标可见的普通 shell
   保持 xterm 原生内联组合,零回归)。抑制是 C 的组成部分,不是独立方案。

### 组件职责

| 组件 | 职责 | 新增/既有 |
|---|---|---|
| `FloatingCompositionMirror` | 镜像组合串;定位、钳制、折行、淡出 | 新增(`src/terminal/` 或 `src/util/`) |
| `TerminalTab` 接线 | 创建镜像、事件转发、class 开关、销毁 | 改动 |
| CSS | 镜像样式(先素版)+ `.cursor-hidden` 抑制规则 | 改动 |
| `_imeAnchorCell` / `CursorPositionFilter` / `_patchImeFreeze` | 锚点与候选窗定位 | **不动** |

### 行为规约(功能验收的最小集合)

1. 光标隐藏 + compositionstart → 镜像出现在锚点(只锚定一次,防漂移)
2. compositionupdate → 镜像文本同步;每次更新重新钳制(文本变长不出界)
3. 折行:超过 `max-width` 自动换行;镜像永远完整处于终端可视区内
4. compositionend → 停留 ~400ms → 淡出(~250ms)→ 移除内容
5. 组合中途光标移动/内容滚动 → 镜像位置不漂移
6. 光标可见时(普通 shell)→ 镜像不出现,xterm 原生内联组合照旧
7. 提交的中文真实到达 PTY(既有测试已覆盖,保持)

## 测试策略(三层,含系统级真实 IME 评估)

### L1 合成事件(CI,已有)— 事件链与 DOM 行为

现行 `e2e/specs/ime.e2e.js`(派发 CompositionEvent)。能验证:事件接线、class 开关、
抑制规则、钳制逻辑、Proxy 冻结。**局限**:你说的对 —— 这更像"中文直接注入",
不经过任何真实 IME 管线。

### L2 浏览器级(CDP `Input.imeSetComposition`)— Chromium 真实组合管线

Chromium 原生走 compositionstart/update/beforeinput/input/compositionend 全流程,
比 L1 真实一层。**但**:tauri-driver 不透传 `/goog/cdp` 端点(实测 404),wdio 里用不了;
只能作为独立 CDP 脚本存在。不经过 TSF,仍无系统候选窗。

### L3 系统级(真实 TSF IME)— 最终验收,需要系统 API

只有 L3 能验证:候选窗位置、拼音真实可见性、上屏结果。候选方案评估:

| 方案 | 原理 | 成本 | 可靠性风险 |
|---|---|---|---|
| **a. SendInput + 窗口前置 + UIA/截图回读**(推荐) | PowerShell/Node 注入真实按键 → 微软拼音真实组合;CDP 读镜像 DOM,UIA 或屏幕截图验证候选窗 | 中(独立脚本 ~150 行) | 前台锁定(需 AttachThreadInput)、需确保中文 IME 激活(检测/切换输入法)、截图判读 |
| b. WinAppDriver/Appium | 正经的 OS 级 UI 自动化框架 | 高(新依赖 + 服务) | 引入整套生态,过重 |
| c. 人工验证矩阵 | 用户在 pi/claude/普通 shell 实测 | 零 | 不可持续,但每次发版前成本低 |

**推荐组合**:L1 守 CI 回归;L3(a) 做成 `scripts/ime-real-test` 独立脚本(不入 CI 门禁,
按需运行),系统 API 负责触发真实 IME;L3(c) 作为发版前人工确认。L2 视需要保留为
调试手段。

L3(a) 的关键技术点:前置窗口用 `AttachThreadInput` 绕过前台锁;输入法激活用
`ImmGetContext`/`LoadKeyboardLayout` 或模拟 Shift 切换;候选窗验证走 UIA 元素树
(微软拼音候选窗是标准 UIA 控件)优先于截图像素判读。

## 里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M1 功能核心** | 镜像组件 + 事件接线 + 条件抑制 + 定位/钳制/折行/淡出(素版样式) + 解开 e2e `it.skip` 并补齐断言 | e2e 全绿;L1 通过 |
| **M2 真实验证** | L3(a) 系统级真实 IME 脚本 + 人工矩阵(pi / claude / 普通 shell / 光标快速移动场景) | 真实输入法下:拼音可见于假光标旁、候选窗位置正确、上屏正确、无漂移 |
| **M3 美化(最低优先级)** | 样式/动效/主题化/设置开关 | 视觉评审 |

## 风险与开放问题

- **pi 的假光标可能不是 inverse 样式** → 扫描落空时回退到众数过滤器,冷启动首锚
  可能偏差(Plan A 实测的"首次左上角")——M2 需专门观察;必要时给过滤器预热
  (tab 激活即开始采样,已有 onRender 采样,天然预热)
- **xterm 升级**:镜像只依赖标准 DOM composition 事件,零 xterm 内部依赖;
  唯一的内部依赖仍是既有的 textarea Proxy(已接受)
- **多 tab**:镜像 per-tab 实例,随 tab 销毁(既有模式)
- **性能**:每次 update 读 offsetWidth/Height 触发一次 layout,量级可忽略
