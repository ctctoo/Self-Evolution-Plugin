# DSH self-evolution plugin

Controlled self-evolution for DeepSeek Harness at the *plugin layer*.

The plugin implements the closed loop from the project Readme:

```text
运行日志 / 指标 / trace
        ↓
   Analyzer  —— 分析源码与运行日志，发现可修改问题，输出 FixPlan
        ↓
   Inspector —— 按硬编码规则与约束审查 FixPlan（否决权，只读）
        ↓
   Actuator  —— 在沙箱内对插件源码副本应用修改
        ↓
   Tester   —— 多轮测试；未通过则携错误报告返回 Analyzer 再次循环
        ↓
   Cover    —— 沙箱外部署（快照备份 → 替换 → 健康监控 → 自动回滚）
```

## Service API

`ctx.selfEvolution` (`SelfEvolutionService`)

| Method | Purpose |
|---|---|
| `analyze()` | Derive candidate `FixPlan`s from collected runtime metrics. |
| `review(plan)` | Review a plan against the immutable rule set → `InspectorVerdict`. |
| `apply(plan)` | Apply a plan inside the sandbox (never touches production). |
| `test(record, appliedDir)` | Run the test harness on a sandboxed copy. |
| `runCycle(plan)` | review → apply → multi-round test; returns the settled record. |
| `deploy(record)` | Deploy a passed evolution outside the sandbox (snapshot + replace). |
| `rollback(pluginId, reason?)` | Restore the previous stable version. |
| `status()` / `history()` | Lineage snapshot / newest-first history. |

## Events

Emitted on `ctx` (declaration-merged into Cordis `Events`):

`evolution/plan-created` · `evolution/plan-approved` · `evolution/plan-refused` ·
`evolution/metrics` · `evolution/apply-started` · `evolution/apply-finished` ·
`evolution/test-started` · `evolution/test-finished` · `evolution/deployed` ·
`evolution/rolled-back`

## Tools (model-facing)

Registered on `ctx.tools`:

`self_evolve_analyze` · `self_evolve_review` · `self_evolve_apply` ·
`self_evolve_deploy` · `self_evolve_status` · `self_evolve_rollback`

## Configuration

See `src/config.ts`. Key fields: `enabled`, `allowlist` (plugins allowed to
evolve, `['*']` for all non-protected), `protected` (never modified),
`pluginsRoot`, `sandboxRoot`, `registryFile`, `maxIterations`,
`requireApproval`, `maxPlanBytes`.

## Design notes

- **Immutable core**: the inspector rule set and the protected-plugin denylist
  are hard-coded; an evolution plan can never alter them.
- **Interface contract preserved**: package.json `main`/`types`/`exports` are
  pinned by an inspector rule; `scope/file-scope` rejects path traversal.
- **High-risk patterns** (`process.exit`, `eval`, child-process spawn,
  network) block approval in `safety/high-risk-pattern`.
- **Reversible deployment**: every deploy snapshots the previous source; the
  health window rolls back automatically when error counts cross a threshold.

## Development

The DSH packages (`@deepseek-ai/*`) are peer dependencies resolved from the
DSH workspace at runtime. `cordis` and `schemastery` are installed from npm;
the not-yet-published `dsh-tools` / `dsh-session` / `dsh-llm` are mapped in
`tsconfig.json` to `stubs/` — development-time type contracts transcribed
from `docs/`. Keep the stubs in sync with the upstream packages.

```sh
pnpm install
pnpm run typecheck
pnpm run build
```

## Known Limitations and Deferred Work

- **Deterministic default Analyzer** — the built-in plan generator annotates
  the failing source rather than rewriting logic; an LLM-backed generator can
  be attached via `Analyzer.setGenerator`. This is the intended seam.
- **Static smoke Tester** — the default runner validates manifests, file
  presence, and brace balance without executing unit tests; attach a
  subprocess-backed runner (e.g. the sandbox-runner tool) for real suites.
- **Restart-only deployment** — the plugin swaps package files; in-process hot
  reload relies on DSH's HMR (`ctx.effect` teardown) and is exercised by the
  harness reload flow, not by this plugin.
