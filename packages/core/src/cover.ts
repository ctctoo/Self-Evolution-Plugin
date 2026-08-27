/**
 * Cover.
 *
 * Deploys a fully tested evolution outside the sandbox and owns rollback.
 * Deployment is a controlled copy-replace: the previous plugin source is
 * snapshotted into a backup store first, so any later regression can restore
 * the exact parent version. The health window lets the host observe the
 * deployed plugin and roll back automatically when error signals cross a
 * threshold.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { EvolveRecord, FixPlan } from './types.ts'
import { EvolutionRegistry } from './registry.ts'

/** Health observation window for automatic rollback. */
export interface HealthWindow {
  /** Error occurrences tolerated before automatic rollback. */
  readonly maxErrors: number
  /** Window length in ms. */
  readonly durationMs: number
}

/** The Cover service: sandboxed evolutions in, deployed plugins out. */
export class Cover {
  #pluginsRoot: string
  #backupRoot: string
  #registry: EvolutionRegistry
  #healthWindow: HealthWindow
  #deployedAt = new Map<string, number>()
  #errorCounts = new Map<string, number>()

  constructor(
    pluginsRoot: string,
    backupRoot: string,
    registry: EvolutionRegistry,
    healthWindow: HealthWindow = { maxErrors: 5, durationMs: 10 * 60_000 },
  ) {
    this.#pluginsRoot = pluginsRoot
    this.#backupRoot = backupRoot
    this.#registry = registry
    this.#healthWindow = healthWindow
  }

  /** Resolve the production root of a plugin package by id. */
  #productionRoot(pluginId: string): string {
    return join(this.#pluginsRoot, pluginId)
  }

  /** Snapshot the current production source into the backup store. */
  #snapshot(pluginId: string, version: string, appliedDir: string): void {
    const prod = this.#productionRoot(pluginId)
    if (!existsSync(prod)) return
    const target = join(this.#backupRoot, `${pluginId}@${version}`)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    cpSync(prod, target, { recursive: true })
    const deployedSnapshot = join(this.#backupRoot, `${pluginId}@${version}.deployed`)
    rmSync(deployedSnapshot, { recursive: true, force: true })
    mkdirSync(deployedSnapshot, { recursive: true })
    cpSync(appliedDir, deployedSnapshot, { recursive: true })
  }

  /**
   * Deploy a passed evolution: snapshot the current plugin, replace it with
   * the sandboxed copy, and record the deployment in the lineage.
   */
  deploy(record: EvolveRecord, appliedDir: string): EvolveRecord {
    const prod = this.#productionRoot(record.pluginId)
    if (!existsSync(prod)) {
      throw new Error(`cannot deploy ${record.pluginId}: production package not found`)
    }
    this.#snapshot(record.pluginId, record.parentVersion, appliedDir)

    rmSync(prod, { recursive: true, force: true })
    mkdirSync(prod, { recursive: true })
    cpSync(appliedDir, prod, { recursive: true })

    const deployed = this.#registry.update(record.recordId, {
      status: 'deployed',
      deployedAt: Date.now(),
    })!
    this.#deployedAt.set(record.pluginId, Date.now())
    return deployed
  }

  /**
   * Roll a plugin back to its last stable deployed version. Returns the
   * rolled-back record, or undefined when there is nothing to restore.
   */
  rollback(pluginId: string, reason = 'health threshold exceeded'): EvolveRecord | undefined {
    const latest = this.#registry.latestSettled(pluginId)
    if (!latest) return undefined
    const deployedSnapshot = join(this.#backupRoot, `${pluginId}@${latest.childVersion}.deployed`)
    const parentSnapshot = join(this.#backupRoot, `${pluginId}@${latest.parentVersion}`)

    const restoreFrom = existsSync(deployedSnapshot) ? deployedSnapshot : existsSync(parentSnapshot) ? parentSnapshot : undefined
    if (!restoreFrom) return undefined

    const prod = this.#productionRoot(pluginId)
    rmSync(prod, { recursive: true, force: true })
    mkdirSync(prod, { recursive: true })
    cpSync(restoreFrom, prod, { recursive: true })

    this.#errorCounts.delete(pluginId)
    this.#deployedAt.delete(pluginId)

    return this.#registry.update(latest.recordId, {
      status: 'rolled-back',
      rollbackAt: Date.now(),
      rollbackReason: reason,
    })
  }

  /** Plugin ids currently deployed and still inside their health window. */
  deployedPlugins(): string[] {
    const now = Date.now()
    const out: string[] = []
    for (const [pluginId, deployedAt] of this.#deployedAt) {
      if (now - deployedAt <= this.#healthWindow.durationMs) out.push(pluginId)
    }
    return out
  }

  /** Feed one runtime error observation into the health window. */
  observeError(pluginId: string): void {
    const deployedAt = this.#deployedAt.get(pluginId)
    if (deployedAt === undefined) return
    if (Date.now() - deployedAt > this.#healthWindow.durationMs) {
      this.#deployedAt.delete(pluginId)
      return
    }
    const count = (this.#errorCounts.get(pluginId) ?? 0) + 1
    this.#errorCounts.set(pluginId, count)
    if (count >= this.#healthWindow.maxErrors) {
      this.rollback(pluginId, `automatic rollback: ${count} errors within health window`)
    }
  }
}
