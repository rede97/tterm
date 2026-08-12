# 前端规范化治理计划

> 状态：计划文档（2026-08，v1.0.3 之后）
> 范围：`src/` 前端（~9,400 行 TS，约 50 个文件）。后端 Rust 质量已达标，不在范围内。
> 依据：v1.0.3 开发过程中的全面代码评审 + 定量扫描（文件行数、`as any`/裸 catch/innerHTML 计数、tsconfig 检查、CI 配置审查）。

## 总评

骨架是认真设计过的：configStore 声明式 schema、handler 注入破循环、共享 UI 组件（toast/modal/confirm/stepper）、AGENT.md 根因级文档、L0–L3 测试金字塔。欠的是**用工具把纪律固化**和**给两个大文件做截肢**。

决策记录：**不引入前端框架**。本项目复杂度在 xterm/PTY/IME 层（框架零收益），UI 表面小（标签条、6 个设置面板、菜单、模态）；现有痛点全部是代码组织问题，框架治不了 god object——只会得到 800 行的 god component。重估触发条件：设置面板膨胀到十几个并出现跨面板联动状态，或多窗口共享组件库；届时首选 Solid / lit-html（模板即 DOM，不推翻现有架构）。

---

## P1 — 纪律没有工具固化（最高优先级）

**现状**
- 无 linter / formatter（AGENT.md 自述 "No linters configured"）。
- `tsconfig` 已有 `strict` + `noUnusedLocals`，是好的底线，但风格、`!` 断言（仅 tabmanager.ts 就 39 处）、import 顺序、AGENT.md 硬规则全靠 review 自觉。
- `.github/workflows/ci.yml` 只跑 `tauri build`——**不跑 vitest、不跑 cargo test、不跑 lint**。测试完全依赖开发者本地自觉执行。

**原因**
项目由文档驱动纪律（AGENT.md 硬规则写得很细），早期单人开发时有效；但规则只存在于文档中就会随人手和 Agent 使用频率漂移——本次快捷键开发中 Agent 自己就两次违反项目规则（inline import type、`as any`），靠规则提醒而非机器拦截才发现。

**方法**
1. 引入 **Biome**（单二进制，formatter + linter 一体，零配置起步，Rust 实现速度快，与 Bun 工具链气质一致）。备选 oxlint + prettier。
2. 用 `no-restricted-syntax` 类规则把 AGENT.md 硬规则机器化：

   | AGENT.md 约定 | 机器规则 |
   |---|---|
   | `tab.ts` 禁止 import `tabmanager.ts` | `import/no-cycle`（或 Biome 自定义插件） |
   | 错误处理必须走 `logCatch`/`logError`/`swallow`，禁止裸 `.catch(() => {})` | AST 选择器：`CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[body.body.length=0]` |
   | 原生对话框禁用 | 禁止 `prompt(`/`alert(`/`confirm(` 调用 |
   | 用户错误必须 `showToast` | 保留 review（语义判断，无法机器化） |
3. 配 `lint` script：`biome check src tests e2e`，纳入 CI（见下文 CI 集成）。
4. 存量 `!` 非空断言不一次性清洗（收益低风险高），规则设为 warn，新代码禁止新增。

**收益**
- AGENT.md 检查清单从"发版前靠记忆执行"变成"每次 push 机器强制"；
- 消除纪律漂移这一类风险，对多 Agent/多人协作是前提条件；
- 一次性投入约半天，之后零维护成本。

---

## P2 — god object 吸积：tabmanager.ts / tab.ts

**现状**
- `tabmanager.ts` 882 行，职责至少 8 类：tab 生命周期、SSH 配置转发应用（`_applyConfigForwards`）、串口参数（5 个 setter）、分享（`shareTab`）、导出、内联重命名、badge/溢出、Sortable 拖拽、MRU、settings 页生命周期。
- `tab.ts` 671 行同理（xterm 装配、IME、socket 重连、OSC、分享快照、串口输入）。
- v1.0.3 的 MRU 跟踪和 session-exited 监听也只能继续塞进去——没有别的落点。

