/**
 * Sandbox benchmark runner with A/B comparison.
 *
 * Copies a plugin source tree into an isolated sandbox directory, executes a
 * set of benchmark tasks inside it (each task is a shell command run with the
 * plugin copy as its working directory), and compares a baseline and a
 * candidate run. A benchmark is a *regression* when the baseline passed and
 * the candidate failed, or when the candidate is significantly slower.
 */
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import type { AbComparison, AbVerdict, BenchmarkResult, BenchmarkTask } from './types.ts'

const execAsync = promisify(exec)

/** Create an isolated sandbox copy of a plugin tree. Returns its absolute path. */
export function prepareSandbox(sourceDir: string, options: { sandboxRoot?: string; label?: string } = {}): string {
  const source = resolve(sourceDir)
  if (!existsSync(join(source, 'package.json'))) {
    throw new Error(`not a plugin package: ${source}`)
  }
  const label = options.label ?? `run-${Date.now().toString(36)}`
  const target = options.sandboxRoot
    ? join(options.sandboxRoot, label)
    : join(mkdtempSync(join(tmpdir(), 'sep-sandbox-')), label)
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes('node_modules') })
  return target
}

/** Run one task in a sandbox. */
async function runTask(sandboxDir: string, task: BenchmarkTask): Promise<BenchmarkResult> {
  const started = Date.now()
  try {
    const { stdout, stderr } = await execAsync(task.command, {
      cwd: sandboxDir,
      timeout: task.timeoutMs ?? 60_000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, SEP_SANDBOX: '1' },
    })
    return {
      taskId: task.id,
      name: task.name,
      passed: true,
      durationMs: Date.now() - started,
      output: `${stdout}\n${stderr}`.trim(),
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean }
    return {
      taskId: task.id,
      name: task.name,
      passed: false,
      durationMs: Date.now() - started,
      output: `${err.stdout ?? ''}\n${err.stderr ?? ''}`.trim(),
      error: err.killed ? `timed out after ${task.timeoutMs ?? 60_000}ms` : err.message,
    }
  }
}

/** Execute every task against one sandboxed plugin copy. */
export async function runBenchmark(
  sandboxDir: string,
  tasks: readonly BenchmarkTask[],
  options: { concurrency?: number } = {},
): Promise<readonly BenchmarkResult[]> {
  const concurrency = options.concurrency ?? Math.max(1, Math.min(tasks.length, 4))
  const results: BenchmarkResult[] = new Array(tasks.length)
  let cursor = 0
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= tasks.length) return
      results[index] = await runTask(sandboxDir, tasks[index]!)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return results
}

/** Threshold beyond which a slower candidate is a regression (20%). */
const SLOWDOWN_RATIO = 1.2

/** Compare baseline and candidate benchmark runs. */
export function compareAb(
  baseline: readonly BenchmarkResult[],
  candidate: readonly BenchmarkResult[],
): AbComparison {
  const byId = (results: readonly BenchmarkResult[]) => new Map(results.map((r) => [r.taskId, r]))
  const base = byId(baseline)
  const cand = byId(candidate)

  const regressions: string[] = []
  const improvements: string[] = []

  for (const task of candidate) {
    const b = base.get(task.taskId)
    if (!b) continue // only present in candidate: not comparable
    if (b.passed && !task.passed) {
      regressions.push(`${task.taskId}: baseline passed, candidate failed (${task.error ?? 'no output'})`)
    } else if (!b.passed && task.passed) {
      improvements.push(`${task.taskId}: candidate passes where baseline failed`)
    } else if (b.passed && task.passed && task.durationMs > b.durationMs * SLOWDOWN_RATIO && task.durationMs - b.durationMs > 100) {
      regressions.push(`${task.taskId}: latency ${b.durationMs}ms → ${task.durationMs}ms (>${Math.round((SLOWDOWN_RATIO - 1) * 100)}%)`)
    } else if (b.passed && task.passed && task.durationMs < b.durationMs * 0.8) {
      improvements.push(`${task.taskId}: latency ${b.durationMs}ms → ${task.durationMs}ms`)
    }
  }

  const candidateFailed = candidate.some((r) => !r.passed)
  const baselineFailed = baseline.some((r) => !r.passed)
  let verdict: AbVerdict
  if (regressions.length > 0) {
    verdict = 'fail'
  } else if (candidateFailed && !baselineFailed) {
    verdict = 'fail'
  } else if (candidateFailed) {
    verdict = 'warn' // both fail; nothing got worse but nothing is green
  } else if (baselineFailed) {
    verdict = 'pass' // candidate fixed everything baseline failed
  } else {
    verdict = 'pass'
  }

  return { baseline, candidate, regressions, improvements, verdict }
}

/** One-shot A/B flow: sandbox baseline → sandbox candidate → comparison. */
export async function runAb(
  baseDir: string,
  candidateDir: string,
  tasks: readonly BenchmarkTask[],
  options: { sandboxRoot?: string } = {},
): Promise<AbComparison> {
  const baseSandbox = prepareSandbox(baseDir, { sandboxRoot: options.sandboxRoot, label: 'baseline' })
  const candSandbox = prepareSandbox(candidateDir, { sandboxRoot: options.sandboxRoot, label: 'candidate' })
  const [baseResults, candResults] = await Promise.all([
    runBenchmark(baseSandbox, tasks),
    runBenchmark(candSandbox, tasks),
  ])
  return compareAb(baseResults, candResults)
}
