/**
 * Actuator.
 *
 * Applies an approved `FixPlan` inside a sandbox directory (Readme:
 * "Actuator 在沙箱内对源码进行修改"). It NEVER touches production: every
 * write stays under `sandboxRoot`, the source is first copied into a fresh
 * sandbox workspace, and each planned change is validated against the copy.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { ApplyResult, FixPlan, PlannedChange } from './types.ts'
import { EvolutionRegistry, nextVersion } from './registry.ts'
import { resolvePluginRoot } from './analyzer.ts'

/** Normalize a plan-relative file path and reject path traversal. */
function safePath(root: string, file: string): string | undefined {
  if (file.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(file)) return undefined
  const parts = file.split(/[\\/]/)
  if (parts.some((p) => p === '..' || p === '')) return undefined
  return resolve(root, ...parts)
}

/** Apply one change to a sandboxed copy. Returns ok or a detail message. */
function applyChange(root: string, change: PlannedChange): { ok: boolean; detail?: string } {
  const target = safePath(root, change.file)
  if (!target) return { ok: false, detail: 'path escapes the sandbox' }

  switch (change.kind) {
    case 'create': {
      if (existsSync(target)) return { ok: false, detail: 'target already exists' }
      if (change.newText == null) return { ok: false, detail: 'create requires newText' }
      mkdirSync(resolve(target, '..'), { recursive: true })
      writeFileSync(target, change.newText, 'utf8')
      return { ok: true }
    }
    case 'delete': {
      if (!existsSync(target)) return { ok: false, detail: 'target does not exist' }
      rmSync(target, { force: true })
      return { ok: true }
    }
    case 'edit': {
      if (!existsSync(target)) return { ok: false, detail: 'target does not exist' }
      if (!change.oldText || change.newText == null) return { ok: false, detail: 'edit requires oldText and newText' }
      const content = readFileSync(target, 'utf8')
      if (!content.includes(change.oldText)) return { ok: false, detail: 'oldText not found in current source' }
      const next = content.replace(change.oldText, change.newText)
      if (next === content) return { ok: false, detail: 'no textual change produced' }
      writeFileSync(target, next, 'utf8')
      return { ok: true }
    }
  }
}

/** The Actuator service: plans in, sandboxed results out. */
export class Actuator {
  #sandboxRoot: string
  #pluginsRoot: string
  #registry: EvolutionRegistry

  constructor(sandboxRoot: string, pluginsRoot: string, registry: EvolutionRegistry) {
    this.#sandboxRoot = sandboxRoot
    this.#pluginsRoot = pluginsRoot
    this.#registry = registry
  }

  /**
   * Apply a plan inside a fresh sandbox workspace. Returns the applied copy
   * path and per-change outcomes; no production file is touched.
   */
  apply(plan: FixPlan): ApplyResult {
    const sourceRoot = resolvePluginRoot(this.#pluginsRoot, plan.targetPlugin)
    if (!sourceRoot) {
      throw new Error(`cannot apply plan: plugin ${plan.targetPlugin} is not found under ${this.#pluginsRoot}`)
    }

    const parentVersion = plan.targetVersion
    const childVersion = nextVersion(parentVersion)
    const recordId = `rec_${plan.planId}`
    const appliedDir = join(this.#sandboxRoot, `${plan.targetPlugin}@${childVersion}`)

    // Fresh sandbox workspace: copy the plugin, then apply each change.
    rmSync(appliedDir, { recursive: true, force: true })
    mkdirSync(appliedDir, { recursive: true })
    cpSync(sourceRoot, appliedDir, { recursive: true })

    const applied: { file: string; ok: boolean; detail?: string }[] = []
    for (const change of plan.changes) {
      const outcome = applyChange(appliedDir, change)
      applied.push({ file: change.file, ...outcome })
    }
    const allOk = applied.every((a) => a.ok)
    const filesChanged = applied.filter((a) => a.ok).map((a) => a.file)

    const record = {
      recordId,
      planId: plan.planId,
      pluginId: plan.targetPlugin,
      parentVersion,
      childVersion,
      status: allOk ? ('running' as const) : ('aborted' as const),
      filesChanged,
      verdict: { kind: 'approved' as const, planId: plan.planId, reviewer: 'inspector', notes: [] },
    }
    this.#registry.append(record)
    return { record, appliedDir, applied }
  }
}
