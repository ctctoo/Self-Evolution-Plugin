/**
 * Inspector.
 *
 * Reviews `FixPlan`s against a hard-coded, immutable rule set before any
 * change is applied. Rules are pure: they take a plan and a read-only
 * inspection context and return findings. `error` findings block approval;
 * `warning` findings are advisory.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, isAbsolute, resolve, sep } from 'node:path'
import type { FixPlan, InspectorFinding, InspectorRule, InspectorVerdict, InspectionContext } from './types.ts'

/** Literal high-risk code markers. */
const HIGH_RISK_MARKERS: readonly string[] = [
  'process.exit(',
  'eval(',
  'new Function(',
  'node:child_process',
  'node:net',
  'child_process.spawn',
  'child_process.exec',
]

/** Whether the target plugin is on the global allowlist. */
function isAllowed(plan: FixPlan, context: InspectionContext): boolean {
  if (context.evolutionAllowlist.includes('*')) return true
  return context.evolutionAllowlist.includes(plan.targetPlugin)
}

/** Normalize a relative path and reject any escaping the package root. */
function normalizeInPackage(file: string): string | undefined {
  if (isAbsolute(file)) return undefined
  const parts = file.split(/[\\/]/)
  if (parts.some((p) => p === '..' || p === '')) return undefined
  return parts.join(sep)
}

/** The immutable Inspector rule set. */
export const INSPECTOR_RULES: readonly InspectorRule[] = [
  {
    id: 'scope/allowlist',
    severity: 'error',
    check(plan, context) {
      if (isAllowed(plan, context)) return []
      return [{ ruleId: 'scope/allowlist', severity: 'error', message: `plugin ${plan.targetPlugin} is not on the evolution allowlist` }]
    },
  },
  {
    id: 'scope/protected',
    severity: 'error',
    check(plan, context) {
      if (!context.protectedPlugins.includes(plan.targetPlugin)) return []
      return [{ ruleId: 'scope/protected', severity: 'error', message: `plugin ${plan.targetPlugin} is protected and may never be evolved` }]
    },
  },
  {
    id: 'scope/single-plugin',
    severity: 'error',
    check(plan) {
      const fileOwners = new Set(plan.changes.map(() => plan.targetPlugin))
      if (fileOwners.size === 1) return []
      return [{ ruleId: 'scope/single-plugin', severity: 'error', message: 'one plan must target exactly one plugin' }]
    },
  },
  {
    id: 'scope/file-scope',
    severity: 'error',
    check(plan) {
      const findings: InspectorFinding[] = []
      for (const change of plan.changes) {
        if (!normalizeInPackage(change.file)) {
          findings.push({ ruleId: 'scope/file-scope', severity: 'error', message: `change escapes the plugin package: ${change.file}` })
        }
      }
      return findings
    },
  },
  {
    id: 'contract/manifest-stable',
    severity: 'error',
    check(plan) {
      const findings: InspectorFinding[] = []
      for (const change of plan.changes) {
        if (change.file !== 'package.json') continue
        if (change.kind === 'delete') {
          findings.push({ ruleId: 'contract/manifest-stable', severity: 'error', message: 'deleting package.json is never allowed' })
          continue
        }
        const text = (change.newText ?? change.oldText) ?? ''
        for (const key of ['"main"', '"types"', '"exports"']) {
          if (!text.includes(key)) {
            findings.push({ ruleId: 'contract/manifest-stable', severity: 'error', message: `package.json change drops required field ${key}` })
          }
        }
      }
      return findings
    },
  },
  {
    id: 'safety/high-risk-pattern',
    severity: 'error',
    check(plan) {
      const findings: InspectorFinding[] = []
      for (const change of plan.changes) {
        const text = change.newText ?? ''
        for (const marker of HIGH_RISK_MARKERS) {
          if (text.includes(marker)) {
            findings.push({ ruleId: 'safety/high-risk-pattern', severity: 'error', message: `change to ${change.file} contains high-risk pattern: ${marker}` })
          }
        }
      }
      return findings
    },
  },
  {
    id: 'integrity/edit-anchors',
    severity: 'error',
    check(plan, context) {
      if (!context.targetRoot) return []
      const findings: InspectorFinding[] = []
      for (const change of plan.changes) {
        if (change.kind !== 'edit') continue
        if (!change.oldText) {
          findings.push({ ruleId: 'integrity/edit-anchors', severity: 'error', message: `edit to ${change.file} must provide oldText` })
          continue
        }
        const filePath = resolve(context.targetRoot, ...change.file.split(/[\\/]/))
        if (!existsSync(filePath)) {
          findings.push({ ruleId: 'integrity/edit-anchors', severity: 'error', message: `edit target does not exist: ${change.file}` })
          continue
        }
        const content = readFileSync(filePath, 'utf8')
        if (!content.includes(change.oldText)) {
          findings.push({ ruleId: 'integrity/edit-anchors', severity: 'error', message: `oldText of ${change.file} does not match the current source` })
        }
      }
      return findings
    },
  },
  {
    id: 'quality/plan-completeness',
    severity: 'warning',
    check(plan) {
      const findings: InspectorFinding[] = []
      if (!plan.problem.trim()) findings.push({ ruleId: 'quality/plan-completeness', severity: 'warning', message: 'problem is empty' })
      if (!plan.expectedImpact.trim()) findings.push({ ruleId: 'quality/plan-completeness', severity: 'warning', message: 'expectedImpact is empty' })
      if (plan.evidence.length === 0) findings.push({ ruleId: 'quality/plan-completeness', severity: 'warning', message: 'plan carries no evidence' })
      for (const change of plan.changes) {
        if (!change.reason.trim()) findings.push({ ruleId: 'quality/plan-completeness', severity: 'warning', message: `change to ${change.file} has no reason` })
      }
      return findings
    },
  },
  {
    id: 'scope/size-budget',
    severity: 'warning',
    check(plan, context) {
      if (!context.targetRoot) return []
      const total = plan.changes.reduce((acc, c) => acc + Buffer.byteLength(c.newText ?? c.oldText ?? ''), 0)
      if (total > 128 * 1024) {
        return [{ ruleId: 'scope/size-budget', severity: 'warning', message: `plan touches ${total} bytes; prefer smaller, focused changes` }]
      }
      return []
    },
  },
]

/** The Inspector service: plans in, verdicts out. */
export class Inspector {
  #rules: readonly InspectorRule[]
  #reviewerName: string

  constructor(rules: readonly InspectorRule[] = INSPECTOR_RULES, reviewerName = 'inspector') {
    this.#rules = rules
    this.#reviewerName = reviewerName
  }

  /** Review a plan; returns an `approved`, `rejected`, or `amend` verdict. */
  review(plan: FixPlan, context: InspectionContext): InspectorVerdict {
    const errors: InspectorFinding[] = []
    const warnings: InspectorFinding[] = []
    for (const rule of this.#rules) {
      const findings = rule.check(plan, context)
      for (const finding of findings) {
        ;(finding.severity === 'error' ? errors : warnings).push(finding)
      }
    }
    if (errors.length > 0) {
      return {
        kind: 'rejected',
        planId: plan.planId,
        reviewer: this.#reviewerName,
        reasons: errors.map((e) => `[${e.ruleId}] ${e.message}`),
      }
    }
    if (warnings.length > 0) {
      return {
        kind: 'approved',
        planId: plan.planId,
        reviewer: this.#reviewerName,
        notes: warnings.map((w) => `[${w.ruleId}] ${w.message}`),
      }
    }
    return { kind: 'approved', planId: plan.planId, reviewer: this.#reviewerName, notes: [] }
  }
}
