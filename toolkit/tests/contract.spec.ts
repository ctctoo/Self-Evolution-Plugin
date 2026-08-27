import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkContract } from '../src/contract.ts'

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `sep-test-contract-${label}-`))
}

function writePlugin(dir: string, overrides: Partial<Record<string, string>> = {}): void {
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/index.ts'), 'export const name = "x"\n', 'utf8')
  mkdirSync(join(dir, 'lib/types'), { recursive: true })
  writeFileSync(join(dir, 'lib/index.js'), 'export {}\n', 'utf8')
  writeFileSync(join(dir, 'lib/types/index.d.ts'), 'export {}\n', 'utf8')
  const manifest = {
    name: '@deepseek-ai/good',
    version: '0.1.0',
    private: true,
    type: 'module',
    main: 'lib/index.js',
    types: 'lib/types/index.d.ts',
    exports: { '.': { types: './lib/types/index.d.ts', default: './lib/index.js' } },
    files: ['lib'],
    scripts: { build: 'tsc -b', typecheck: 'tsc -b --pretty false' },
    ...(overrides.manifest ? { ...JSON.parse(overrides.manifest) } : {}),
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2), 'utf8')
}

describe('checkContract', () => {
  it('passes a spec-compliant plugin', () => {
    const dir = tempDir('ok')
    writePlugin(dir)
    const report = checkContract(dir)
    expect(report.ok).toBe(true)
    expect(report.plugin).toBe('@deepseek-ai/good')
    expect(report.findings.filter((f) => f.severity === 'error')).toHaveLength(0)
    rmSync(dir, { recursive: true, force: true })
  })

  it('flags a missing build output as an error', () => {
    const dir = tempDir('nobuild')
    writePlugin(dir)
    rmSync(join(dir, 'lib'), { recursive: true })
    const report = checkContract(dir)
    expect(report.ok).toBe(false)
    expect(report.findings.some((f) => f.rule === 'manifest/main-types')).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('enforces the dual-face rule: dsh.client without exports["./client"] is an error', () => {
    const dir = tempDir('dual')
    writePlugin(dir, { manifest: JSON.stringify({ dsh: { client: { inject: 'self-evolution' } } }) })
    const report = checkContract(dir)
    expect(report.ok).toBe(false)
    expect(report.findings.some((f) => f.rule === 'manifest/exports' && f.message.includes('exports["./client"] is missing'))).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects an unparseable manifest', () => {
    const dir = tempDir('broken')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), '{ not json', 'utf8')
    const report = checkContract(dir)
    expect(report.ok).toBe(false)
    expect(report.findings[0]?.rule).toBe('manifest/parses')
    rmSync(dir, { recursive: true, force: true })
  })

  it('rejects a non-module type field', () => {
    const dir = tempDir('cjs')
    writePlugin(dir, { manifest: JSON.stringify({ type: 'commonjs' }) })
    const report = checkContract(dir)
    expect(report.ok).toBe(false)
    expect(report.findings.some((f) => f.rule === 'manifest/type-module')).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
