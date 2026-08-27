/**
 * Model-facing self-evolution tools.
 *
 * These tools expose the evolution loop to the harness's own agent: propose
 * (analyze), review (inspect), apply+test (actuate), deploy (cover), status,
 * and rollback. They are thin adapters over the EvolutionEngine from
 * @self-evolution/core.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolOutputDefinition, ContentBlock } from '@deepseek-ai/dsh-tools'
import type { FixPlan, EvolutionEngine } from '@self-evolution/core'

/** Standard JSON output contract shared by every evolution tool. */
const output: ToolOutputDefinition = {
  schema: {
    type: 'object',
    properties: {
      ok: { type: 'boolean', description: 'Whether the operation succeeded' },
      summary: { type: 'string', description: 'Human-readable one-line result' },
      data: { type: 'json', description: 'Structured result payload' },
    },
    required: ['ok', 'summary', 'data'],
    additionalProperties: false,
  },
  render: (_args: unknown, value: unknown): ContentBlock[] => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

function result(ok: boolean, summary: string, data: unknown) {
  return { ok, summary, data }
}

/** Register every self-evolution tool on `ctx.tools`. */
export function registerEvolutionTools(ctx: Context, engine: EvolutionEngine): () => void {
  const disposers: (() => void)[] = []

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'self_evolve_analyze',
        description: 'Analyze recent runtime metrics and produce candidate self-evolution fix plans. Each plan must be reviewed before apply.',
        parameters: {},
        output,
        execute: async (_args, exec) => {
          const plans = await engine.analyze({ signal: exec.signal })
          return result(true, `${plans.length} candidate plan(s)`, plans.map((p) => ({
            planId: p.planId,
            targetPlugin: p.targetPlugin,
            title: p.title,
            risk: p.risk,
          })))
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'self_evolve_review',
        description: 'Review a fix plan against the immutable safety rules. Returns approved, rejected, or amend.',
        parameters: {
          plan: {
            type: 'json',
            required: true,
            description: 'The full FixPlan object as produced by self_evolve_analyze (or a planId to look up).',
          },
        },
        output,
        execute: async (args: { plan: FixPlan | string }, exec) => {
          const plan = await engine.resolvePlan(args.plan, exec.signal)
          const verdict = await engine.review(plan)
          return result(true, `verdict: ${verdict.kind}`, verdict)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'self_evolve_apply',
        description: 'Apply a reviewed fix plan inside the sandbox and run the test harness. Returns the test report; only a passed report may be deployed.',
        parameters: {
          plan: {
            type: 'json',
            required: true,
            description: 'The full FixPlan object (or a planId to look up).',
          },
        },
        output,
        execute: async (args: { plan: FixPlan | string }, exec) => {
          const plan = await engine.resolvePlan(args.plan, exec.signal)
          const cycle = await engine.runCycle(plan)
          return result(
            cycle.passed,
            cycle.passed
              ? `passed after ${cycle.iterations} iteration(s)`
              : `failed after ${cycle.iterations} iteration(s)`,
            {
              recordId: cycle.record.recordId,
              childVersion: cycle.record.childVersion,
              passed: cycle.passed,
              iterations: cycle.iterations,
              report: cycle.lastReport,
            },
          )
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'self_evolve_deploy',
        description: 'Deploy a passed evolution record outside the sandbox. The previous version is snapshotted for rollback.',
        parameters: {
          recordId: { type: 'string', required: true, description: 'The record id returned by self_evolve_apply.' },
        },
        output,
        execute: async (args: { recordId: string }, exec) => {
          const deployed = await engine.deployRecord(args.recordId, exec.signal)
          return result(true, `deployed ${deployed.pluginId}@${deployed.childVersion}`, deployed)
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'self_evolve_status',
        description: 'Show the self-evolution system state: enabled, allowlist, protected plugins, active records, and lineage history.',
        parameters: {},
        output,
        execute: async () => {
          return result(true, 'evolution status', engine.status())
        },
      }),
    ),
  )

  disposers.push(
    ctx.tools.register(
      defineTool({
        name: 'self_evolve_rollback',
        description: 'Roll a deployed plugin back to its previous stable version (for example after a regression).',
        parameters: {
          pluginId: { type: 'string', required: true, description: 'The plugin id to roll back.' },
          reason: { type: 'string', description: 'Optional rollback rationale.' },
        },
        output,
        execute: async (args: { pluginId: string; reason?: string }, exec) => {
          const record = await engine.rollback(args.pluginId, args.reason ?? 'manual rollback')
          return result(!!record, record ? `rolled back ${record.pluginId}` : 'nothing to roll back', record ?? null)
        },
      }),
    ),
  )

  return () => {
    for (const dispose of disposers) dispose()
  }
}
