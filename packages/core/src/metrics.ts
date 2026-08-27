/**
 * Runtime metrics collector.
 *
 * Consumes runtime events (tool latency, errors, aborted turns) and folds
 * them into `EvolutionMetrics` consumed by the Analyzer. Platform-agnostic:
 * adapters feed events from their host's event system.
 */
import type { EvolutionMetrics, EvolveSignal } from './types.ts'

interface LatencyBucket {
  count: number
  totalMs: number
}

/** In-memory metrics collector fed by event listeners. */
export class MetricsCollector {
  #errorsByPlugin = new Map<string, number>()
  #latencyByTool = new Map<string, LatencyBucket>()
  #toolFailures = new Map<string, number>()
  #abortedTurns = 0

  /** Record one tool dispatch latency sample. */
  recordLatency(tool: string, durationMs: number, failed: boolean): void {
    const bucket = this.#latencyByTool.get(tool) ?? { count: 0, totalMs: 0 }
    bucket.count += 1
    bucket.totalMs += durationMs
    this.#latencyByTool.set(tool, bucket)
    if (failed) {
      this.#toolFailures.set(tool, (this.#toolFailures.get(tool) ?? 0) + 1)
    }
  }

  /** Record an error attributed to a plugin (or the harness when unknown). */
  recordError(plugin: string, count = 1): void {
    this.#errorsByPlugin.set(plugin, (this.#errorsByPlugin.get(plugin) ?? 0) + count)
  }

  /** Record an aborted turn. */
  recordAbortedTurn(): void {
    this.#abortedTurns += 1
  }

  /** Snapshot of the aggregated metrics. */
  snapshot(): EvolutionMetrics {
    return {
      errorsByPlugin: new Map(this.#errorsByPlugin),
      latencyByTool: new Map(this.#latencyByTool),
      toolFailures: new Map(this.#toolFailures),
      abortedTurns: this.#abortedTurns,
    }
  }

  /** Derive problem signals from the metrics snapshot. */
  signals(): EvolveSignal[] {
    const out: EvolveSignal[] = []
    const now = Date.now()
    for (const [plugin, count] of this.#errorsByPlugin) {
      if (count >= 3) {
        out.push({
          kind: 'error',
          plugin,
          ref: `metrics:errors:${plugin}`,
          summary: `${plugin} accumulated ${count} runtime errors`,
          occurrences: count,
          firstSeen: now,
          lastSeen: now,
        })
      }
    }
    for (const [tool, bucket] of this.#latencyByTool) {
      const avg = bucket.totalMs / Math.max(1, bucket.count)
      if (bucket.count >= 5 && avg > 30_000) {
        out.push({
          kind: 'slow',
          plugin: 'unknown',
          ref: `metrics:latency:${tool}`,
          summary: `${tool} average latency ${Math.round(avg)}ms over ${bucket.count} calls`,
          occurrences: bucket.count,
          firstSeen: now,
          lastSeen: now,
        })
      }
    }
    for (const [tool, count] of this.#toolFailures) {
      if (count >= 3) {
        out.push({
          kind: 'error',
          plugin: 'unknown',
          ref: `metrics:failures:${tool}`,
          summary: `${tool} failed ${count} times`,
          occurrences: count,
          firstSeen: now,
          lastSeen: now,
        })
      }
    }
    return out
  }
}
