/**
 * Tester.
 *
 * Validates an evolved plugin inside the sandbox before deployment (Readme:
 * "Actuator 在沙箱内对源码进行修改，修改完成后通过 Tester 进行多轮测试，
 * 如果未通过返回给 Analyzer 并携带错误报告，再次进行循环，通过后交给
 * 沙箱外的 Cover").
 *
 * The runner is injectable. The built-in static smoke runner is deterministic
 * and dependency-free; a runner backed by `ctx.subprocess` (or the sandbox
 * runner tool) can be attached by the host to execute real unit tests and
 * benchmark tasks inside the sandbox.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { FixPlan, TestReport, TestCaseResult } from './types.ts'

/** One executed test case produced by a runner. */
export interface RunnerCase {
  readonly caseId: string
  readonly name: string
  readonly passed: boolean
  readonly durationMs: number
  readonly detail?: string
}

/** Injectable test runner contract. */
export interface TestRunner {
  /** Run the validation suite for an applied sandbox copy. */
  run(request: { plan: FixPlan; appliedDir: string; recordId: string; runId: string }): Promise<readonly RunnerCase[]>
}

function collectTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'lib' || entry === '.git') continue
      collectTsFiles(full, out)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/** Minimal brace/bracket balance check to catch obvious syntax corruption. */
function balanced(code: string): boolean {
  const stack: string[] = []
  for (const ch of code) {
    if (ch === '{' || ch === '[' || ch === '(') stack.push(ch)
    else if (ch === '}' || ch === ']' || ch === ')') {
      const open = stack.pop()
      const expect = ch === '}' ? '{' : ch === ']' ? '[' : '('
      if (open !== expect) return false
    }
  }
  return stack.length === 0
}

/** Deterministic, dependency-free smoke runner (default). */
export class StaticSmokeRunner implements TestRunner {
  async run(request: { plan: FixPlan; appliedDir: string; recordId: string; runId: string }): Promise<readonly RunnerCase[]> {
    const { plan, appliedDir } = request
    const cases: RunnerCase[] = []

    // 1. Manifest parses and keeps the interface contract.
    const manifestPath = join(appliedDir, 'package.json')
    if (!existsSync(manifestPath)) {
      cases.push({ caseId: 'manifest', name: 'package.json exists', passed: false, durationMs: 0, detail: 'missing' })
    } else {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
        const ok = typeof manifest.main === 'string' && typeof manifest.types === 'string'
        cases.push({ caseId: 'manifest', name: 'package.json interface contract', passed: ok, durationMs: 0, detail: ok ? undefined : 'main/types missing' })
      } catch {
        cases.push({ caseId: 'manifest', name: 'package.json interface contract', passed: false, durationMs: 0, detail: 'unparseable JSON' })
      }
    }

    // 2. Every changed file exists (create) and is non-empty.
    for (const change of plan.changes) {
      const rel = change.file
      const full = join(appliedDir, rel)
      if (change.kind === 'delete') {
        cases.push({ caseId: `file:${rel}`, name: `${rel} deleted`, passed: !existsSync(full), durationMs: 0 })
        continue
      }
      if (!existsSync(full)) {
        cases.push({ caseId: `file:${rel}`, name: `${rel} exists`, passed: false, durationMs: 0, detail: 'missing after apply' })
        continue
      }
      const content = readFileSync(full, 'utf8')
      cases.push({ caseId: `file:${rel}`, name: `${rel} exists`, passed: content.length > 0, durationMs: 0, detail: content.length === 0 ? 'empty file' : undefined })
    }

    // 3. Every TypeScript source remains structurally balanced.
    for (const file of collectTsFiles(appliedDir)) {
      const content = readFileSync(file, 'utf8')
      const rel = relative(appliedDir, file).split(sep).join('/')
      const ok = balanced(content)
      cases.push({ caseId: `syntax:${rel}`, name: `${rel} balanced`, passed: ok, durationMs: 0, detail: ok ? undefined : 'unbalanced braces/brackets' })
    }

    return cases
  }
}

/** The Tester service: applied copies in, test reports out. */
export class Tester {
  #runner: TestRunner
  #maxIterations: number

  constructor(runner: TestRunner = new StaticSmokeRunner(), maxIterations = 3) {
    this.#runner = runner
    this.#maxIterations = maxIterations
  }

  /** Run one validation round. */
  async run(plan: FixPlan, appliedDir: string, recordId: string): Promise<TestReport> {
    const runId = `run_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`
    const cases = await this.#runner.run({ plan, appliedDir, recordId, runId })
    const passed = cases.every((c) => c.passed)
    return {
      runId,
      recordId,
      planId: plan.planId,
      passed,
      results: cases,
      errorReport: passed
        ? undefined
        : cases
            .filter((c) => !c.passed)
            .map((c) => `- [${c.caseId}] ${c.name}: ${c.detail ?? 'failed'}`)
            .join('\n'),
    }
  }

  get maxIterations(): number {
    return this.#maxIterations
  }
}
