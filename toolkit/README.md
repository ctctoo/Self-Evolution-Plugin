# self-evolution toolkit

The tool belt of the DSH self-evolution plugin. Five standalone,
zero-dependency CLI / library tools that make every mutation of a plugin
**verifiable, reviewable, benchmarked, versioned, and rollback-safe**.

Each tool ships as a pure TypeScript module (importable via the public API)
and as a `sep` CLI subcommand.

## Tools

| Tool | CLI | Purpose | Core deliverable |
|---|---|---|---|
| Scaffold generator | `sep scaffold` | Generate a spec-compliant DSH plugin package | plugin skeleton |
| Interface-contract checker | `sep contract` | Validate a plugin against `docs/adding-a-package.zh.md` invariants | promotion gate |
| Sandbox benchmark runner | `sep bench` | Run task suites in an isolated sandbox; A/B baseline vs candidate | regression gate |
| Diff analyzer | `sep diff` | Structural per-file diff + high-risk marker detection | inspection input |
| Version manager + rollback | `sep version`, `sep health` | Immutable snapshots, active-tree swap, health-driven auto rollback | deploy/rollback |

## Usage

```sh
pnpm install
pnpm run build

# 1. scaffold a new plugin
sep scaffold --name my-tool --dir ./packages/my-tool --group support --with-tests

# 2. gate a plugin before promotion
sep contract --plugin ./packages/my-tool

# 3. compare an evolved candidate against its baseline
sep bench --plugin ./packages/my-tool --baseline ./backup/my-tool@v1 \
          --tasks ./bench-tasks.json --sandbox ./.sep-sandbox

# 4. review what changed
sep diff --base ./backup/my-tool@v1 --candidate ./packages/my-tool

# 5. version it, then let health monitoring roll back if needed
sep version push  --state ./.sep/versions --active ./packages --plugin my-tool --version v2 --source ./packages/my-tool
sep version list --state ./.sep/versions --active ./packages --plugin my-tool
sep health       --state ./.sep/versions --active ./packages --plugin my-tool --max-errors 5 --count 1
```

Run without building: `node src/cli.ts <command> ...` (Node ≥ 23.6 strips types).

## Programmatic API

```ts
import { scaffoldPlugin, checkContract, analyzeDiff, runAb, VersionStore, HealthMonitor } from './src/index.ts'

const report = checkContract('./packages/my-tool')
if (report.ok) {
  const diff = analyzeDiff(baseDir, candidateDir)       // review-friendly
  const ab = await runAb(baseDir, candidateDir, tasks)  // benchmark gate
  const store = new VersionStore(stateDir, activeDir)
  store.snapshot('my-tool', 'v2', candidateDir)
}
```

## Design invariants

- **Zero runtime dependencies** — Node built-ins only; nothing to install beyond dev tooling.
- **Pure, testable cores** — every tool exposes pure functions; CLI is a thin adapter.
- **Read-only by default** — nothing writes outside the sandbox/state/active roots you pass in.
- **Deterministic** — same input, same report (timestamps only in versioning metadata).
