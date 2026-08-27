import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { VersionStore, HealthMonitor } from '../src/version-manager.ts'

function tempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `sep-test-version-${label}-`))
}

function writeTree(dir: string, content: string): void {
  mkdirSync(join(dir, 'src'), { recursive: true })
  writeFileSync(join(dir, 'src/index.ts'), content, 'utf8')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/demo', version: '0.1.0' }), 'utf8')
}

describe('VersionStore', () => {
  it('snapshots versions and lists them newest-first', () => {
    const state = tempDir('state')
    const active = tempDir('active')
    const srcV1 = tempDir('v1')
    const srcV2 = tempDir('v2')
    writeTree(srcV1, 'const v = 1\n')
    writeTree(srcV2, 'const v = 2\n')

    const store = new VersionStore(state, active)
    store.snapshot('demo', 'v1', srcV1, 'initial')
    store.snapshot('demo', 'v2', srcV2, 'evolve')

    const versions = store.list('demo')
    expect(versions.map((v) => v.version)).toEqual(['v2', 'v1'])
    expect(versions[0]?.commitMessage).toBe('evolve')

    rmSync(state, { recursive: true, force: true })
    rmSync(active, { recursive: true, force: true })
    rmSync(srcV1, { recursive: true, force: true })
    rmSync(srcV2, { recursive: true, force: true })
  })

  it('restores an active tree from a snapshot on rollback', () => {
    const state = tempDir('state2')
    const active = tempDir('active2')
    const srcV1 = tempDir('v1b')
    const srcV2 = tempDir('v2b')
    writeTree(srcV1, 'const v = 1\n')
    writeTree(srcV2, 'const v = 2\n')
    const store = new VersionStore(state, active)

    store.snapshot('demo', 'v1', srcV1)
    store.snapshot('demo', 'v2', srcV2)
    // Simulate deploy of v2 as the active tree.
    const activeDemo = join(active, 'demo')
    mkdirSync(join(activeDemo, 'src'), { recursive: true })
    writeFileSync(join(activeDemo, 'src/index.ts'), 'const v = 2\n', 'utf8')

    const restored = store.rollback('demo', 'v1')
    expect(restored).toBe('v1')
    expect(readFileSync(join(activeDemo, 'src/index.ts'), 'utf8')).toContain('const v = 1')

    rmSync(state, { recursive: true, force: true })
    rmSync(active, { recursive: true, force: true })
    rmSync(srcV1, { recursive: true, force: true })
    rmSync(srcV2, { recursive: true, force: true })
  })

  it('persists the ledger across instances', () => {
    const state = tempDir('state3')
    const active = tempDir('active3')
    const src = tempDir('v1c')
    writeTree(src, '1\n')
    const first = new VersionStore(state, active)
    first.snapshot('demo', 'v1', src)
    const second = new VersionStore(state, active)
    expect(second.list('demo').map((v) => v.version)).toEqual(['v1'])
    rmSync(state, { recursive: true, force: true })
    rmSync(active, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  })
})

describe('HealthMonitor', () => {
  it('automatically rolls back to the previous version after the error threshold', () => {
    const state = tempDir('state4')
    const active = tempDir('active4')
    const srcV1 = tempDir('v1d')
    const srcV2 = tempDir('v2d')
    writeTree(srcV1, 'stable 1\n')
    writeTree(srcV2, 'buggy 2\n')
    const store = new VersionStore(state, active)
    store.snapshot('demo', 'v1', srcV1)
    store.snapshot('demo', 'v2', srcV2)
    const activeDemo = join(active, 'demo')
    mkdirSync(join(activeDemo, 'src'), { recursive: true })
    writeFileSync(join(activeDemo, 'src/index.ts'), 'buggy 2\n', 'utf8')

    const monitor = new HealthMonitor(store, { maxErrors: 3, windowMs: 60_000 })
    for (let i = 0; i < 3; i += 1) monitor.observe('demo')

    expect(monitor.didRollBack('demo')).toBe(true)
    expect(readFileSync(join(activeDemo, 'src/index.ts'), 'utf8')).toContain('stable 1')
    expect(store.list('demo').find((e) => e.version === 'v2')?.healthStatus).toBe('unhealthy')

    rmSync(state, { recursive: true, force: true })
    rmSync(active, { recursive: true, force: true })
    rmSync(srcV1, { recursive: true, force: true })
    rmSync(srcV2, { recursive: true, force: true })
  })
})
