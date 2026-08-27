# Self-Evolution-Plugin — DSH 自进化插件系统

让 **DeepSeek Harness（DSH）** 在**稳定、安全、可回滚**的前提下，以插件为单位
**修改自身源码**，实现**真实的源码级进化**。

> 状态：**已实现完整闭环**（自进化插件 + 配套工具集 + 一键安装脚本）。
> 详细设计见 [INTRO.md](./INTRO.md)，操作流程见 [WORKFLOW.md](./WORKFLOW.md)。

---

## 1. 是什么

DSH 是插件式 harness（基于 Cordis）：一切能力都是插件，通过 `ctx.<key>` 提供服务、
通过类型化事件通信、通过 `ctx.tools` 向模型暴露工具。因此：

- **进化粒度天然是插件**——替换插件就是 卸载 → 替换 → 装入，比修改 harness 内核安全得多；
- **风险可隔离**——一个插件出错只影响该插件，可独立回滚；
- **能力可沉淀**——进化产物是普通插件，可审计、测试、版本管理。

本项目实现一个"自进化闭环"：发现问题 → 制定修复计划 → 规则审查 → 沙箱修改 →
多轮测试 → 部署 → 健康监控 → 自动回滚。

```
DSH 运行事件 ──▶ Analyzer(分析) ──▶ Inspector(审查) ──▶ Actuator(沙箱修改)
                                                          │
                                                          ▼
                        回传错误报告 ◀── 未通过 ── Tester(多轮测试)
                                                          │ 通过
                                                          ▼
                    生产插件 ◀──快照+替换── Cover(部署/回滚) ◀── 进化谱系库
```

---

## 2. 这不是"调参/记忆式进化"，而是真实的源码级进化

> 本插件区别于市面上多数"自进化/自适应"类插件。**其他进化形态只改变运行时的
> 状态或行为，而本插件改变的是 DSH 自身的程序文本。**

### 2.1 与其它"进化"类型的本质区别

| 维度 | 本插件 | 其它"进化"类插件 |
|---|---|---|
| **进化对象** | DSH 插件的**源码文件**（`.ts`/`.js`/`package.json`） | 配置项、工具提示词、记忆/上下文、任务编排参数 |
| **产物** | 可审计、可版本管理的**新插件包** | 运行期内存状态或持久化的"偏好数据" |
| **持久化** | 写入磁盘、替换生产插件，**重启后仍生效** | 多数随会话/配置丢失，或只是调用策略 |
| **验证** | 沙箱编译 → 多轮测试 → 契约校验 → A/B 基准 → 健康监控 | 仅离线评分或在线对比 |
| **回滚** | 按谱系快照**原子回滚到任一历史版本** | 通常只能回滚到"初始配置" |
| **进化力上限** | 可新增函数、修复 bug、重构逻辑、增强工具 | 受限于"可调参数的组合空间" |

### 2.2 "源码级进化"到底指什么

进化后的结果**不是**一张参数表，而是一份**实实在在写回源码树的修改**：

- 分析器把运行问题映射为 `FixPlan`——带**逐文件、逐锚点**的修改方案（`edit`/`create`/`delete`）；
- 执行器在沙箱内**复制真实源码**并按方案改写，产出可被 TypeScript 重新编译的插件；
- 审查器用**编辑锚点精确匹配**杜绝"幻觉 diff"，用接口契约不变式保证产物仍是合法 DSH 插件；
- 部署器用沙箱产物**替换生产插件源码目录**，并通过谱系库把每一次进化固化为不可变版本。

换句话说：**DSH 是在改自己的"源代码"，而不是在"调自己的旋钮"**。这正是本插件
与普通自进化工具的本质分水岭——它的进化是**文本级、可编译、可测试、可回滚**的。

### 2.3 为什么插件级源码进化是安全可行解

- DSH 本身就是插件式微内核，**替换插件即替换能力**，无需触碰 harness 内核；
- 每次修改都落在**沙箱副本**，生产目录只在测试通过后原子替换；
- 不可变的 Inspector 规则集提供**否决权**，保护列表（core/harness）永不改变；
- 每条进化都有**谱系记录**，可在任意时刻按快照回滚。

---

## 3. 已实现组件

### 3.1 自进化插件（`plugin/`）

可装入 DSH 的 Cordis 插件，实现闭环五步 + 支撑组件：

| 模块 | 职责 |
|---|---|
| `analyzer.ts` | 监听运行事件、聚合指标，输出带证据的 **FixPlan**；可注入 LLM 生成器 |
| `inspector.ts` | 9 条**硬编码不可变**规则集（allowlist/protected、路径穿越、manifest 契约、高危模式、编辑锚点等），拥有否决权 |
| `actuator.ts` | 在沙箱内复制并修改源码，全程不触碰生产目录 |
| `tester.ts` | 多轮验证，失败携错误报告回传 Analyzer 循环，达上限终止 |
| `cover.ts` | 快照备份 → 替换部署 → 健康窗口 → 自动回滚 |
| `registry.ts` | JSONL 进化谱系库（父→子版本、测试报告、部署/回滚时间） |
| `engine.ts` | 组合五步 + 指标采集，提供 `ctx.selfEvolution` 服务 |
| `tools.ts` | 面向模型的自进化工具 |
| `events.ts` | 10 类 `evolution/*` 类型化事件 |
| `config.ts` | schemastery 配置（allowlist/protected/pluginsRoot/maxIterations 等） |

