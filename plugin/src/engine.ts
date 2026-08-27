/**
 * EvolutionEngine — the composite service behind `ctx.selfEvolution`.
 *
 * Wires the five loop components (Analyzer, Inspector, Actuator, Tester,
 * Cover) plus the metrics collector and the lineage registry, and attaches
 * DSH event listeners so runtime signals flow into the loop and health
 * monitoring feeds automatic rollback.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { FixPlan, ApplyResult, TestReport, EvolveRecord, InspectorVerdict, EvolutionStatus, EvolutionCycleResult, SelfEvolutionService } from './types.ts'
import { EvolutionRegistry } from './registry.ts'
import { MetricsCollector } from './metrics.ts'
import { Analyzer, resolvePluginRoot } from './analyzer.ts'
import { Inspector, INSPECTOR_RULES } from './inspector.ts'
import { Actuator } from './actuator.ts'
import { Tester } from './tester.ts'
import { Cover } from './cover.ts'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

export interface EngineOptions {
  readonly pluginsRoot: string
  readonly sandboxRoot: string
  readonly backupRoot: string
  readonly registryFile: string
  readonly maxIterations: number
  readonly allowlist: readonly string[]
  readonly protectedPlugins: readonly string[]
}

const ENGINE_VERSION = '0.1.0'

/** The composite self-evolution service. */
export class EvolutionEngine implements SelfEvolutionService {
  readonly registry: EvolutionRegistry
  readonly metrics: MetricsCollector
  readonly analyzer: Analyzer
  readonly inspector: Inspector
  readonly actuator: Actuator
  readonly tester: Tester
  readonly cover: Cover

  #options: EngineOptions
  #pluginNames = new Map<string, string>()

  constructor(options: EngineOptions) {
    this.#options = options
    this.registry = new EvolutionRegistry(options.registryFile)
    this.metrics = new MetricsCollector()
    this.analyzer = new Analyzer(options.pluginsRoot, this.registry)
    this.inspector = new Inspector(INSPECTOR_RULES)
    this.actuator = new Actuator(options.sandboxRoot, options.pluginsRoot, this.registry)
    this.tester = new Tester(undefined, options.maxIterations)
    this.cover = new Cover(options.pluginsRoot, options.backupRoot, this.registry)
    this.#indexPluginNames()
  }

