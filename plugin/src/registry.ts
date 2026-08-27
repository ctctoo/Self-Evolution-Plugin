/**
 * Evolution lineage registry.
 *
 * Persists `EvolveRecord`s as a JSONL file and owns the versioning rules of
 * the lineage tree: every record names a parent version and produces a child
 * version, so a record set is always traceable and rollback-safe.
 */
import { appendFileSync, mkdirSync, readFileSync, existsSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { EvolveRecord } from './types.ts'

/** Compute the next child version for a plugin given its lineage tail. */
export function nextVersion(parentVersion: string): string {
  const match = /^v(\d+)$/.exec(parentVersion)
  if (match?.[1]) {
    return `v${Number(match[1]) + 1}`
  }
  // Non-semantic parents (e.g. "1.2.3") step the patch digit.
  const semver = /^(\d+)\.(\d+)\.(\d+)$/.exec(parentVersion)
  if (semver) {
    return `${semver[1]}.${semver[2]}.${Number(semver[3]) + 1}`
  }
  return `${parentVersion}-evolved-${Date.now()}`
}

/** JSONL-backed evolution registry. */
export class EvolutionRegistry {
  #file: string
  #records: EvolveRecord[] = []

  constructor(file: string) {
    this.#file = file
    this.#load()
  }

  #load(): void {
    if (!existsSync(this.#file)) return
    const text = readFileSync(this.#file, 'utf8')
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue
      try {
        this.#records.push(JSON.parse(line) as EvolveRecord)
      } catch {
        // A torn tail line is invalid lineage evidence; ignore it. The JSONL
        // append discipline makes corruption possible only at the physical tail.
      }
    }
  }

  /** Persist one record (appends; never rewrites history). */
  append(record: EvolveRecord): void {
    this.#records.push(record)
    mkdirSync(dirname(this.#file), { recursive: true })
    appendFileSync(this.#file, `${JSON.stringify(record)}\n`, 'utf8')
  }

  /** Update a record's status in place and rewrite the file atomically. */
  update(recordId: string, patch: Partial<Omit<EvolveRecord, 'recordId'>>): EvolveRecord | undefined {
    const index = this.#records.findIndex((r) => r.recordId === recordId)
    if (index < 0) return undefined
    const next: EvolveRecord = { ...this.#records[index]!, ...patch, recordId }
    this.#records[index] = next
    this.#rewrite()
    return next
  }

  #rewrite(): void {
    mkdirSync(dirname(this.#file), { recursive: true })
    const tmp = `${this.#file}.tmp`
    writeFileSync(tmp, this.#records.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
    renameSync(tmp, this.#file)
  }

  get(recordId: string): EvolveRecord | undefined {
    return this.#records.find((r) => r.recordId === recordId)
  }

  /** Newest first. */
  history(): EvolveRecord[] {
    return [...this.#records].reverse()
  }

  /** The most recent settled record of a plugin, if any. */
  latestSettled(pluginId: string): EvolveRecord | undefined {
    return this.#records
      .filter((r) => r.pluginId === pluginId)
      .reverse()
      .find((r) => r.status === 'deployed' || r.status === 'rolled-back' || r.status === 'passed')
  }

  /** The last version string recorded for a plugin, or the default. */
  currentVersion(pluginId: string, fallback = 'v1'): string {
    return this.latestSettled(pluginId)?.childVersion ?? fallback
  }

  /** Active (not yet settled) records. */
  active(): EvolveRecord[] {
    return this.#records.filter((r) => r.status === 'running' || r.status === 'test-failed' || r.status === 'passed')
  }

  /** Number of persisted records. */
  get size(): number {
    return this.#records.length
  }
}
