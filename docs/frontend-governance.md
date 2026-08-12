# 前端规范化治理计划

> 状态：计划文档（2026-08，v1.0.3 之后）
> 范围：`src/` 前端为主（~9,400 行 TS，约 50 个文件）；后端关联项单列一节。
> 依据：v1.0.3 开发过程中的代码评审 + 定量扫描，**合并外部两轮审计**（基线 v1.0.2 `a8b2b15` / v1.0.3 `e5f4e71`，三路逐文件审读）。审计关键论断已抽查复核属实（H1 / M1 / M5 均回源码确认）。

## 总评

骨架是认真设计过的：configStore 声明式 schema、handler 注入破循环、共享 UI 组件、AGENT.md 根因级文档、L0–L3 测试金字塔。审计对 v1.0.3 新增快捷键模块的评价是"全仓库集成质量最高的一批代码"。

但两轮审计的共同结论：**增量代码质量远高于存量体系化水平——每个新功能都遵循最好的范式，没人回头收敛旧碎片，审计债连续两轮零偿还。** 前端规整性评分 6.5/10：缺陷修复、范式收敛、纪律工具化三件事必须排期。

决策记录：**不引入前端框架**（理由与重估触发条件见末节）。

---

# 第一部分：缺陷修复清单（审计确认，按 ROI 排序）

> **进度（2026-08）**：A1–A4、C1–C6 已全部修复并回归测试覆盖（store.load 全键通知 + pending 写取消、SSH config 全局段往返、pasteWarning 多行粘贴守卫落地、README 失实描述移除、window.ts unlisten/空 catch、ctrl++/numpad 解析、settings dirty 事件泛化、switcher 死 id 守卫、测试拆分与面板单测）。修复中发现并顺带修复一个未在清单内的 bug：`setPending` 未与默认绑定比较导致解绑默认值被静默跳过。剩余：B1–B4、C7、D 级。

## A. 立即修 — 数据安全 / 功能失效

### A1. `store.load()` 通知语义缺陷（一处改动解三个问题）⭐ 最高 ROI
- **现状**：`load()` 末尾 `_notify(Object.keys(cfg))`（store.ts L159）只通知磁盘文件里存在的 key。配置被删除（Reset All）→ 返回 `{}` → **通知空集**，所有订阅者（含 v1.0.3 的 keymap 查找表）保持旧值直到重启；旧版配置文件缺少新 key（如 `keybindings`）时，Revert 同样无法把内存值回滚为默认。
- **后果**：M1 Reset All 后界面不生效；N1 Reset All 后旧快捷键继续生效到重启；版本升级后 Revert 不回滚新配置项。
- **修法**：`load()` 通知**全部 schema 键**（缺失 key 已被 `_applyConfig` 重置为默认值，订阅者需要知道）。同步排查 Revert 与防抖写盘竞态（L6：pending 写可能把被撤销的旧值写回——Revert 前先 `flush()` 或清 pending）。
- **验证**：补单测——load 空配置后 subscribe 收到全部 key；keymap `_lookup` 在 Reset All 后重建为默认。

### A2. SSH config 保存丢失 `Host *` 全局段与 preProps（H1，数据丢失）
- **现状**：解析时 `Host *` 收进 `wildcardProps`、首个 Host 前的全局键收进 `preProps`（ssh-config.ts L12-25），但 `generateSshConfig(hosts)`（L72-97）**只遍历 hosts，两段永不写回** → 用户的 `ProxyJump`/`ServerAliveInterval` 等全局默认在 Save SSH Config 后被静默丢弃。`.tt.bak` 备份只是缓冲，仍是真实数据破坏路径。
- **修法**：`SshHost` 解析结果携带 wildcard/preProps 段（或模块级保留原始段文本），generate 时先写回 `Host *` 段再写 hosts；用 wildcard 继承的现有单测扩展一个"全局段往返"用例。

### A3. `pasteWarning` 是死功能（M5）
- **现状**：设置项存在并持久化（schema + general.ts 复选框），但**两条粘贴路径从未读取它**——多行粘贴无任何警告。
- **修法**：二选一——在 `tab.ts` 粘贴路径按设置弹 confirmDialog（多行时）；或删除设置项。建议补实现（用户可见功能已在 UI 中承诺）。