**原因**
概念上的切缝早就存在，但每个新功能都选"最省事的落点"（现有的类），长期吸积。类内私有方法互相缠绕（`_onResize`/`triggerResize` 是复制体），安全网是 e2e 而非单元测试，重构心理成本高，进一步助长吸积。

**方法**
按既有切缝纯移动代码，不改行为，e2e 即安全网：

```
terminal/
  tabmanager.ts      编排 + tabs Map + switchTo/closeTab（目标 <400 行）
  tablifecycle.ts    create*Tab 四件套 + _finalizeTab + _register + 字体竞态
  tabactions.ts      rename/share/duplicate/export/closeRight/closeOther
  settingsshell.ts   settings 页打开/关闭/工厂（从 tabmanager 剥离）
  serialctl.ts       5 个串口 live setter + setSerialProfile
```

tab.ts 暂缓（IME 与渲染耦合深，单独立项，见 P5 备注）。

**收益**
- 新功能有明确落点，止住吸积；
- `tablifecycle`/`serialctl` 变成可单测的纯逻辑（现在只能 e2e 覆盖）；
- 882 行 → 每个文件一个主题，AGENT.md 的 repo layout 重新名副其实。

---

## P3 — 两种 UI 构建风格并存，innerHTML 插值是 XSS 温床

**现状**
- settings 各面板（general/appearance/ssh/serial/profile 等 17 处文件）用 `innerHTML` 字符串插值，防注入靠手工 `esc()`——ssh.ts 单文件 60+ 处插值；
- quickpanel/tabswitcher/shortcuts/contextmenu 用 DOM 构建（`createElement`），冗长但安全。

**原因**
历史演进：settings 面板写得早，图省事用了模板字符串；后来 UI 组件层形成了 DOM 构建风格，两套并存。目前没出安全事故是因为作者小心（ssh.ts 有 `esc()`），不是模式安全——插值模式只要漏一处 `esc()` 就是注入点（SSH hostname、串口名都是外部数据）。

