/**
 * Typed events of the self-evolution plugin, following the DSH
 * `…Map → derived-union` pattern (docs/subsystems/core.zh.md § the pattern).
 * Consumers augment Cordis `Events` via declaration merging, exactly like
 * first-party dsh packages do.
 */
import type { FixPlan, InspectorVerdict, TestReport, EvolveRecord, EvolutionMetrics } from './types.ts'
import type { Session, SessionEvent, Agent } from '@deepseek-ai/dsh-session'
import type { ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** Map of the self-evolution events. */
export interface SelfEvolutionEventMap {
  /** A plan was produced by the Analyzer. */
  'evolution/plan-created'(plan: FixPlan): void
  /** A plan passed inspection. */
  'evolution/plan-approved'(plan: FixPlan, verdict: Extract<InspectorVerdict, { kind: 'approved' }>): void
  /** A plan was rejected or sent back for amendment. */
  'evolution/plan-refused'(planId: string, verdict: Extract<InspectorVerdict, { kind: 'rejected' | 'amend' }>): void
  /** Runtime metrics were recomputed after a new batch of events. */
  'evolution/metrics'(metrics: EvolutionMetrics): void
  /** An evolution record entered the sandbox apply phase. */
  'evolution/apply-started'(recordId: string, planId: string): void
  /** Sandbox apply finished. */
  'evolution/apply-finished'(record: EvolveRecord): void
  /** A test run started. */
  'evolution/test-started'(runId: string, recordId: string): void
  /** A test run settled. */
  'evolution/test-finished'(report: TestReport): void
  /** A verified plugin was deployed outside the sandbox. */
  'evolution/deployed'(record: EvolveRecord): void
  /** A deployed plugin was rolled back. */
  'evolution/rolled-back'(record: EvolveRecord): void
}

declare module '@deepseek-ai/cordis' {
  interface Events extends SelfEvolutionEventMap {
    /** Broadcast of every durable session event (docs/architecture.zh.md § events). */
    'session/event'(session: Session, event: SessionEvent): void
    /** A step or turn errored (docs/subsystems/core.zh.md § agent/error). */
    'agent/error'(payload: { agent: Agent; turn: number; step: number; error: unknown }): void
    /** Frozen final tool outcome (docs/subsystems/tools.zh.md § tools/result). */
    'tools/result'(this: unknown, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined
  }
}
