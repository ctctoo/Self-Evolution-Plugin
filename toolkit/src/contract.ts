/**
 * Interface-contract checker.
 *
 * Validates a DSH plugin package against the enforced invariants from
 * `docs/adding-a-package.zh.md`: manifest shape (`private`, `type: module`,
 * `main`/`types`/`exports` pointing at existing files, `files` covering the
 * published artifacts, build scripts), source layout (`src/index.ts`), and
 * the dual-face rule (a package declaring `dsh.client` MUST also provide
 * `exports["./client"]`). Errors block promotion of an evolved plugin.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ContractFinding, ContractReport, PluginManifest } from './types.ts'

/** A single, pure contract rule. */
export interface ContractRule {
  readonly id: string
  readonly severity: 'error' | 'warning'
  readonly check: (dir: string, manifest: PluginManifest) => readonly ContractFinding[]
}

function finding(rule: string, severity: 'error' | 'warning', file: string, message: string): ContractFinding {
  return { rule, severity, file, message }
}

function resolveExportsFile(dir: string, spec: unknown): string | undefined {
  if (typeof spec === 'string') return spec
  if (spec && typeof spec === 'object') {
    const types = (spec as Record<string, unknown>)['types']
    if (typeof types === 'string') return types
    const def = (spec as Record<string, unknown>)['default']
    if (typeof def === 'string') return def
  }
  return undefined
}

export const CONTRACT_RULES: readonly ContractRule[] = [
  {
    id: 'manifest/parses',
    severity: 'error',
    check(dir, manifest) {
      return manifest.name ? [] : [finding('manifest/parses', 'error', 'package.json', 'missing or invalid name')]
    },
  },
  {
    id: 'manifest/scoped-name',
    severity: 'warning',
    check(_dir, manifest) {
      return /^@[a-z0-9-]+\/[a-z0-9-]+$/.test(manifest.name)
        ? []
        : [finding('manifest/scoped-name', 'warning', 'package.json', `name "${manifest.name}" is not scoped (@group/name) and may not be publishable`)]
    },
  },
  {
    id: 'manifest/version',
    severity: 'error',
    check(_dir, manifest) {
      return manifest.version && /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.version)
        ? []
        : [finding('manifest/version', 'error', 'package.json', `invalid version: "${manifest.version}"`)]
    },
  },
  {
    id: 'manifest/type-module',
    severity: 'error',
    check(_dir, manifest) {
      return manifest.type === 'module'
        ? []
        : [finding('manifest/type-module', 'error', 'package.json', 'type must be "module"')]
    },
  },
  {
    id: 'manifest/main-types',
    severity: 'error',
    check(dir, manifest) {
      const out: ContractFinding[] = []
      if (manifest.main !== 'lib/index.js') {
        out.push(finding('manifest/main-types', 'error', 'package.json', `main must be "lib/index.js", got "${manifest.main}"`))
      } else if (!existsSync(join(dir, 'lib/index.js'))) {
        out.push(finding('manifest/main-types', 'error', 'lib/index.js', 'build output missing; run pnpm build first'))
      }
      if (manifest.types !== 'lib/types/index.d.ts') {
        out.push(finding('manifest/main-types', 'error', 'package.json', `types must be "lib/types/index.d.ts", got "${manifest.types}"`))
      } else if (!existsSync(join(dir, 'lib/types/index.d.ts'))) {
        out.push(finding('manifest/main-types', 'error', 'lib/types/index.d.ts', 'type declaration missing'))
      }
      return out
    },
  },
  {
    id: 'manifest/exports',
    severity: 'error',
    check(dir, manifest) {
      const out: ContractFinding[] = []
      const exportsField = manifest.exports
      if (!exportsField || typeof exportsField !== 'object') {
        return [finding('manifest/exports', 'error', 'package.json', 'exports map is required')]
      }
      const root = (exportsField as Record<string, unknown>)['.']
      const target = resolveExportsFile(dir, root)
      if (!target || !existsSync(join(dir, ...target.split('/')))) {
        out.push(finding('manifest/exports', 'error', 'package.json', 'exports["."] must point at an existing build artifact'))
      }
      // Dual-face rule: dsh.client declared ⇒ exports["./client"] MUST exist.
      const hasClient = Boolean(manifest.dsh?.client)
      const clientSpec = (exportsField as Record<string, unknown>)['./client']
      if (hasClient && !clientSpec) {
        out.push(finding('manifest/exports', 'error', 'package.json', 'package declares dsh.client but exports["./client"] is missing'))
      }
      if (!hasClient && clientSpec) {
        out.push(finding('manifest/exports', 'warning', 'package.json', 'exports["./client"] present without a dsh.client declaration'))
      }
      return out
    },
  },
  {
    id: 'manifest/files',
    severity: 'error',
    check(_dir, manifest) {
      const files = manifest.files ?? []
      const missing = ['lib'].filter((f) => !files.includes(f))
      return missing.length
        ? missing.map((f) => finding('manifest/files', 'error', 'package.json', `files array must include "${f}"`))
        : []
    },
  },
  {
    id: 'manifest/scripts',
    severity: 'warning',
    check(_dir, manifest) {
      const scripts = manifest.scripts ?? {}
      const missing = ['build', 'typecheck'].filter((s) => !scripts[s])
      return missing.length
        ? missing.map((s) => finding('manifest/scripts', 'warning', 'package.json', `scripts.${s} is recommended (continuous delivery + CI)`))
        : []
    },
  },
  {
    id: 'source/index-present',
    severity: 'error',
    check(dir, _manifest) {
      return existsSync(join(dir, 'src/index.ts'))
        ? []
        : [finding('source/index-present', 'error', 'src/index.ts', 'plugin entry point is required')]
    },
  },
  {
    id: 'source/no-node-modules',
    severity: 'error',
    check(dir, _manifest) {
      if (!existsSync(join(dir, 'node_modules'))) return []
      const entries = readdirSync(join(dir, 'node_modules'))
      // Workspace symlinks are fine; vendored node_modules are not.
      return entries.length > 0
        ? [finding('source/no-node-modules', 'error', 'node_modules', 'vendored node_modules must not be part of the package')]
        : []
    },
  },
]

/** Check a plugin directory against the full rule set. */
export function checkContract(dir: string): ContractReport {
  const manifestPath = join(dir, 'package.json')
  let manifest: PluginManifest
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginManifest
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      plugin: '<unparseable>',
      dir,
      ok: false,
      findings: [{ rule: 'manifest/parses', severity: 'error', file: 'package.json', message: `cannot parse manifest: ${detail}` }],
    }
  }

  const findings: ContractFinding[] = []
  for (const rule of CONTRACT_RULES) {
    findings.push(...rule.check(dir, manifest))
  }
  const errors = findings.filter((f) => f.severity === 'error')
  return {
    plugin: manifest.name,
    dir: resolve(dir),
    ok: errors.length === 0,
    findings,
  }
}
