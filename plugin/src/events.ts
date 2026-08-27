/**
 * Typed events of the self-evolution plugin.
 */
import type { FixPlan, InspectorVerdict, TestReport, EvolveRecord, EvolutionMetrics } from '@self-evolution/core'
import type { Session, SessionEvent, Agent } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** Map of the self-evolution events. */
export interface SelfEvolutionEventMap {
  'evolution/plan-created'(plan: FixPlan): void
  'evolution/plan-approved'(plan: FixPlan, verdict: Extract<InspectorVerdict, { kind: 'approved' }>): void
  'evolution/plan-refused'(planId: string, verdict: Extract<InspectorVerdict, { kind: 'rejected' | 'amend' }>): void
  'evolution/metrics'(metrics: EvolutionMetrics): void
  'evolution/apply-started'(recordId: string, planId: string): void
  'evolution/apply-finished'(record: EvolveRecord): void
  'evolution/test-started'(runId: string, recordId: string): void
  'evolution/test-finished'(report: TestReport): void
  'evolution/deployed'(record: EvolveRecord): void
  'evolution/rolled-back'(record: EvolveRecord): void
}

declare module '@deepseek-ai/cordis' {
  interface Events extends SelfEvolutionEventMap {
    'session/event'(session: Session, event: SessionEvent): void
    'agent/error'(payload: { agent: Agent; turn: number; step: number; error: unknown }): void
    'tools/result'(this: unknown, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined
  }
}