### A4. README 宣传已移除的功能（D1，高）
- **现状**：README 中/英文版宣称"串口设备参数按 VID:PID 记忆"，该功能 v0.12.0 已移除（全 src 无记忆逻辑，VID:PID 仅用于菜单显示）。
- **修法**：两版 README 删除/改写该条；顺手核对 README 其他特性描述与现状。

## B. 尽快修 — 资源泄漏 / 并发

### B1. tab.ts 资源清理不完整（M2/M3/M4）
- M2：IME 重定位 `refreshTimer` 在组词中关 tab 时无清理路径（tab.ts L495-504），持续访问已 dispose 的终端。
- M3：`destroy()` 不关 WebSocket、不 dispose attachAddon；`pty_kill` 失败被吞时会话与定时器残留。
- M4：`new TerminalTab` 在 try 外，WebglAddon 抛异常时 PTY 已 spawn 但无人 kill（tabmanager.ts L190-204），新建按钮 fire-and-forget。
- **修法**：destroy() 收编所有定时器/socket/addon 清理；`_finalizeTab` 失败路径 kill 已 spawn 的会话。补"构造失败不留孤儿"单测。

### B2. `FrontendPrompter::park` 无超时（M8，后端）
- **现状**：前端失联时 SSH 认证永久挂起；dead-mode auto-retry 路径下永久占住 blocking 线程。同项目 share.rs 已有 1500ms 超时先例、`client::connect` 有 15s 超时，标准不一。
- **修法**：park 加超时（建议 5min 用户等待级 + auto-retry 路径短超时），超时按认证取消处理。

### B3. `DeadWatcher::write` 持 writer 锁同步 respawn（M9，后端）
- **现状**：SSH 重连可达 15s+，期间该会话所有输入被挡（relay.rs L379-391）。
- **修法**：respawn 移出锁临界区（先释放锁再执行，或转 spawned task）。

### B4. 多窗口 config.json 读-改-写竞态（M6）
- **现状**：每窗口一个 ConfigStore，防抖读-改-写，后写覆盖先写；`beforeunload` 的 flush 不 await。
- **修法**：接受现状（低频、损失为一个设置项）或写前重读合并；至少在 AGENT.md 记录为已知限制。

## C. v1.0.3 新引入（本次迭代自身欠账，诚实记录）

| # | 问题 | 修法 |
|---|---|---|
| C1 | N1 已并入 A1（同一处修复） | — |
| C2 | window.ts：`onResized` 返回的 unlisten 被丢弃；`catch (_) {}` 空捕获破窗 | initWindowControls 保留 unlisten；改用 `swallow`/`logCatch` |
| C3 | 键位文法覆盖不全：`ctrl++`（`+` 键本身）解析为 null；小键盘键名未处理 | parseCombo 对尾部 `+` 特判；补小键盘键名映射 |
| C4 | tabswitcher 测试塞在 keymap.test.ts；shortcuts.ts 面板逻辑（录制/冲突拒绝/collect 往返）无单测 | 拆 `tests/tabswitcher.test.ts`；补 shortcuts 面板 DOM 测试（沿用 settings-revert 的 mock 模式） |
| C5 | 录制提交靠派发合成 change 事件点亮 Apply，跨文件暗契约 | settings 壳导出 `markDirty(root)` 公共助手替代合成事件 |
| C6 | switcher 打开期间 tab 被关/重排时列表快照不刷新，commit 死 id 静默无响应 | commit 前校验 id 存活，已死则按当前快照重选或关闭浮层 |
| C7 | 干净退出自动关页签时可能闪现一帧断连横幅（观感竞态） | 低优先，记录 |

## D. 低严重度摘要（审计 L 级，排期随缘）

