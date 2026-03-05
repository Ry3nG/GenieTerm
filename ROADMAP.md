# GenieTerm Roadmap (Performance-First)

## Product Direction

GenieTerm 的第一目标不是“功能最多”，而是成为 **macOS Terminal 的上位替代**：

- 更轻量（低 CPU、低内存、低空闲唤醒）
- 更快（低输入延迟、稳定 60/30fps 体感、长输出不掉帧）
- 更稳（兼容主流 CLI、长时间运行可靠）
- 更原生（符合 macOS 交互预期）

只有在上述目标达标后，才推进 Warp 风格的增强体验。

---

## Priority Rules (Hard Constraints)

1. **性能和稳定性优先于新功能**。
2. 任意新功能必须通过性能门槛，不允许明显回退。
3. 先做“终端基础能力完整”，再做“智能/设计加成”。
4. Warp 风格能力默认按“可选增强层”设计，不能拖慢基础终端路径。

---

## Current Architecture Findings

基于当前代码（Rust core + SwiftUI/AppKit）梳理出的关键瓶颈：

- 热路径仍依赖 JSON 快照（已收敛到可见区，但仍有序列化/解码成本）。
- 可见区渲染已切到 CoreText canvas，后续应继续推进“脏行/增量”数据路径。
- scrollback 已拆分为按需视口模式，仍需持续验证滚动手感与滚动条稳定性。
- 兼容性与可量化基准（性能、长稳）仍是当前主要缺口。

---

## v0.2.0 Completed Baseline

- [x] 终端渲染从 `NSTextView` 重写为 CoreText canvas。
- [x] 热快照仅包含可见行；scrollback 通过单独接口按需拉取。
- [x] Alternate screen 快照隔离修复（不混入 scrollback）。
- [x] Tab 行为修复（右边界钳制）。
- [x] 上半区鼠标框选 + `Cmd+C` 复制；粘贴按 first responder 路由。
- [x] 下半区简化为单行输入；移除 multiline toggle 与历史块展示；支持 `Up/Down` 历史导航。

---

## Phase 0: Foundation (Now - v0.2.x)

目标：先把“轻量、高性能、可持续迭代”地基打稳。

### 0.1 Data Path Optimization

- [x] 增加快照版本号（snapshot version），只有内容变化才拉取快照。
- [x] Swift 轮询改为“先读版本，再决定是否拉 JSON”。
- [x] 空闲时降频轮询，活跃时恢复高频轮询。
- [x] 渲染层由 `hashValue` 全量比较切换为 `version` 比较。
- [x] 上半区渲染切换到 CoreText canvas（替代 NSTextView 全量富文本布局）。

### 0.2 Buffer Efficiency

- [x] `scrollback` 改为 `VecDeque`，避免头删线性代价。
- [ ] 引入环形缓冲策略（固定上限 + 回收复用）。
- [ ] 评估/实现增量快照（仅变化行），减少大 JSON 负载。

### 0.3 Baseline Instrumentation

- [x] 增加基准脚本框架（`benchmarks/run_benchmarks.sh` + `core_bench`）。
- [x] 在本地脚本输出关键指标并落盘 JSON（`benchmarks/results/*.json`）。
- [x] 增加 Swift E2E 基准（FFI 拉取 + JSON decode + CoreText 构建）与独立回归阈值。
- [ ] 建立“性能回归红线”并在 PR 里执行。

### Phase 0 Exit Criteria

- 空闲 CPU：M 系列机器长期保持低占用（目标 < 2%）。
- 高频输出时 UI 可交互，不出现明显输入卡顿。
- 50k+ 行输出仍可平滑滚动与选择。

---

## Phase 1: macOS Terminal Replacement (v0.3.x)

目标：功能上成为 macOS Terminal 的可靠上位替代。

### 1.1 Core Usability (Must-have)

- [x] 基础快捷键语义（复制、粘贴、清屏、中断）。
- [ ] 查找等高级菜单语义补全。
- [x] 稳定文本选择与 `Cmd+C` 复制（上半区）。
- [ ] 右键菜单、拖拽粘贴。
- [ ] 命令历史持久化与基础检索（不引入重 UI）。
- [ ] 稳定窗口/字体/主题配置（保持默认轻量）。

### 1.2 Compatibility & Correctness

- [ ] ANSI/CSI 支持补全（优先真实使用频率高的序列）。
- [ ] tmux/vim/less/top 等兼容性专项测试。
- [ ] Shell 集成最小集：命令边界、退出码、工作目录追踪。

### 1.3 Reliability

- [ ] 长会话压力测试（8h+）与内存增长控制。
- [ ] PTY 断连、异常 shell 退出、自恢复策略。

### Phase 1 Exit Criteria

- 日常开发工作可 100% 用 GenieTerm 完成。
- 与 macOS Terminal 对比，输入响应与滚动体验不落后。
- 关键命令行工具兼容性通过率达到发布标准。

---

## Phase 2: Pro Native Terminal (v0.4.x)

目标：在不牺牲性能前提下，提供专业用户需要的效率能力。

- [ ] 多标签（Tab）与稳定会话管理。
- [ ] 分屏（Pane）和焦点切换。
- [ ] 输出搜索（含大小写/regex 基础能力）。
- [ ] 通知与长任务完成提醒。
- [ ] 会话恢复与崩溃保护。

性能约束：以上能力全部启用时，仍需通过 Phase 0 的性能红线。

---

## Phase 3: Warp-Inspired Layer (v0.5.x+)

目标：在“基础终端已足够强”的前提下，再做设计和智能增强。

- [ ] 命令块（Command Blocks）与命令级导航。
- [ ] 命令面板（Command Palette）与模糊搜索。
- [ ] 智能建议（上下文补全、常用命令学习）。
- [ ] AI 辅助（解释报错/生成命令），默认可选、严格隐私边界。

说明：Warp 风格能力应设计为可关闭的增强层，不影响基础终端速度与稳定性。

---

## De-Prioritized (Before v0.5)

以下方向在基础目标完成前暂不作为主线：

- 插件系统
- 云同步
- iOS/iPadOS 版本
- Linux/Windows 扩展
- 会话录制与分享平台化

---

## Release Gates

每个版本发布前必须满足：

- 无阻塞级崩溃（P0/P1）
- 性能基准不回退
- 关键兼容性清单通过
- 至少一次长时稳定性回归

---

## Success Metrics

- Startup time（冷启动）
- Idle CPU / memory
- 输入到回显延迟（p50/p95）
- 大输出渲染耗时（10k/50k 行）
- Crash-free session rate
- 每日活跃用户中的“默认终端替换率”

---

*This roadmap is intentionally strict: performance and terminal fundamentals first, Warp-like enhancements second.*
