/**
 * DSH self-evolution plugin entry.
 *
 * Mounts the `ctx.selfEvolution` service, attaches DSH event listeners for
 * metrics and health monitoring, and registers the model-facing evolution
 * tools. Follows the DSH plugin conventions from
 * `docs/cookbook/adding-a-package.zh.md`: a `name`, `inject` declarations,
 * an `apply(ctx, config)` that registers only reversible side effects, and a
 * schemastery `Config`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, type Config as ConfigType } from './config.ts'
import { EvolutionEngine } from './engine.ts'
import { registerEvolutionTools } from './tools.ts'
import type { SelfEvolutionService } from './types.ts'
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

  // Publish the service. The assignment is undone on plugin reload.
  ctx.effect(() => {
    ctx.selfEvolution = engine
    return () => {
      delete (ctx as Partial<Context> & { selfEvolution?: SelfEvolutionService }).selfEvolution
    }
  })

  // Feed runtime events into metrics + health monitoring.
  ctx.effect(() => engine.attach(ctx))

  // Expose the loop to the harness's own agent.
  ctx.effect(() => registerEvolutionTools(ctx, engine))
}
