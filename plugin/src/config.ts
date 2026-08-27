/**
 * Plugin configuration. Follows the Cordis `Config` convention: a schemastery
 * schema exported as `Config`, validated when the plugin mounts
 * (docs/cookbook/adding-a-package.zh.md § src/index.ts).
 */
import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** Master switch; disabled plugins never analyze, evolve, or deploy. */
  enabled: boolean
  /** Plugins that may evolve. `['*']` allows every non-protected plugin. */
  allowlist: string[]
  /** Plugins that can never be modified by an evolution plan. */
  protected: string[]
  /** Directory holding the plugin source packages the harness runs. */
  pluginsRoot: string
  /** Directory used as the sandbox for applying and testing changes. */
  sandboxRoot: string
  /** Registry file (JSONL) persisting the evolution lineage. */
  registryFile: string
  /** How many analysis/apply/test iterations a cycle may run. */
  maxIterations: number
  /** Whether a human/approval gate must approve before deployment. */
  requireApproval: boolean
  /** Max total bytes a single plan may touch across all files. */
  maxPlanBytes: number
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  allowlist: Schema.array(Schema.string()).default(['*']),
  protected: Schema.array(Schema.string()).default([
    'core',
    'dsh-agent-loop',
    'dsh-session',
    'dsh-system-prompt',
    'dsh-tools',
  ]),
  pluginsRoot: Schema.string().default('./packages'),
  sandboxRoot: Schema.string().default('./.evolution-sandbox'),
  registryFile: Schema.string().default('./.evolution/registry.jsonl'),
  maxIterations: Schema.number().min(1).max(10).default(3),
  requireApproval: Schema.boolean().default(false),
  maxPlanBytes: Schema.number().min(1024).default(256 * 1024),
})
