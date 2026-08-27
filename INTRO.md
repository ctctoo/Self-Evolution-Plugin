# DSH 自进化插件系统 · 介绍文档

> **项目**：`Self-Evolution-Plugin`
> **目标**：让 DeepSeek Harness（DSH）在**稳定、安全、可回滚**的前提下，以插件为单位修改自身源码，实现受控自进化。
> **形态**：一个可装入 DSH 的 Cordis 插件（`plugin/`）+ 五个配套工程工具（`toolkit/`）。

---

## 1. 为什么需要插件级自进化

DSH 是插件式 harness（基于 Cordis）：一切能力都是插件，插件通过 `ctx.<key>` 提供
服务、通过类型化事件通信、通过 `ctx.tools` 向模型暴露工具。因此：

- **进化粒度天然是插件**——替换插件就是卸载→替换→装入，比修改 harness 内核安全得多；
- **风险可隔离**——一个插件出错只影响该插件，可独立回滚；
- **能力可沉淀**——进化产物是普通插件，可以被审计、测试、版本管理。

本项目实现一个"自进化闭环"，在模型（或人工审查）介入下，DSH 可以持续改善自身
插件：发现问题 → 制定修复计划 → 审查 → 沙箱修改 → 多轮测试 → 部署 → 健康监控 →
自动回滚。

---

## 2. 架构总览

```
┌────────────────────────────────────────────────────────────────────┐
│                     DSH（DeepSeek Harness）                         │
│                                                                    │
│  运行日志 / 会话事件 / 工具调用 / 指标                                │
│        │                                                           │
│        ▼                                                           │
│  ┌───────────┐  FixPlan   ┌───────────┐  verdict  ┌────────────┐  │
│  │ Analyzer  │──────────▶ │ Inspector │──────────▶│  Actuator  │  │
│  │ 分析问题   │            │ 规则审查    │           │ 沙箱修改源码 │  │
│  └───────────┘            └───────────┘           └─────┬──────┘  │
│        ▲                                                 │ 副本     │
│        │ 错误报告（未通过）                                ▼          │
│        │                                        ┌────────────┐     │
│        └────────────────────────────────────────│   Tester   │     │
│                 再次循环                          │ 多轮测试    │     │
│                                                 └─────┬──────┘     │
│                                                       │ 通过       │
│                                                       ▼            │
│  ┌───────────┐  部署    ┌──────────────┐   快照+替换   ┌──────────┐ │
│  │ 进化谱系库 │◀────────│    Cover     │──────────────▶│ 生产插件  │ │
│  │ registry  │  记录     │ 沙箱外部署/回滚 │             └──────────┘ │
│  └───────────┘          └──────────────┘                           │
└────────────────────────────────────────────────────────────────────┘
```

### 闭环五步

1. **Analyzer（分析器）**——`plugin/src/analyzer.ts`
   监听 DSH 运行事件（`agent/error`、`tools/result`、`session/event`），由
   `metrics.ts` 聚合出错误计数、工具延迟、失败率等指标；将问题信号映射为
   **FixPlan**（修复计划）：包含问题描述、证据引用、逐文件修改方案、预期影响与风险评级。
   默认生成器是确定性规则模板；可注入 LLM 生成器（`Analyzer.setGenerator`）。

2. **Inspector（审查器）**——`plugin/src/inspector.ts`
   对每个 FixPlan 执行**硬编码、不可修改**的规则集，拥有否决权：
   - `scope/allowlist`、`scope/protected`：只能进化允许列表内的插件，保护列表永不改变；
   - `scope/file-scope`：修改文件不得逃逸插件包根（拒绝路径穿越）；
   - `contract/manifest-stable`：`package.json` 的 `main`/`types`/`exports` 契约不得破坏；
   - `safety/high-risk-pattern`：禁止 `process.exit`、`eval`、child_process、网络等高危模式；
   - `integrity/edit-anchors`：编辑锚点必须与当前源码精确匹配（防幻觉 diff）；
   - `quality/*`：计划完整性与规模警告。
   产出 `approved / rejected / amend` 三种结论；`error` 级发现直接否决。

3. **Actuator（执行器）**——`plugin/src/actuator.ts`
   在**沙箱目录**内复制插件源码，逐条应用计划中的修改（`edit`/`create`/`delete`），
   校验锚点、拒绝越界路径。**全程不触碰生产目录**；返回沙箱副本路径与逐变更结果。

