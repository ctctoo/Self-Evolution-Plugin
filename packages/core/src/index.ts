/**
 * @self-evolution/core — Platform-agnostic self-evolution engine.
 *
 * Zero external dependencies. Adapters for DSH, MCP, LangChain, etc.
 * import this package and feed host-specific events into the engine.
 */

export type {
  EvidenceRef,
  PlannedChange,
  FixPlan,
  InspectorFinding,
  InspectorVerdict,
  InspectorRule,
  InspectionContext,
  TestCaseResult,
  TestReport,
  EvolveRecordStatus,
  EvolveRecord,
  EvolveSignal,
  EvolutionMetrics,
  SelfEvolutionService,
  ApplyResult,
  EvolutionCycleResult,
  EvolutionStatus,
} from './types.ts'

export { MetricsCollector } from './metrics.ts'
export { EvolutionRegistry, nextVersion } from './registry.ts'
export { Analyzer, resolvePluginRoot, defaultPlanGenerator } from './analyzer.ts'
export type { PlanGenerator } from './analyzer.ts'
export { Inspector, INSPECTOR_RULES } from './inspector.ts'
export { Actuator } from './actuator.ts'
export { Tester, StaticSmokeRunner } from './tester.ts'
export type { RunnerCase, TestRunner } from './tester.ts'
export { Cover } from './cover.ts'
export type { HealthWindow } from './cover.ts'
export { EvolutionEngine } from './engine.ts'
export type { EngineOptions } from './engine.ts'
