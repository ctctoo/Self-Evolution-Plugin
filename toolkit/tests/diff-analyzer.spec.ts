import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeDiff, diffLines } from '../src/diff-analyzer.ts'

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `sep-test-diff-${label}-`))
}

function writeTree(dir: string, files: Record<string, string>): void {
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel)
    mkdirSync(target.split(/[\\/]/).slice(0, -1).join('/'), { recursive: true })
    writeFileSync(target, content, 'utf8')
  }
}

describe('diffLines', () => {
  it('computes additions and deletions for a small edit', () => {
    const ops = diffLines('line1\nline2\nline3\n', 'line1\nline2\nline2b\nline3\n')
    expect(ops.filter((o) => o.op === 'add')).toHaveLength(1)
    expect(ops.filter((o) => o.op === 'del')).toHaveLength(0)
    expect(ops.some((o) => o.op === 'add' && o.text === 'line2b')).toBe(true)
  })

  it('detects a pure removal', () => {
    const ops = diffLines('a\nb\nc\n', 'a\nc\n')
    expect(ops.filter((o) => o.op === 'del').map((o) => o.text)).toEqual(['b'])
  })
})

describe('analyzeDiff', () => {
  it('classifies added, removed, modified and unchanged files', () => {
    const base = tempDir('base')
    const candidate = tempDir('cand')
    writeTree(base, {
      'src/keep.ts': 'const keep = 1\n',
      'src/change.ts': 'const value = 1\n',
      'src/remove.ts': 'gone\n',
    })
    writeTree(candidate, {
      'src/keep.ts': 'const keep = 1\n',
      'src/change.ts': 'const value = 2\n',
      'src/new.ts': 'const n = 3\n',
    })

    const report = analyzeDiff(base, candidate)
    const byPath = new Map(report.files.map((f) => [f.path, f]))

    expect(byPath.get('src/keep.ts')).toBeUndefined() // unchanged files are excluded
    expect(byPath.get('src/change.ts')?.status).toBe('modified')
    expect(byPath.get('src/remove.ts')?.status).toBe('removed')
    expect(byPath.get('src/new.ts')?.status).toBe('added')
    expect(report.summary.modified).toBe(1)
    expect(report.summary.removed).toBe(1)
    expect(report.summary.added).toBe(1)
    expect(report.summary.riskMarkers).toBe(0)
    expect(report.riskLevel).toBe('low')

    rmSync(base, { recursive: true, force: true })
    rmSync(candidate, { recursive: true, force: true })
  })

  it('flags newly introduced high-risk patterns', () => {
    const base = tempDir('base2')
    const candidate = tempDir('cand2')
    writeTree(base, { 'src/tool.ts': 'export const ok = 1\n' })
    writeTree(candidate, {
      'src/tool.ts': 'export const ok = 1\nif (x) process.exit(1)\n',
    })
    const report = analyzeDiff(base, candidate)
    expect(report.summary.riskMarkers).toBeGreaterThan(0)
    expect(report.riskLevel).toBe('high')
    const tool = report.files.find((f) => f.path === 'src/tool.ts')
    expect(tool?.riskMarkers).toContain('process.exit(')

    rmSync(base, { recursive: true, force: true })
    rmSync(candidate, { recursive: true, force: true })
  })

  it('reports an empty diff for identical trees', () => {
    const a = tempDir('same')
    const b = tempDir('same2')
    writeTree(a, { 'x.ts': '1\n' })
    writeTree(b, { 'x.ts': '1\n' })
    const report = analyzeDiff(a, b)
    expect(report.files).toHaveLength(0)
    expect(report.riskLevel).toBe('none')
    rmSync(a, { recursive: true, force: true })
    rmSync(b, { recursive: true, force: true })
  })
})
