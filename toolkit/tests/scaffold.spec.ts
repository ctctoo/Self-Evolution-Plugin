import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scaffoldPlugin, packageId } from '../src/scaffold.ts'

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `sep-test-${label}-`))
}

describe('scaffoldPlugin', () => {
  it('generates a complete plugin package with the DSH manifest invariants', () => {
    const out = tempDir('scaffold')
    const created = scaffoldPlugin({ name: 'hello-world', outDir: out, description: 'A test plugin.' })

    expect(created).toContain(join(out, 'package.json'))
    expect(created).toContain(join(out, 'src/index.ts'))
    expect(created).toContain(join(out, 'tsconfig.json'))

    const manifest = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'))
    expect(manifest.name).toBe('@deepseek-ai/hello-world')
    expect(manifest.private).toBe(true)
    expect(manifest.type).toBe('module')
    expect(manifest.main).toBe('lib/index.js')
    expect(manifest.types).toBe('lib/types/index.d.ts')
    expect(manifest.exports['.'].types).toBe('./lib/types/index.d.ts')
    expect(manifest.files).toContain('lib')

    const index = readFileSync(join(out, 'src/index.ts'), 'utf8')
    expect(index).toContain("export const name = 'hello-world'")
    expect(index).toContain('export function apply(')
    expect(index).toContain('export const Config =')

    rmSync(out, { recursive: true, force: true })
  })

  it('generates the client half when dualFace is requested', () => {
    const out = tempDir('dual')
    scaffoldPlugin({ name: 'dashboard', outDir: out, dualFace: true })
    const manifest = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8'))
    expect(manifest.dsh.client).toBeDefined()
    expect(manifest.exports['./client']).toBeDefined()
    expect(existsSync(join(out, 'src/client/index.ts'))).toBe(true)
    rmSync(out, { recursive: true, force: true })
  })

  it('validates the plugin name and refuses non-empty directories', () => {
    expect(() => scaffoldPlugin({ name: 'Bad Name!', outDir: tempDir('x') })).toThrow(/invalid plugin name/)
    const out = tempDir('occupied')
    const created = scaffoldPlugin({ name: 'first', outDir: out })
    expect(created.length).toBeGreaterThan(0)
    expect(() => scaffoldPlugin({ name: 'second', outDir: out })).toThrow(/non-empty directory/)
    rmSync(out, { recursive: true, force: true })
  })

  it('computes a scoped package id from namespace and name', () => {
    expect(packageId({ name: 'x', namespace: '@dsh' })).toBe('@dsh/x')
    expect(packageId({ name: 'y' })).toBe('@deepseek-ai/y')
  })
})
