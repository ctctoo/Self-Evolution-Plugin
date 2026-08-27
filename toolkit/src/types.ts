/**
 * Shared toolkit types: the plugin interface contract, contract-check
 * findings, benchmark outcomes, diff analysis, and version state.
 */

/** The enforced DSH package manifest contract (docs/adding-a-package.zh.md). */
export interface PluginManifest {
  name: string
  version: string
  private?: boolean
  type?: 'module'
  main?: string
  types?: string
  exports?: Record<string, unknown>
  files?: string[]
  scripts?: Record<string, string>
  peerDependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  dependencies?: Record<string, string>
  /** Dual-face declaration (`dsh.client` / `dsh.interface`). */
  dsh?: {
    client?: unknown
    interface?: unknown
  }
}

/** One interface-contract finding. */
export interface ContractFinding {
  readonly file: string
  readonly rule: string
  readonly severity: 'error' | 'warning'
  readonly message: string
}

/** Contract-check summary. */
export interface ContractReport {
  readonly plugin: string
  readonly dir: string
  readonly ok: boolean
  readonly findings: readonly ContractFinding[]
}

/** One benchmark task executed against a plugin sandbox. */
export interface BenchmarkTask {
  readonly id: string
  readonly name: string
  /** Shell command executed inside the sandbox (cwd = plugin copy). */
  readonly command: string
  readonly timeoutMs?: number
}

/** The outcome of one task run. */
export interface BenchmarkResult {
  readonly taskId: string
  readonly name: string
  readonly passed: boolean
  readonly durationMs: number
  readonly output: string
  readonly error?: string
}

/** A/B comparison verdict of baseline vs candidate. */
export type AbVerdict = 'pass' | 'fail' | 'warn'

/** A/B benchmark comparison report. */
export interface AbComparison {
  readonly baseline: readonly BenchmarkResult[]
  readonly candidate: readonly BenchmarkResult[]
  readonly regressions: readonly string[]
  readonly improvements: readonly string[]
  readonly verdict: AbVerdict
}

/** One file-level change in a diff analysis. */
export interface FileDiff {
  readonly path: string
  readonly status: 'added' | 'removed' | 'modified' | 'unchanged'
  readonly addedLines: number
  readonly removedLines: number
  /** Risk markers newly introduced by the change. */
  readonly riskMarkers: readonly string[]
  /** First line numbers touched (1-based), for review agents. */
  readonly hunks: readonly { readonly start: number; readonly lines: readonly string[] }[]
}

/** Full diff-analysis report. */
export interface DiffReport {
  readonly baseDir: string
  readonly candidateDir: string
  readonly files: readonly FileDiff[]
  readonly summary: {
    readonly added: number
    readonly removed: number
    readonly modified: number
    readonly addedLines: number
    readonly removedLines: number
    readonly riskMarkers: number
  }
  readonly riskLevel: 'none' | 'low' | 'high'
}

/** One entry in the version ledger. */
export interface VersionEntry {
  readonly pluginId: string
  readonly version: string
  readonly createdAt: number
  readonly sourceDir: string
  readonly commitMessage?: string
  readonly healthStatus?: 'healthy' | 'unhealthy' | 'unknown'
}

/** Health-monitor config for automatic rollback. */
export interface HealthPolicy {
  readonly maxErrors: number
  readonly windowMs: number
}
