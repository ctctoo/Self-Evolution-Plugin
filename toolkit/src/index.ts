/**
 * Public API of the self-evolution toolkit.
 */
export { scaffoldPlugin, packageId } from './scaffold.ts'
export type { ScaffoldOptions } from './scaffold.ts'

export { checkContract, CONTRACT_RULES } from './contract.ts'
export type { ContractRule } from './contract.ts'

export { analyzeDiff, diffLines, RISK_MARKERS } from './diff-analyzer.ts'

export { prepareSandbox, runBenchmark, compareAb, runAb } from './sandbox-runner.ts'

export { VersionStore, HealthMonitor } from './version-manager.ts'

export type {
  PluginManifest,
  ContractFinding,
  ContractReport,
  BenchmarkTask,
  BenchmarkResult,
  AbComparison,
  AbVerdict,
  FileDiff,
  DiffReport,
  VersionEntry,
  HealthPolicy,
} from './types.ts'
