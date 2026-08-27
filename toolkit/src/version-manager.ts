/**
 * Plugin version manager + automatic rollback.
 *
 * Maintains immutable version snapshots of a plugin under a state directory
 * and can swap the *active* plugin tree at `activeDir/<pluginId>` back to any
 * recorded version. A health monitor observes runtime errors inside a window
 * and rolls the active plugin back to the previous version automatically when
 * the threshold is crossed.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import type { HealthPolicy, VersionEntry } from './types.ts'

const LEDGER_FILE = 'ledger.json'
/** Snapshot store: `<stateDir>/snapshots/<pluginId>/<version>`. */
const SNAPSHOTS_DIR = 'snapshots'

/** Immutable version snapshots + ledger. */
export class VersionStore {
  readonly stateDir: string
  readonly activeDir: string
  #ledger: VersionEntry[]

  constructor(stateDir: string, activeDir: string) {
    this.stateDir = stateDir
    this.activeDir = activeDir
    this.#ledger = this.#readLedger()
  }

  #readLedger(): VersionEntry[] {
    const file = join(this.stateDir, LEDGER_FILE)
    if (!existsSync(file)) return []
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as VersionEntry[]
    } catch {
      return []
    }
  }

  #writeLedger(): void {
    mkdirSync(this.stateDir, { recursive: true })
    const tmp = join(this.stateDir, `${LEDGER_FILE}.tmp`)
    writeFileSync(tmp, JSON.stringify(this.#ledger, null, 2), 'utf8')
    renameSync(tmp, join(this.stateDir, LEDGER_FILE))
  }

  /** Snapshot a source tree under `versions/<pluginId>/<version>`. */
  snapshot(pluginId: string, version: string, sourceDir: string, commitMessage?: string): VersionEntry {
    const target = join(this.stateDir, SNAPSHOTS_DIR, pluginId, version)
    rmSync(target, { recursive: true, force: true })
    mkdirSync(target, { recursive: true })
    cpSync(sourceDir, target, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes('node_modules') })
    const entry: VersionEntry = {
      pluginId,
      version,
      createdAt: Date.now(),
      sourceDir,
      commitMessage,
      healthStatus: 'unknown',
    }
    this.#ledger = this.#ledger.filter((e) => !(e.pluginId === pluginId && e.version === version))
    this.#ledger.push(entry)
    this.#writeLedger()
    return entry
  }

  /** List recorded versions of a plugin, newest first. */
  list(pluginId: string): VersionEntry[] {
    return this.#ledger
      .filter((e) => e.pluginId === pluginId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /** The most recently recorded version of a plugin. */
  latest(pluginId: string): VersionEntry | undefined {
    return this.list(pluginId)[0]
  }

  /** Versions available on disk (the ledger is authoritative but stale entries can miss files). */
  availableVersions(pluginId: string): string[] {
    const dir = join(this.stateDir, SNAPSHOTS_DIR, pluginId)
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter((v) => existsSync(join(dir, v, 'package.json')))
  }

  /**
   * Swap the active plugin tree to a recorded version. Returns the restored
   * version string, or `undefined` when the snapshot is missing.
   */
  rollback(pluginId: string, version: string): string | undefined {
    const snapshot = join(this.stateDir, SNAPSHOTS_DIR, pluginId, version)
    if (!existsSync(join(snapshot, 'package.json'))) return undefined
    const active = join(this.activeDir, pluginId)
    rmSync(active, { recursive: true, force: true })
    mkdirSync(active, { recursive: true })
    cpSync(snapshot, active, { recursive: true })
    this.markHealth(pluginId, version, 'unknown')
    return version
  }

  /** Restore the active tree to the *previous* recorded version (best-effort). */
  rollbackToPrevious(pluginId: string): string | undefined {
    const entries = this.list(pluginId)
    const activeVersion = entries[0]?.version
    const previous = entries.find((e) => e.version !== activeVersion)
    return previous ? this.rollback(pluginId, previous.version) : undefined
  }

  /** Record a health observation for the active version. */
  markHealth(pluginId: string, version: string, healthStatus: 'healthy' | 'unhealthy' | 'unknown'): void {
    const index = this.#ledger.findIndex((e) => e.pluginId === pluginId && e.version === version)
    if (index < 0) return
    this.#ledger[index] = { ...this.#ledger[index]!, healthStatus }
    this.#writeLedger()
  }
}

/** Sliding-window health monitor with automatic rollback. */
export class HealthMonitor {
  readonly store: VersionStore
  readonly policy: HealthPolicy
  #errors = new Map<string, number[]>()
  #rolledBack = new Set<string>()

  constructor(store: VersionStore, policy: HealthPolicy = { maxErrors: 5, windowMs: 10 * 60_000 }) {
    this.store = store
    this.policy = policy
  }

  /** Record one runtime error for a plugin. */
  observe(pluginId: string): void {
    const now = Date.now()
    const errors = (this.#errors.get(pluginId) ?? []).filter((t) => now - t <= this.policy.windowMs)
    errors.push(now)
    this.#errors.set(pluginId, errors)
    if (errors.length >= this.policy.maxErrors) {
      this.#triggerRollback(pluginId)
    }
  }

  #triggerRollback(pluginId: string): void {
    if (this.#rolledBack.has(pluginId)) return // only once per deployment
    const latest = this.store.latest(pluginId)
    const restored = this.store.rollbackToPrevious(pluginId)
    if (restored) {
      this.#rolledBack.add(pluginId)
      if (latest) {
        this.store.markHealth(pluginId, latest.version, 'unhealthy')
        this.store.markHealth(pluginId, restored, 'healthy')
      }
    }
  }

  /** Whether automatic rollback has already fired for a plugin. */
  didRollBack(pluginId: string): boolean {
    return this.#rolledBack.has(pluginId)
  }
}
