/**
 * @self-evolution/mcp — MCP server exposing the self-evolution engine.
 *
 * Any MCP-compatible agent (Claude, Cursor, Windsurf, etc.) can use these
 * tools to analyze, review, apply, deploy, and rollback plugin evolutions.
 */
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import * as z from 'zod'
import { EvolutionEngine } from '@self-evolution/core'
import type { EngineOptions, FixPlan } from '@self-evolution/core'

const evidenceSchema = z.object({
  kind: z.enum(['session-log', 'metric', 'source', 'test-report']),
  ref: z.string(),
  summary: z.string(),
})

const changeSchema = z.object({
  file: z.string(),
  kind: z.enum(['edit', 'create', 'delete']),
  oldText: z.string().optional(),
  newText: z.union([z.string(), z.null()]),
  reason: z.string(),
})

const fixPlanShape = {
  planId: z.string(),
  createdAt: z.number(),
  targetPlugin: z.string(),
  targetVersion: z.string(),
  title: z.string(),
  problem: z.string(),
  evidence: z.array(evidenceSchema),
  changes: z.array(changeSchema),
  expectedImpact: z.string(),
  risk: z.enum(['low', 'medium', 'high']),
}

function result(ok: boolean, summary: string, data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ ok, summary, data }, null, 2) }],
    isError: !ok,
  }
}

function createServer(): McpServer {
  const options: EngineOptions = {
    pluginsRoot: process.env.EVOLUTION_PLUGINS_ROOT ?? './packages',
    sandboxRoot: process.env.EVOLUTION_SANDBOX_ROOT ?? './.evolution-sandbox',
    backupRoot: process.env.EVOLUTION_BACKUP_ROOT ?? './.evolution-sandbox/backup',
    registryFile: process.env.EVOLUTION_REGISTRY_FILE ?? './.evolution/registry.jsonl',
    maxIterations: Number(process.env.EVOLUTION_MAX_ITERATIONS ?? '3'),
    allowlist: process.env.EVOLUTION_ALLOWLIST?.split(',') ?? ['*'],
    protectedPlugins: process.env.EVOLUTION_PROTECTED?.split(',') ?? [
      'core', 'dsh-agent-loop', 'dsh-session', 'dsh-system-prompt', 'dsh-tools',
    ],
  }

  const engine = new EvolutionEngine(options)

  const server = new McpServer({
    name: 'self-evolution',
    version: '0.1.0',
  }, {
    capabilities: { tools: {} },
  })

  server.registerTool(
    'self_evolve_analyze',
    {
      description: 'Analyze recent runtime metrics and produce candidate self-evolution fix plans. Each plan must be reviewed before apply.',
    },
    async () => {
      const plans = await engine.analyze()
      return result(true, `${plans.length} candidate plan(s)`, plans.map((p) => ({
        planId: p.planId,
        targetPlugin: p.targetPlugin,
        title: p.title,
        risk: p.risk,
      })))
    },
  )

  server.registerTool(
    'self_evolve_review',
    {
      description: 'Review a fix plan against the immutable safety rules. Returns approved, rejected, or amend.',
      inputSchema: fixPlanShape,
    },
    async (args) => {
      const plan = args as unknown as FixPlan
      const verdict = await engine.review(plan)
      return result(true, `verdict: ${verdict.kind}`, verdict)
    },
  )

  server.registerTool(
    'self_evolve_apply',
    {
      description: 'Apply a reviewed fix plan inside the sandbox and run the test harness. Returns the test report; only a passed report may be deployed.',
      inputSchema: fixPlanShape,
    },
    async (args) => {
      const plan = args as unknown as FixPlan
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
  )

  server.registerTool(
    'self_evolve_deploy',
    {
      description: 'Deploy a passed evolution record outside the sandbox. The previous version is snapshotted for rollback.',
      inputSchema: { recordId: z.string() },
    },
    async (args) => {
      const { recordId } = args as { recordId: string }
      const deployed = await engine.deployRecord(recordId)
      return result(true, `deployed ${deployed.pluginId}@${deployed.childVersion}`, deployed)
    },
  )

  server.registerTool(
    'self_evolve_rollback',
    {
      description: 'Roll a deployed plugin back to its previous stable version (for example after a regression).',
      inputSchema: {
        pluginId: z.string(),
        reason: z.string().optional(),
      },
    },
    async (args) => {
      const { pluginId, reason } = args as { pluginId: string; reason?: string }
      const record = await engine.rollback(pluginId, reason ?? 'manual rollback')
      return result(!!record, record ? `rolled back ${record.pluginId}` : 'nothing to roll back', record ?? null)
    },
  )

  server.registerTool(
    'self_evolve_status',
    {
      description: 'Show the self-evolution system state: enabled, allowlist, protected plugins, active records, and lineage history.',
    },
    async () => {
      return result(true, 'evolution status', engine.status())
    },
  )

  return server
}

void serveStdio(createServer)
console.error('self-evolution MCP server running on stdio')