4. **Tester（测试器）**——`plugin/src/tester.ts`
   对沙箱副本运行多轮验证（默认静态冒烟：清单契约、文件完整性、括号配平；可注入
   基于 `ctx.subprocess` 或沙箱运行器的真实测试）。未通过时把**错误报告**交回
   Analyzer 修订计划再次循环，直到 `maxIterations` 上限。

5. **Cover（部署器）**——`plugin/src/cover.ts`
   测试通过后，在沙箱外部署：先把当前生产插件**快照备份**，再以沙箱产物替换；
   进入**健康观察窗口**，期间累计错误超过阈值即**自动回滚**，并写入谱系。

### 支撑组件

- **EvolutionRegistry（谱系库）**——`plugin/src/registry.ts`
  JSONL 追加式持久化 `EvolveRecord`（父版本→子版本、测试报告、部署/回滚时间），
  天然形成可追溯、可回滚的进化树；`nextVersion` 负责版本号生成。
- **EvolutionEngine（引擎）**——`plugin/src/engine.ts`
  组合五个组件与指标采集器，提供 `ctx.selfEvolution` 服务与事件接线。
- **模型工具**——`plugin/src/tools.ts`
  向 harness 自身模型暴露 `self_evolve_analyze / review / apply / deploy / status / rollback`。

---

## 3. 配套工具集（toolkit）

按 Readme §6「最小可行工具集」实现，均为**零运行时依赖**的独立 CLI + 可编程 API：

| # | 工具 | 模块 | 用途 | 闭环中的角色 |
|---|---|---|---|---|
| 1 | **插件脚手架生成器** | `toolkit/src/scaffold.ts` | 一键生成符合 DSH 包不变式的插件骨架（含可选 client 半身） | 新插件/进化的起点 |
| 2 | **接口契约校验器** | `toolkit/src/contract.ts` | 校验 `private`/`type`/`main`/`types`/`exports`/`files`/`scripts`/`dsh.client` 双面规则 | 晋升/部署门禁 |
| 3 | **沙箱基准测试运行器** | `toolkit/src/sandbox-runner.ts` | 在隔离沙箱执行任务套件；**A/B 对比**基线 vs 候选（回归=失败或显著变慢） | Tester 的沙箱落点 |
| 4 | **Diff 分析器** | `toolkit/src/diff-analyzer.ts` | 行级 LCS diff + 新增**高危模式**检测，输出带行号的审查友好报告 | Inspector 的输入 |
| 5 | **插件版本管理器 + 回滚器** | `toolkit/src/version-manager.ts` | 不可变快照、活动树切换、滑动窗口**健康监控自动回滚** | Cover 的落地实现 |

另有统一 CLI `sep`（见 WORKFLOW.md §6）。

---

## 4. 安全设计（为什么是"稳定安全"的）

| 层次 | 机制 |
|---|---|
| **边界** | 修改只能作用于沙箱副本；生产目录仅由 Cover 在测试通过后替换，且先快照 |
| **否决权** | Inspector 规则集硬编码且不可被进化修改；保护插件列表（core/harness）永不改变 |
| **契约** | 接口契约（`main`/`types`/`exports`）由规则钉死；Diff 分析器可横向复核 |
| **防幻觉** | `edit` 锚点必须与当前文件精确匹配，防止模型生成不落地的修改 |
| **防投毒** | 高危模式（eval、进程退出、子进程、网络）一票否决 |
| **可回滚** | 每次部署生成上一版本快照；健康窗口超阈值自动回滚；谱系全程记录 |
| **审计** | 每个 FixPlan、审查结论、测试报告、部署/回滚事件都以类型化事件广播，可被记录与可视化 |

---

## 5. 安装、构建与配置

### 环境

- Node ≥ 22.19（开发使用 Node v26.7.0）
- pnpm 11.x

### 构建与验证

```sh
pnpm install
pnpm run typecheck      # 插件 + 工具集全量类型检查
pnpm run build          # 编译产出 lib/
pnpm test               # 工具集 24 项单元测试（覆盖 scaffold/contract/diff/bench/version）
```

### 插件配置（`plugin/src/config.ts`）