模型侧可调用六个工具：`self_evolve_analyze / review / apply / deploy / status / rollback`。

### 3.2 配套工具集（`toolkit/`，零运行时依赖）

对应 Readme 最初设想的"最小可行工具集"，全部实现为 **CLI + 可编程 API**：

| 工具 | CLI | 模块 | 作用 |
|---|---|---|---|
| 插件脚手架生成器 | `sep scaffold` | `scaffold.ts` | 一键生成符合 DSH 包不变式的插件骨架（含可选 client 半身） |
| 接口契约校验器 | `sep contract` | `contract.ts` | 校验 `private`/`type`/`main`/`types`/`exports`/`files`/`dsh.client` 双面规则 |
| 沙箱基准测试运行器 | `sep bench` | `sandbox-runner.ts` | 隔离沙箱执行任务套件；**A/B 对比**基线 vs 候选 |
| Diff 分析器 | `sep diff` | `diff-analyzer.ts` | 行级 LCS diff + 新增高危模式检测，输出带行号审查报告 |
| 版本管理器 + 自动回滚 | `sep version`/`sep health` | `version-manager.ts` | 不可变快照、活动树切换、健康监控自动回滚 |

### 3.3 一键安装（`scripts/`）

DSH 为插件提供统一安装入口，本项目封装为一条命令即可完成（跨平台）：

```sh
pnpm install:dsh          # 默认本地构建 → web profile
pnpm install:dsh:tui      # → tui 终端
pnpm install:dsh:dry      # 试运行（只打印，不改动）
```

底层优先调用官方 `dsh plugin --profile <p> add <source>`；无 `dsh` 命令时自动回退
为在 profile 目录 `pnpm add` + 注入 `cordis.patch.yml` 组合清单。详见 [scripts/README.md](./scripts/README.md)。

---

## 4. 快速开始

### 环境

- Node ≥ 22.19（开发使用 Node v26.7.0）
- pnpm 11.x

### 构建与验证

```sh
pnpm install
pnpm run typecheck      # 插件 + 工具集全量类型检查
pnpm run build          # 编译产出 lib/
pnpm test               # 工具集 24 项单元测试
```

### 装入 DSH

```sh
pnpm install:dsh        # 一键安装到 web profile
dsh --profile web       # 重启进入，设置 → 插件列表查看 self-evolution
```

---

## 5. 设计要点

- **边界**：修改只作用于沙箱副本；生产目录仅由 Cover 在测试通过后替换，且先快照。
- **否决权**：Inspector 规则集硬编码不可被进化修改；保护插件列表永不改变。
- **契约**：接口契约（`main`/`types`/`exports`）由规则钉死；Diff 分析器可横向复核。
- **防幻觉**：`edit` 锚点必须与当前文件精确匹配，防止模型生成不落地的修改。
- **可回滚**：每次部署生成上一版本快照；健康窗口超阈值自动回滚；谱系全程记录。
- **审计**：每个 FixPlan、审查结论、测试报告、部署/回滚事件都以类型化事件广播。

---

## 6. 文档导航

| 文档 | 内容 |
|---|---|
| [INTRO.md](./INTRO.md) | 完整介绍：架构、组件、安全设计、配置、事件接口、目录结构、已知限制 |
| [WORKFLOW.md](./WORKFLOW.md) | 工作流程：端到端流程、各环节契约、审查清单、`sep` CLI 手册、一键安装 |
| [scripts/README.md](./scripts/README.md) | 一键安装脚本使用说明 |
| [toolkit/README.md](./toolkit/README.md) | 工具集 API 与 CLI 手册 |
| [Readme.md](./Readme.md) | 本文档（项目入口） |
| [SEP.md](./SEP.md) | 自进化插件原始方案 |
| [docs/](./docs/) | DSH 官方文档（只读参考） |

---

## 7. 已知限制与后续工作

- 默认 Analyzer 为保守规则模板，LLM 生成器是设计好的接缝（`setGenerator` 注入）。
- 默认 Tester 为静态冒烟，可接入沙箱运行器升级为完整回归门禁。
- 部署为文件级替换，进程内热替换依赖 DSH 的 `ctx.effect` 清理与 HMR 流程。
- 审批门禁（`requireApproval`）已预留，人工审批 UI 可作为下一步。
- 进化谱系已完整落盘，可对接 Web 面板（`dsh.client` 双面打包已支持）。
