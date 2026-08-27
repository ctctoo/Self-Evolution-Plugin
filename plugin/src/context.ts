/**
 * Context service declarations.
 *
 * Augments the Cordis `Context` interface with the harness services this
 * plugin consumes (`tools`, `agents`, `sessions`, `settings`, `llm`) plus the
 * `selfEvolution` service it contributes.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SelfEvolutionService } from '@self-evolution/core'
import type { ToolRuntime } from '@deepseek-ai/dsh-tools'
import type { AgentRegistry, SessionStore, SettingsProvider } from '@deepseek-ai/dsh-session'
import type { LlmService } from '@deepseek-ai/dsh-llm'

declare module '@deepseek-ai/cordis' {
  interface Context {
    selfEvolution: SelfEvolutionService
    tools: ToolRuntime
    agents: AgentRegistry
    sessions: SessionStore
    settings: SettingsProvider
    llm: LlmService
  }
}

export type { Context }
