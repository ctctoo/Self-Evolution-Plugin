/**
 * Core domain types for the self-evolution system.
 *
 * These types model the controlled-evolution loop: an Analyzer emits
 * `FixPlan`s, an Inspector reviews them against immutable rules, an Actuator
 * applies them inside a sandbox, a Tester validates them, and a Cover
 * deploys the verified plugin outside the sandbox while keeping lineage and
 * rollback records.
 */

/** A reference to evidence that motivated a fix proposal. */
export interface EvidenceRef {
  /** Source category of the evidence. */
  readonly kind: 'session-log' | 'metric' | 'source' | 'test-report'
  /** Stable locator (session id + seq, metric name + bucket, or source path). */
  readonly ref: string
  /** One-line summary of what the evidence shows. */
  readonly summary: string
}

/** One planned mutation to a plugin source file. */
export interface PlannedChange {
  /** Target file path, relative to the plugin package root. */
  readonly file: string
  readonly kind: 'edit' | 'create' | 'delete'
  /** For `edit`: the exact text to replace (must match the current file). */
  readonly oldText?: string
  /** Replacement content (`null` for `delete`). */
  readonly newText: string | null
  /** Why this change is made. */
  readonly reason: string
}

/** A self-evolution proposal: what is wrong and how to fix it. */
export interface FixPlan {
  readonly planId: string
  readonly createdAt: number
  /** Target plugin identity. */
  readonly targetPlugin: string
  /** Version of the plugin this plan modifies (the parent in the lineage). */
  readonly targetVersion: string
  readonly title: string
  /** Problem description derived from evidence. */
  readonly problem: string
  readonly evidence: readonly EvidenceRef[]
  readonly changes: readonly PlannedChange[]
  readonly expectedImpact: string
  /** Estimated blast radius. */
  readonly risk: 'low' | 'medium' | 'high'
}

/** An inspector finding about a plan. */
export interface InspectorFinding {
  readonly ruleId: string
  readonly severity: 'error' | 'warning'
  readonly message: string
}

/** The result of inspecting a `FixPlan`. */
export type InspectorVerdict =
  | { readonly kind: 'approved'; readonly planId: string; readonly reviewer: string; readonly notes: readonly string[] }
  | { readonly kind: 'rejected'; readonly planId: string; readonly reviewer: string; readonly reasons: readonly string[] }
  | { readonly kind: 'amend'; readonly planId: string; readonly reviewer: string; readonly required: readonly string[] }

/** One immutable inspection rule. */
export interface InspectorRule {
  readonly id: string
  /** `error` blocks approval; `warning` is advisory and can be waived. */
  readonly severity: 'error' | 'warning'
  /** Pure rule check: no I/O, no clock, no randomness. */
  check(plan: FixPlan, context: InspectionContext): readonly InspectorFinding[]
}

/** Read-only context passed to inspector rules. */
export interface InspectionContext {
  /** Global plugin allowlist (`*` = every plugin may evolve). */
  readonly evolutionAllowlist: readonly string[]
  /** Hard-coded denylist (core harness and protected plugins never change). */
  readonly protectedPlugins: readonly string[]
  /** Plugin package root directory of the target plugin (for source checks). */
  readonly targetRoot: string | undefined
}

/** One executed test case. */
export interface TestCaseResult {
  readonly caseId: string
  readonly name: string
  readonly passed: boolean
  readonly durationMs: number
  readonly detail?: string
}

/** The outcome of validating an evolved plugin in the sandbox. */
export interface TestReport {
  readonly runId: string
  readonly recordId: string
  readonly planId: string
  readonly passed: boolean
  readonly results: readonly TestCaseResult[]
  /** Verbose error report handed back to the Analyzer for the next iteration. */
  readonly errorReport?: string
}

/** Lifecycle state of one evolution record. */
export type EvolveRecordStatus =
  | 'running'
  | 'test-failed'
  | 'passed'
  | 'deployed'
  | 'rolled-back'
  | 'aborted'

/** One node in the evolution lineage tree. */
export interface EvolveRecord {
  readonly recordId: string
  readonly planId: string
  readonly pluginId: string
  /** The version this record evolves FROM (parent lineage). */
  readonly parentVersion: string
  /** The version this record produces. */
  readonly childVersion: string
  readonly status: EvolveRecordStatus
  readonly filesChanged: readonly string[]
  readonly verdict: InspectorVerdict
  readonly testReport?: TestReport
  readonly deployedAt?: number
  readonly rollbackAt?: number
  /** One-line rationale for rollback, when rolled back. */
  readonly rollbackReason?: string
}

/** A problem signal collected from runtime data (the Analyzer's raw input). */
export interface EvolveSignal {
  readonly kind: 'error' | 'slow' | 'waste' | 'regression'
  readonly plugin: string
  readonly ref: string
  readonly summary: string
  readonly occurrences: number
  readonly firstSeen: number
  readonly lastSeen: number
}

/** Aggregated runtime metrics the Analyzer derives from events. */
export interface EvolutionMetrics {
  /** Error count per plugin id. */
  readonly errorsByPlugin: ReadonlyMap<string, number>
  /** Average tool latency per tool name (ms). */
  readonly latencyByTool: ReadonlyMap<string, { readonly count: number; readonly totalMs: number }>
  /** Count of failed tool calls per tool name. */
  readonly toolFailures: ReadonlyMap<string, number>
  /** Turns aborted per plugin source (injected context, cancellation). */
  readonly abortedTurns: number
}

/** The public self-evolution service surface. */
export interface SelfEvolutionService {
  /** Run one evolution cycle for a candidate plan (review → apply → test). */
  runCycle(plan: FixPlan): Promise<EvolutionCycleResult>
  /** Analyze recent runtime data and produce fix plans. */
  analyze(options?: { signal?: AbortSignal }): Promise<readonly FixPlan[]>
  /** Review a plan against the immutable rule set. */
  review(plan: FixPlan): Promise<InspectorVerdict>
  /** Apply a plan inside the sandbox (no production side effects). */
  apply(plan: FixPlan): Promise<ApplyResult>
  /** Run the multi-round test harness on a sandboxed evolution. */
  test(record: EvolveRecord, appliedDir: string): Promise<TestReport>
  /** Deploy a passed evolution outside the sandbox. */
  deploy(record: EvolveRecord): Promise<EvolveRecord>
  /** Roll the given plugin back to the previous stable version. */
  rollback(pluginId: string, reason?: string): Promise<EvolveRecord | undefined>
  /** Current lineage and runtime state. */
  status(): EvolutionStatus
  /** Full lineage history, newest first. */
  history(): readonly EvolveRecord[]
}

/** Result of applying a plan inside the sandbox. */
export interface ApplyResult {
  readonly record: EvolveRecord
  /** Absolute path of the sandboxed plugin copy with the changes applied. */
  readonly appliedDir: string
  /** Per-change application outcome. */
  readonly applied: readonly { readonly file: string; readonly ok: boolean; readonly detail?: string }[]
}

/** Outcome of one full evolution cycle. */
export interface EvolutionCycleResult {
  readonly record: EvolveRecord
  readonly passed: boolean
  readonly iterations: number
  readonly lastReport?: TestReport
}

/** Snapshot of the evolution system state. */
export interface EvolutionStatus {
  readonly enabled: boolean
  readonly allowlist: readonly string[]
  readonly protected: readonly string[]
  readonly version: string
  readonly activeRecords: readonly EvolveRecord[]
  readonly historyCount: number
}