| 配置项 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `allowlist` | `['*']` | 允许进化的插件；`*` = 除 protected 外全部 |
| `protected` | `['core', 'dsh-agent-loop', 'dsh-session', 'dsh-system-prompt', 'dsh-tools']` | 永不修改 |
| `pluginsRoot` | `./packages` | 生产插件源码根 |
| `sandboxRoot` | `./.evolution-sandbox` | 沙箱目录 |
| `registryFile` | `./.evolution/registry.jsonl` | 谱系文件 |
| `maxIterations` | `3` | 单周期最大分析-测试迭代 |
| `requireApproval` | `false` | 部署前人工审批门禁（预留） |
| `maxPlanBytes` | `256 KiB` | 单计划体积上限 |

---

## 6. 事件与接口

插件按 DSH 约定广播类型化事件（并入 Cordis `Events`）：

```
evolution/plan-created  ·  evolution/plan-approved   ·  evolution/plan-refused
evolution/metrics       ·  evolution/apply-started   ·  evolution/apply-finished
evolution/test-started  ·  evolution/test-finished   ·  evolution/deployed
evolution/rolled-back
```

服务接口 `ctx.selfEvolution`：

```ts
analyze()                      → readonly FixPlan[]
review(plan)                   → InspectorVerdict
apply(plan)                    → ApplyResult（沙箱副本 + 逐变更结果）
test(record, appliedDir)       → TestReport
runCycle(plan)                 → EvolutionCycleResult（review→apply→多轮 test）
deploy(record)                 → EvolveRecord（快照 + 替换 + 记录）
rollback(pluginId, reason?)    → EvolveRecord | undefined
status() / history()           → 状态快照 / 谱系历史
```

---

## 7. 目录结构

```
Self-Evolution-Plugin/
├── Readme.md                  # 需求与设计（本项目依据）
├── SEP.md                     # 自进化插件方案
├── INTRO.md                   # 本文档
├── WORKFLOW.md                # 工作流程文档
├── docs/                      # DSH 文档（只读参考）
├── plugin/                    # DSH 自进化插件（装入 harness）
│   ├── src/
│   │   ├── index.ts           # 插件入口（name/inject/apply/Config）
│   │   ├── config.ts          # schemastery 配置
│   │   ├── types.ts           # 核心领域类型
│   │   ├── events.ts          # 类型化事件
│   │   ├── metrics.ts         # 运行时指标采集
│   │   ├── analyzer.ts        # 分析器
│   │   ├── inspector.ts       # 审查器（不可变规则集）
│   │   ├── actuator.ts        # 执行器（沙箱内修改）
│   │   ├── tester.ts          # 测试器
│   │   ├── cover.ts           # 部署器（备份/替换/健康回滚）
│   │   ├── registry.ts        # 进化谱系库
│   │   ├── engine.ts          # 组合引擎
│   │   ├── tools.ts           # 面向模型的自进化工具
│   │   └── context.ts         # ctx 服务声明合并
│   ├── stubs/                 # 开发期类型契约（dsh-* 离线 typecheck）
│   └── tests/
└── toolkit/                   # 配套工具集（零运行时依赖）
    ├── src/{scaffold,contract,sandbox-runner,diff-analyzer,version-manager,cli,index}.ts
    ├── bin/sep.js             # CLI 启动器
    └── tests/                 # 24 项单元测试
```

---

## 8. 已知限制与后续工作

- **默认 Analyzer 是保守的**：内置生成器对出错源文件做"标注+再评估"，而非重写业务逻辑；
  LLM 生成器可通过 `setGenerator` 注入（这是设计好的接缝）。
- **默认 Tester 是静态冒烟**：不执行真实单测；接入基于沙箱运行器的真实测试运行器后
  可升级为完整回归门禁。
- **部署为文件级替换**：进程内热替换依赖 DSH 的 `ctx.effect` 清理与 HMR 流程，
  本插件完成文件与谱系侧。
- **审批门禁已预留**：`requireApproval` 配置项就绪，人工审批 UI/流程可作为下一步。
- **进化谱系可视化**：谱系数据已完整落盘（JSONL），可对接 Web 面板
  （`dsh.client` 双面打包已支持）。

> 详细操作流程见 **WORKFLOW.md**。