| # | 问题 | 位置 |
|---|---|---|
| L1 | quickpanel 可选链 `.catch` 三式并存（当前不炸，误导） | quickpanel.ts L421/435/441 |
| L2 | 复制串口 tab 打开本地 shell；rename 清 command 后复制退化 | tabmanager.ts L634-644 |
| L3 | `pty_resize` 双份 IPC（onResize 统一负责 vs 多处手动 invoke） | tab.ts / tabmanager.ts |
| L4 | `_onResize` 10ms 定时器闭包持旧 active，已销毁 tab 上 fit 抛错 | tabmanager.ts |
| L5 | 分享截图 promise 无 catch | main.ts |
| L7 | fontconfig `_resolveSystemFonts` 死代码；profile.ts `<label>` 嵌套；sshkeys clipboard 无 catch | 各文件 |
| L8 | `exec_capture` 按 chunk 解码 UTF-8，跨包边界产生 U+FFFD（后端） | sshclient.rs |
| L9 | `serial_reconnect` 300ms 固定 sleep 代替握手（后端） | serial.rs |
| L10 | 托盘 Quit PID 重用竞态 + TerminateProcess（后端） | tray.rs |
| L11 | WS token 非常量时间比较（loopback 实际不可利用） | relay.rs |
| L12 | `remove_known_host` 不支持 hashed known_hosts（后端） | sshclient.rs |
| L13 | SSH 上行 pump cancel 仅空闲时生效（后端） | sshclient.rs |

---

# 第二部分：体系化治理（范式收敛）

## P1 — 纪律没有工具固化（最高优先级）

**现状**：无 linter/formatter；`tsconfig` 有 strict 底线，但风格、`!` 断言（tabmanager 39 处）、AGENT.md 硬规则全靠 review 自觉。**`ci.yml` 只跑 build——不跑 vitest、不跑 cargo test、不跑 lint**，测试靠本地自觉。

**原因**：文档驱动纪律在早期单人开发有效；规则只在文档里就会漂移——本轮迭代 Agent 自己就留下空 catch 和 `el()` 复制（见 C2/审计 7.2），靠规则提醒而非机器拦截。

**方法**：引入 **Biome**（单二进制 formatter+linter，备选 oxlint+prettier）；`no-restricted-syntax` 把硬规则机器化（禁裸 catch、禁 `prompt/alert/confirm`、`import/no-cycle`）；纳入 CI（见末节）。存量 `!` 不清洗，新代码禁新增。

**收益**：AGENT.md 检查清单从"靠记忆"变成"每次 push 机器强制"，是多人/多 Agent 协作的前提。

## P2 — god object 吸积

**现状**：`tabmanager.ts` 882 行 8+ 职责（本轮 MRU/session-exited 也只能塞进去）；`tab.ts` 671 行。后端同类：`sshclient.rs` 2226 行五职责域；`lib.rs` debug/release **双份 `generate_handler!` 列表**——本轮各加 3 个 `window_*` 命令，双份维护成本当场兑现。

**方法**：
- tabmanager 按既有切缝拆分（tablifecycle / tabactions / settingsshell / serialctl），目标 <400 行，纯移动代码，e2e 即安全网；tab.ts 暂缓（IME 耦合深，单独立项）。
- `lib.rs` 双份 handler 合并：基础列表 + `#[cfg]` 局部拼接 debug-only 命令。
- sshclient.rs 按 Prompter/hostkey/转发/SOCKS5/keygen 拆分（后端排期项）。

## P3 — UI 构建双范式 + 字符串契约

**现状**（审计量化）：
- innerHTML 插值模板 17 个文件（ssh.ts 60+ 处插值靠手工 `esc()`）vs DOM 构建并存；**`el()` 辅助函数已复制 5 份**（v1.0.3 新增 2 份）。
- `querySelector/getElementById` 共 **156 处、24 个文件**，零常量化；index.html 15 个静态 id 被字符串直接引用；跨语言隐式契约（`tab-{n}` 格式呼应 TS 与 pty.rs）。
- ssh.ts 覆盖 `~/.ssh/config` 用原生 `confirm()`（且内联 `onclick` 被 CSP 拦截报违规），与项目自建 confirmDialog 矛盾（themeeditor/serialprofileeditor 同有原生 confirm）。

**方法**：~30 行自动转义 `html` 标签模板助手收敛模板写法；公共 `el()` 收进 `ui/dom.ts`；DOM id 常量表（`core/dom-ids.ts`）；原生 confirm 全部替换为 confirmDialog。

## P4 — main.ts 接线堆 + 通知机制三套并存

**现状**：main.ts 284 行内联块堆叠；通知机制三套——configStore.subscribe（仅 2 处）/ settings 壳 CustomEvent / handler 注入——仅注入有成文设计。模块放错层：fontpicker.ts（纯 UI 浮层）在 terminal/，forwarding 特性横跨 terminal/ 与 ui/。

