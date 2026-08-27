import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareSandbox, compareAb } from '../src/sandbox-runner.ts'

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `sep-test-sandbox-${label}-`))
}

function writePlugin(dir: string): void {
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/index.ts'), 'export const name = "p"\n', 'utf8')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/p', version: '0.1.0' }), 'utf8')
}

describe('prepareSandbox', () => {
  it('copies a plugin tree into the sandbox', () => {
    const source = tempDir('src')
    writePlugin(source)
    const sandbox = prepareSandbox(source, { sandboxRoot: tempDir('sb'), label: 'run-1' })
    expect(existsSync(join(sandbox, 'package.json'))).toBe(true)
    expect(existsSync(join(sandbox, 'src/index.ts'))).toBe(true)
    rmSync(source, { recursive: true, force: true })
    rmSync(sandbox, { recursive: true, force: true })
  })

  it('refuses directories without a package.json', () => {
    const empty = tempDir('empty')
    expect(() => prepareSandbox(empty)).toThrow(/not a plugin package/)
    rmSync(empty, { recursive: true, force: true })
  })
})

describe('compareAb', () => {
  const baseResult = (overrides: Partial<Record<string, unknown>> = {}) => ({
    taskId: 't1',
    name: 'task one',
    passed: true,
    durationMs: 100,
    output: '',
    ...overrides,
  })

  it('flags a regression when the candidate fails where the baseline passed', () => {
    const comparison = compareAb([baseResult()], [baseResult({ passed: false, error: 'boom' })])
    expect(comparison.verdict).toBe('fail')
    expect(comparison.regressions).toHaveLength(1)
  })

  it('flags a latency regression above the slowdown threshold', () => {
    const comparison = compareAb([baseResult()], [baseResult({ durationMs: 500 })])
    expect(comparison.verdict).toBe('fail')
    expect(comparison.regressions[0]).toContain('latency')
  })

  it('passes when the candidate fixes a baseline failure', () => {
    const comparison = compareAb(
      [baseResult({ passed: false, error: 'old bug' })],
      [baseResult()],
    )
    expect(comparison.verdict).toBe('pass')
    expect(comparison.improvements).toHaveLength(1)
  })

  it('passes an equal healthy comparison', () => {
    const comparison = compareAb([baseResult()], [baseResult({ durationMs: 95 })])
    expect(comparison.verdict).toBe('pass')
    expect(comparison.regressions).toHaveLength(0)
  })
})
