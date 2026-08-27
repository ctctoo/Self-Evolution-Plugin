/**
 * Analyzer.
 *
 * Analyzes source and runtime data to find fixable problems and emits
 * `FixPlan`s. The default generator is deterministic: it maps each problem
 * signal to a concrete, minimal `PlannedChange` using signal metadata. A more
 * capable generator (e.g. one backed by an LLM) can be attached through
 * {@link Analyzer.setGenerator}.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EvolveSignal, FixPlan, EvidenceRef } from './types.ts'
import { EvolutionRegistry, nextVersion } from './registry.ts'

/** A plan generator turns signals + source into candidate plans. */
export type PlanGenerator = (
  signal: EvolveSignal,
  targetRoot: string | undefined,
) => FixPlan | undefined

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

function newId(prefix: string): string {
  let out = ''
  for (let i = 0; i < 12; i += 1) {
    out += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]
  }
  return `${prefix}_${Date.now().toString(36)}_${out}`
}

/** Locate a plugin package root by its id under a plugins root. */
export function resolvePluginRoot(pluginsRoot: string, pluginId: string): string | undefined {
  const candidates = [
    join(pluginsRoot, pluginId),
    join(pluginsRoot, 'core', pluginId),
    join(pluginsRoot, 'llm', pluginId),
    join(pluginsRoot, 'support', pluginId),
    join(pluginsRoot, 'util', pluginId),
  ]
  for (const c of candidates) {
    if (existsSync(join(c, 'package.json'))) return c
  }
  return undefined
}

/** Deterministic default plan generator (template-driven, evidence-based). */
export function defaultPlanGenerator(
  signal: EvolveSignal,
  targetRoot: string | undefined,
  options: { maxPlanBytes?: number } = {},
): FixPlan | undefined {
  if (signal.kind !== 'error') return undefined
  if (!targetRoot) return undefined

  const toolRef = signal.ref.includes(':')
    ? signal.ref.split(':').at(-1) ?? signal.ref
    : signal.ref
  const srcPath = `src/tools/${toolRef}.ts`
  const filePath = join(targetRoot, srcPath)

  if (existsSync(filePath)) {
    const content = readFileSync(filePath, 'utf8')
    if (options.maxPlanBytes && Buffer.byteLength(content) > options.maxPlanBytes) {
      return undefined
    }
    const evidence: EvidenceRef[] = [
      { kind: 'metric', ref: signal.ref, summary: signal.summary },
    ]
    return {
      planId: newId('plan'),
      createdAt: Date.now(),
      targetPlugin: signal.plugin,
      targetVersion: 'v1',
      title: `Harden error path of ${toolRef}`,
      problem: signal.summary,
      evidence,
      changes: [
        {
          file: srcPath,
          kind: 'edit',
          oldText: content,
          newText: `/* ${signal.summary} */\n${content}`,
          reason: 'Annotate the failing tool with diagnostic context before re-evaluating.',
        },
      ],
      expectedImpact: 'Reduce silent failures for repeated tool errors.',
      risk: 'medium',
    }
  }
  return undefined
}

/** The Analyzer service: metrics in, fix plans out. */
export class Analyzer {
  #registry: EvolutionRegistry
  #pluginsRoot: string
  #generator: PlanGenerator

  constructor(pluginsRoot: string, registry: EvolutionRegistry, generator: PlanGenerator = defaultPlanGenerator) {
    this.#pluginsRoot = pluginsRoot
    this.#registry = registry
    this.#generator = generator
  }

  /** Replace the plan generator (used to attach an LLM-backed generator). */
  setGenerator(generator: PlanGenerator): void {
    this.#generator = generator
  }

  /** Build fix plans from collected signals. */
  analyze(signals: readonly EvolveSignal[], options: { maxPlanBytes?: number } = {}): readonly FixPlan[] {
    const plans: FixPlan[] = []
    for (const signal of signals) {
      if (this.#registry.active().some((r) => r.pluginId === signal.plugin)) continue
      const targetRoot = resolvePluginRoot(this.#pluginsRoot, signal.plugin)
      const plan = this.#generator(signal, targetRoot)
      if (!plan) continue
      plans.push({
        ...plan,
        targetVersion: this.#registry.currentVersion(signal.plugin),
      })
    }
    return plans
  }

  /** Revise a plan with test feedback for the next iteration. */
  revise(plan: FixPlan, errorReport: string): FixPlan {
    const evidence: EvidenceRef[] = [
      ...plan.evidence,
      { kind: 'test-report', ref: `plan:${plan.planId}`, summary: 'test feedback from previous iteration' },
    ]
    return {
      ...plan,
      problem: `${plan.problem}\n\nTest feedback:\n${errorReport.slice(0, 1000)}`,
      evidence,
      createdAt: Date.now(),
    }
  }
}