  /** Index `package.json#name` → plugin id for error attribution. */
  #indexPluginNames(): void {
    const root = this.#options.pluginsRoot
    if (!existsSync(root)) return
    const scan = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (!statSync(full).isDirectory()) continue
        if (entry === 'node_modules' || entry === '.evolution-sandbox') continue
        const manifest = join(full, 'package.json')
        if (existsSync(manifest)) {
          try {
            const pkg = JSON.parse(readFileSync(manifest, 'utf8')) as { name?: string }
            if (pkg.name) this.#pluginNames.set(pkg.name, entry)
          } catch {
            // Ignore unparseable manifests.
          }
        } else {
          scan(full)
        }
      }
    }
    scan(root)
  }

  /** Attach DSH event listeners. Returns a disposer. */
  attach(ctx: Context): () => void {
    const disposers: (() => void)[] = []

    disposers.push(
      ctx.on('agent/error', (payload) => {
        const text = String(payload.error ?? '')
        let attributed = false
        for (const [name, id] of this.#pluginNames) {
          if (text.includes(name)) {
            this.metrics.recordError(id)
            this.cover.observeError(id)
            attributed = true
          }
        }
        if (!attributed) this.metrics.recordError('harness')
      }),
    )

    disposers.push(
      ctx.on('tools/result', (_exec, result) => {
        if (result.isError) this.metrics.recordError('unknown')
      }),
    )

    disposers.push(
      ctx.on('session/event', (_session, event: SessionEvent) => {
        if (event.type === 'turn/end') {
          const reason = (event.data as { reason?: unknown }).reason
          if (reason && typeof reason === 'object' && (reason as { kind?: string }).kind === 'aborted') {
            this.metrics.recordAbortedTurn()
          }
        }
      }),
    )

    return () => {
      for (const dispose of disposers) dispose()
    }
  }

  /** Resolve a plan reference (full object or planId). */
  async resolvePlan(planOrId: FixPlan | string, signal?: AbortSignal): Promise<FixPlan> {
    if (typeof planOrId !== 'string') return planOrId
    const plans = await this.analyze({ signal })
    const found = plans.find((p) => p.planId === planOrId)
    if (!found) throw new Error(`plan not found: ${planOrId}`)
    return found
  }

  async analyze(options?: { signal?: AbortSignal }): Promise<readonly FixPlan[]> {
    void options?.signal
    return this.analyzer.analyze(this.metrics.signals(), { maxPlanBytes: 256 * 1024 })
  }

  async review(plan: FixPlan): Promise<InspectorVerdict> {
    const targetRoot = resolvePluginRoot(this.#options.pluginsRoot, plan.targetPlugin)
    return this.inspector.review(plan, {
      evolutionAllowlist: this.#options.allowlist,
      protectedPlugins: this.#options.protectedPlugins,
      targetRoot,
    })
  }

  async apply(plan: FixPlan): Promise<ApplyResult> {
    return this.actuator.apply(plan)
  }

  async test(record: EvolveRecord, appliedDir: string): Promise<TestReport> {
    const plan: FixPlan = {
      planId: record.planId,
      createdAt: 0,
      targetPlugin: record.pluginId,
      targetVersion: record.parentVersion,
      title: `Evolution ${record.recordId}`,
      problem: `Evolution of ${record.pluginId} from ${record.parentVersion} to ${record.childVersion}.`,
      evidence: [],
      changes: record.filesChanged.map((file) => ({ file, kind: 'edit', oldText: '', newText: '', reason: '' })),
      expectedImpact: '',
      risk: 'low',
    }
    return this.tester.run(plan, appliedDir, record.recordId)
  }

  /** Run one full evolution cycle: review → apply → multi-round test. */
  async runCycle(plan: FixPlan): Promise<EvolutionCycleResult> {
    const verdict = await this.review(plan)
    if (verdict.kind !== 'approved') {
      const aborted: EvolveRecord = {
        recordId: `rec_${plan.planId}`,
        planId: plan.planId,
        pluginId: plan.targetPlugin,
        parentVersion: plan.targetVersion,
        childVersion: plan.targetVersion,
        status: 'aborted',
        filesChanged: [],
        verdict,
      }
      this.registry.append(aborted)
      return { record: aborted, passed: false, iterations: 0 }
    }

    let current = plan
    let lastReport: TestReport | undefined
    for (let iteration = 0; iteration < this.tester.maxIterations; iteration += 1) {
      const applied = this.actuator.apply(current)
      if (applied.record.status === 'aborted') {
        return { record: applied.record, passed: false, iterations: iteration + 1 }
      }
      const report = await this.tester.run(current, applied.appliedDir, applied.record.recordId)
      lastReport = report
      if (report.passed) {
        const passed = this.registry.update(applied.record.recordId, {
          status: 'passed',
          testReport: report,
        })!
        return { record: passed, passed: true, iterations: iteration + 1, lastReport: report }
      }
      // Not passed: hand the error report back to the Analyzer and retry.
      this.registry.update(applied.record.recordId, { status: 'test-failed', testReport: report })
      current = this.analyzer.revise(current, report.errorReport ?? 'no details')
    }
    const failed = this.registry.active().find((r) => r.planId === plan.planId)
    if (failed) {
      const record = this.registry.update(failed.recordId, { status: 'test-failed', testReport: lastReport })
      if (record) return { record, passed: false, iterations: this.tester.maxIterations, lastReport }
    }
    throw new Error('evolution cycle did not settle')
  }

  /** Deploy a passed record by id. */
  async deployRecord(recordId: string, _signal?: AbortSignal): Promise<EvolveRecord> {
    const record = this.registry.get(recordId)
    if (!record) throw new Error(`record not found: ${recordId}`)
    if (record.status !== 'passed') {
      throw new Error(`record ${recordId} is ${record.status}; only passed records may be deployed`)
    }
    const appliedDir = join(this.#options.sandboxRoot, `${record.pluginId}@${record.childVersion}`)
    return this.cover.deploy(record, appliedDir)
  }

  async deploy(record: EvolveRecord): Promise<EvolveRecord> {
    return this.deployRecord(record.recordId)
  }

  async rollback(pluginId: string, reason?: string): Promise<EvolveRecord | undefined> {
    return this.cover.rollback(pluginId, reason)
  }

  status(): EvolutionStatus {
    return {
      enabled: true,
      allowlist: [...this.#options.allowlist],
      protected: [...this.#options.protectedPlugins],
      version: ENGINE_VERSION,
      activeRecords: this.registry.active(),
      historyCount: this.registry.size,
    }
  }

  history(): readonly EvolveRecord[] {
    return this.registry.history()
  }
}