**方法**：每 feature 一个 init 模块，main <150 行；通知机制定型为"配置走 store.subscribe、feature 间走注入"，settings 壳 CustomEvent 视为壳内私有；fontpicker 挪 ui/，forwarding 收拢一层。

## P5 — 状态分裂与复制体

**现状**（审计 2.1 补充）：ConfigStore 自称唯一事实源，但 `themes.ts`/`serial-profiles.ts`/`fontconfig.ts`/`settings/ssh.ts` 各自维护模块级可变状态，无订阅通知，一致性靠调用纪律；`_onResize`/`triggerResize` 复制体（settle 修复只落一份）；`(window as any).__tterm`。

**方法**：模块级状态登记为"启动期加载的运行时数据"，统一从 store.load 流程驱动刷新；合并复制体为 `scheduleFit(active, { settle })`；`__tterm` 收进类型化的 `core/devhooks.ts`。

---

# 第三部分：文档同步

| # | 问题 | 修法 |
|---|---|---|
| D1 | README 中/英 VID:PID 记忆宣传（见 A4） | 随 A4 一并修 |
| D2 | AGENT.md 列幽灵文件 `serial-memory.ts`；invoke 命令清单漏约 20 个（`ssh_*`/串口控制/`tray_*`） | 删幽灵条目，命令清单改为"以 lib.rs generate_handler! 为准"并补全 |
| D3 | testing.md Rust 测试计数 91→实际 101；msedgedriver 版本号过期 | 改为"以 `cargo test` 输出为准"，去掉易过期硬编码数字 |

---

# 分期计划（缺陷修复优先于范式治理）

| 阶段 | 内容 | 验收 | 风险 |
|---|---|---|---|
| **-1. 缺陷修复**（1–2 天） | A1（store.load 通知）、A2（Host \*）、A3（pasteWarning）、A4（README）、C2–C6 | A1/A2 新单测过；C 项回归测试过 | 低，各自独立 |
| **0. 工具链 + CI**（1 天） | Biome 引入 + 全量 format + ci.yml `check` job（lint+tsc+vitest+cargo test） | 故意制造 lint/test 失败被 CI 拦下 | format 大 diff 撞在途分支 |
| **1. 资源与并发**（1–2 天） | B1 tab.ts 清理、B2/B3 后端超时与锁、lib.rs handler 合并 | 新增回归单测/e2e | 中：死锁排查需 Rust 测试 |
| **2. UI 收敛**（2–3 天，可拆小 PR） | html 助手 + el() 收编 + id 常量表 + confirmDialog 替换 | grep 无裸插值/原生 confirm | 低 |
| **3. 结构拆分**（2–3 天） | tabmanager 截肢 + main 收口 + 状态登记 | e2e 全绿；tabmanager <400 行 | 中 |
| **4. 后端排期**（独立） | sshclient.rs 拆分、L8-L13 择项 | cargo test 全绿 | 中 |

---

# 约束工具集成 CI：可以，且现在最需要

`ci.yml` 目前只有 build job（bun install → rust toolchain → tauri build → 上传安装包），**测试和 lint 都不在 CI**。设计：新增 `check` job 与 build 并行（快反馈）：

```yaml
  check:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx biome check src tests e2e   # P1 落地后启用
      - run: bun run build                    # tsc 类型检查 + vite
      - run: bun run test                     # vitest L1/L2
      - uses: dtolnay/rust-toolchain@stable
      - uses: swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - run: cargo test --manifest-path src-tauri/Cargo.toml
      # 可选：cargo clippy -- -D warnings
```

e2e 单独成 job 不进 PR 门禁（msedgedriver 钉版 + tauri-driver 缓存，见 testing.md），nightly 或发版前触发。

---

# 附：不引入前端框架的决策

复杂度在 xterm/PTY/IME 层（框架零收益），UI 表面小；现有痛点全是代码组织问题，框架只会得到 god component。重估触发条件：设置面板十几个且跨面板联动 / 多窗口共享组件库 → 届时首选 Solid / lit-html。低成本替代：`html` 标签模板助手（P3）解决模板 ergonomics。
