# Bugfix 复盘:隐藏光标 TUI 的中文 IME(pi/claude)

> 状态:Plan A/B 已否决并回退,Plan C(悬浮组合镜像)为既定方向。
> 本文档记录问题本质、两个被否方案各自的根本缺陷,以及最终选型依据。

## 问题

pi、claude 这类 agent TUI 会隐藏硬件光标(`ESC[?25l`),把真光标停在行尾或角落,
自己绘制假光标。xterm 的 IME 支持假设"真光标即输入点",于是:

- xterm 的 `.composition-view`(拼音组合串显示)按**真光标坐标**渲染且**无边界钳制**
  → 拼音被挤到窗口最右侧并超出窗口;
- 系统 IME 候选窗跟随隐藏 textarea 的位置,同样落在真光标处。

## 仍然正确、必须保留的既有组件

| 组件 | 作用 |
|---|---|
| `_imeAnchorCell`(inverse 单元格扫描) | 光标隐藏时在视口中找假光标;找不到回退到过滤器 |
| `CursorPositionFilter`(众数/稳定运行) | 快速移动/动画场景下取最稳定的光标位置,防候选窗飘动 |
| `_patchImeFreeze`(textarea style Proxy) | 组合期间把隐藏 textarea 冻结在锚点 → **系统候选窗位置正确** |

这三者经真实输入法验证是工作的,任何后续方案都不得破坏。

## Plan A:抑制 composition-view —— 为什么否决

**做法**:光标隐藏时用 CSS 隐藏 xterm 的 composition-view,假设拼音会由系统候选窗呈现。

**根本缺陷(真实输入法实测发现)**:现代 TSF 应用(Chromium/WebView2)向 IME 声明
"我自己渲染组合串",因此微软拼音的候选窗**只显示候选词,不回显拼音** —— 组合串的
渲染责任本就在应用侧。隐藏 composition-view 后,拼音在屏幕上**彻底消失**
(用户原话:"输入的过程依然看不到拼音")。抑制得越干净,问题越完整。

**次要缺陷**:锚点冷启动 —— 首次组合时稳定运行过滤器尚未收敛,候选窗先出现在
左上角,敲几个键后才归位。

**结论**:只做减法的方案不成立。组合显示是必须有承担者的功能,不是可以删掉的瑕疵。

## Plan B:直接钉住 textarea / 重定位 composition-view —— 为什么否决

**做法**:定时器直接把 xterm 的隐藏 textarea 设置到计算锚点(不使用 Proxy)。

**根本缺陷(探针实测)**:xterm 在**每次渲染/光标移动时都会把 textarea 重设回真光标**。
100ms 间隔的钉入在两次刷新之间必然被覆盖,组合发生的瞬间 textarea 几乎总是落在
xterm 写回的位置。实测数据:同步逻辑已钉入 (0,221),但 computed 位置是 (1384,272)
—— 恰好等于真光标 (174,16) × 单元格尺寸。**与 xterm 的内部行为正面竞争是赢不了的**;
已有的 Proxy 之所以有效,正因为它拦截的是写入本身而不是事后覆盖。

同理,composition-view 由 xterm 按 buffer 坐标定位且不支持钳制。要修正它就需要第二个、
第三个对 xterm 内部样式的拦截点 —— 每多一个拦截点,就多一处 xterm 升级时的碎裂面。
不修改 xterm 源码,在 xterm 的显示层上修补没有出路。

**结论**:这不是"实现方式不够好",而是方向本身错误 —— 在别人的渲染管线里抢所有权。

## Plan C:悬浮组合镜像(既定方向)

**原则**:组合显示是"浏览器输入框"问题,不是终端渲染问题。xterm 没有为中文 IME
优化,而浏览器的普通 DOM 输入机制天然就是 IME 优化的宿主。VS Code 的理想效果正来源于
此 —— 它的组合显示是编辑器自己的 DOM 组件,浏览器原生处理候选窗跟随。

**架构**(全部建立在已验证的组件之上):

1. **悬浮镜像层**(纯展示):监听隐藏 textarea 的 compositionstart/update/end,
   把组合串镜像到悬浮 DOM 元素 —— 钳制在终端内、可折行、提交后短暂停留并淡出。
   **不触碰输入路径**:提交文本仍走 xterm 原生 textarea → onData → PTY 通路。
2. **composition-view 抑制**(Plan A 的机制,作为 C 的一部分回归):光标隐藏时隐藏
   xterm 的组合视图,避免双份显示 —— 此时拼音由镜像层承担,不再依赖系统候选窗回显。
3. **定位链保持不变**:textarea Proxy 冻结(候选窗位置)+ 众数过滤器(抗漂移)
   + inverse 扫描(假光标识别)。

**验收标准**(`e2e/specs/ime.e2e.js` 中 `it.skip` 占位):光标隐藏时,组合镜像在锚点
可见、内容与组合串同步、始终钳制在终端边界内、提交后自动淡出。

## Plan C 实施期根因补充:1px textarea 杀死真实组合(M2 实测)

M1 上真机后出现“镜像只显示第一个字母就被打断,候选窗跳到左上角”。根因:
xterm 的 `CompositionHelper.updateCompositionElements()` 用 `.composition-view` 的
`getBoundingClientRect()` 推导 textarea 尺寸;抑制 CSS(`display:none`)使 rect 全 0,
**textarea 被压成 1px×1px、lineHeight 0px** —— xterm 源码注释自述 "Ensure the
text area is at least 1x1, otherwise certain IMEs may break"。真实 TSF 组合期间文本
寄存在 textarea 内,1px 高的编辑框让 IME 在首个 update 后中止组合;冻结随之解除,
textarea 弹回真实光标处 = 候选窗跳左上角。

**修复**:冻结 Proxy 除 width 外同步钳住 `height`/`lineHeight`(各取一个完整单元格
尺寸),组合期间 textarea 永远是 1×1 完整格子。辅以镜像布局读取移出事件派发(rAF)。
合成事件(e2e)不会暴露此问题 —— 派发 CompositionEvent 不经过 TSF,textarea 尺寸
无关紧要;只有真实 IME 会校验。这再次验证“真实输入法的人工验证是最终裁决”。

## 验证方法论(本轮积累)

- **真实输入法的人工验证是最终裁决**。合成事件(CDP `Input.imeSetComposition` /
  派发 CompositionEvent)能验证事件链与 DOM 行为,但与真实 TSF 路径有差异 ——
  Plan A 的致命缺陷只有真实输入法能暴露。
- **e2e spec 用于回归**:正常 shell 内联组合 + 提交入 PTY、隐藏光标检测、
  Proxy 锚点冻结,均已固化(`bun run test:e2e:ime` 定向运行)。
- **ConPTY 只在备选屏(alt screen)转发光标可见性** —— 这是构造确定性
  隐藏光标 fixture(`ESC[?1049h` 包裹)的关键知识,已写入 spec 注释。
