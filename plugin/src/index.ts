/**
 * DSH self-evolution plugin entry.
 *
 * Mounts the `ctx.selfEvolution` service, attaches DSH event listeners for
 * metrics and health monitoring, and registers the model-facing evolution
 * tools. Uses @self-evolution/core as the platform-agnostic engine.
 */
import type { Context } from '@deepseek-ai/cordis'
import { EvolutionEngine } from '@self-evolution/core'
import type { SelfEvolutionService } from '@self-evolution/core'
import { Config, type Config as ConfigType } from './config.ts'
import { registerEvolutionTools } from './tools.ts'
import './context.ts'

export const name = 'self-evolution'
export const inject = ['tools', 'agents', 'sessions']

export { Config }

export function apply(ctx: Context, config: ConfigType) {
  if (!config.enabled) return

  const engine = new EvolutionEngine({
    pluginsRoot: config.pluginsRoot,
    sandboxRoot: config.sandboxRoot,
    backupRoot: `${config.sandboxRoot}/backup`,
    registryFile: config.registryFile,
    maxIterations: config.maxIterations,
    allowlist: config.allowlist,
    protectedPlugins: config.protected,
  })

  ctx.effect(() => {
    ctx.selfEvolution = engine
    return () => {
      delete (ctx as Partial<Context> & { selfEvolution?: SelfEvolutionService }).selfEvolution
    }
  })

  ctx.effect(() => attachDshEvents(ctx, engine))

  ctx.effect(() => registerEvolutionTools(ctx, engine))
}

/** Attach DSH event listeners for metrics and health monitoring. */
function attachDshEvents(ctx: Context, engine: EvolutionEngine): () => void {
  const disposers: (() => void)[] = []

  disposers.push(
    ctx.on('agent/error', (payload) => {
      const text = String(payload.error ?? '')
      engine.metrics.recordError('harness')
      void text
    }),
  )

  disposers.push(
    ctx.on('tools/result', (_exec, result) => {
      if (result.isError) engine.metrics.recordError('unknown')
    }),
  )

  disposers.push(
    ctx.on('session/event', (_session, event) => {
      if (event.type === 'turn/end') {
        const reason = (event.data as { reason?: unknown }).reason
        if (reason && typeof reason === 'object' && (reason as { kind?: string }).kind === 'aborted') {
          engine.metrics.recordAbortedTurn()
        }
      }
    }),
  )

  return () => {
    for (const dispose of disposers) dispose()
  }
}