**方法**
写一个 ~30 行的 `html` tagged-template 助手（插值自动转义，`html`<div>${userData}</div>`），放在 `src/ui/`：

```ts
// src/ui/html.ts — 插值默认转义；显式 unsafe() 才放行原始 HTML
```

然后把 settings 面板的插值模板逐个迁移（每个面板独立小 PR，e2e/单测现成的）。DOM 构建风格保持不变，两套收敛为"模板走 html 助手（自动转义）、动态结构走 createElement"。

**收益**
- 消灭一整类注入风险，且不靠自觉；
- 模板可读性保留（不用改写成 createElement 长链）；
- 新面板有唯一标准写法，结束风格分叉。

---

## P4 — main.ts 接线堆

**现状**
`main.ts` 284 行且以"内联块"方式持续堆叠：DOM refs、welcome、settings 工厂、config 订阅、keymap 接线（v1.0.3 新增的内联块）、quickpanel/contextmenu handler 注入、share 事件、初始化序列全在一个文件。

**原因**
没有"每功能一个 init 模块"的约定，handler 注入模式（好模式）天然把接线代码推向 main.ts，无人收口。

**方法**
约定：每个 feature 一个 `init*.ts`（`initKeymap()`、`initSharing()`、`initQuickPanel()`…），main.ts 只保留编排顺序，目标 <150 行。随 P2 一起做（都涉及 tabmanager 边界）。

**收益**
main.ts 重新可读完；feature 接线可独立 review；新增功能的 diff 不再碰公共文件，降低冲突面。

---

## P5 — 复制体与类型断言（低优先，随改随清）

**现状**
- `_onResize` / `triggerResize` 是复制体（v1.0.3 的 settle 修复只落在后者——窗口 resize 不变更 metrics，行为正确，但复制体迟早分叉）；
- `!` 非空断言 tabmanager.ts 39 处；`(window as any).__tterm` 调试钩子；
- 测试断言脆弱：面板数量硬编码 5→6 时破两处（作为回归保护可接受，但断言的是计数不是契约）。

**方法**
- 合并 `_onResize`/`triggerResize` 为一个私有 `scheduleFit(active, { settle })`；
- `__tterm` 收拢进 `src/core/devhooks.ts` 并声明类型；
- 存量 `!` 不专项清洗，P1 的 lint 规则防新增即可。

**收益**
消除"修了一个忘了另一个"的整类 bug（v1.0.3 的 settle 修复差点就是先例）。

---

## 分期计划

| 阶段 | 内容 | 验收 | 风险 |
|---|---|---|---|
| **0. 工具链**（0.5 天） | 装 Biome，配规则，全量 format（一次性 diff），加 `lint` script | `bun run lint` 通过；CI check job 绿 | format 大 diff 与在途分支冲突 → 选无在途工作时做 |
| **1. CI 门禁**（0.5 天） | ci.yml 增加 check job（lint + tsc + vitest + cargo test） | 故意制造 lint/test 失败能被 CI 拦下 | Windows runner 上 cargo test 时长 → 用 rust-cache |
| **2. html 助手 + 面板迁移**（2–3 天，可拆小 PR） | `ui/html.ts` + settings 面板逐个迁移 | 每面板现有单测/e2e 全绿；grep 无裸插值 | 低，逐面板独立 |
| **3. tabmanager 截肢 + main 收口**（2–3 天） | P2 拆分 + P4 init 模块 + P5 复制体合并 | e2e 全绿；tabmanager <400 行 | 中：拖拽/MRU 顺序敏感，e2e 覆盖关键点 |

阶段 0/1 互为依赖一并做；2、3 独立可并行。

---

## 约束工具集成 CI：可以，且应该

**现状**：`ci.yml` 只有 build job（bun install → rust toolchain → tauri build → 上传安装包），**测试和 lint 都不在 CI 里**。release.yml 同理只构建。也就是说当前"发版前跑测试"是流程要求，不是机器保证。

**设计**：在 ci.yml 增加 `check` job，与 `build` 并行（build 慢，check 快，失败早反馈）：

```yaml
  check:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx biome check src tests e2e   # P1 落地后；此前可跳过
      - run: bun run build                    # tsc 类型检查 + vite 构建
      - run: bun run test                     # vitest L1/L2

      - uses: dtolnay/rust-toolchain@stable
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - run: cargo test --manifest-path src-tauri/Cargo.toml
      # 可选：cargo clippy -- -D warnings（后端已高质量，开了大概率直接过）
```

**e2e 是否进 CI**：可以但单独成 job（`e2e`），不进 PR 门禁。docs/testing.md 已有 CI 要点：windows-latest 自带 WebView2，需要下载钉版 msedgedriver + `cargo install tauri-driver`（均可缓存）+ debug 二进制。建议 nightly 或 release 前触发，避免拖慢 PR 反馈。

**收益**：AGENT.md 的"提交前必须 `bun run build`""发版前零警告"从口头流程变成分支保护；P1 的 lint 规则只有进了 CI 才算真正固化。

---

## 收益汇总

| 投入 | 产出 |
|---|---|
| ~1 天（阶段 0+1） | 纪律机器化：lint/format/test/类型全部 CI 强制，消除漂移风险 |
| ~2–3 天（阶段 2） | 消灭 XSS 温床模式，UI 写法收敛唯一标准 |
| ~2–3 天（阶段 3） | 止住 god object 吸积，核心逻辑可单测化，main.ts 可读 |

总投入约一周，之后每个新功能（无论人写还是 Agent 写）都落在有边界、有门禁的结构里——前端达到与后端同一水准。
