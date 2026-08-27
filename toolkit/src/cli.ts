/**
 * `sep` — the self-evolution toolkit CLI.
 *
 * Subcommands:
 *   sep scaffold --name <name> --dir <out> [--group core|llm|support|util] [--dual-face] [--with-tests]
 *   sep contract --plugin <dir>
 *   sep diff --base <dir> --candidate <dir>
 *   sep bench --plugin <dir> --tasks <file> [--baseline <dir>] [--sandbox <dir>]
 *   sep version list|push|rollback ... (see below)
 */
import { existsSync, readFileSync } from 'node:fs'
import { scaffoldPlugin } from './scaffold.ts'
import { checkContract } from './contract.ts'
import { analyzeDiff } from './diff-analyzer.ts'
import { runAb, prepareSandbox, runBenchmark } from './sandbox-runner.ts'
import { VersionStore, HealthMonitor } from './version-manager.ts'
import type { BenchmarkTask } from './types.ts'

function fail(message: string): never {
  process.stderr.write(`sep: error: ${message}\n`)
  process.exit(1)
}

/** Minimal `--key value` / `--flag` parser. */
function parseArgs(argv: readonly string[]): Record<string, string | true> {
  const out: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (!arg.startsWith('--')) continue
    const key = arg.slice(2)
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next
      i += 1
    } else {
      out[key] = true
    }
  }
  return out
}

function requireArg(args: Record<string, string | true>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || !value) fail(`missing required --${key}`)
  return value as string
}

async function commandScaffold(args: Record<string, string | true>): Promise<void> {
  const name = requireArg(args, 'name')
  const outDir = requireArg(args, 'dir')
  const created = scaffoldPlugin({
    name,
    outDir,
    group: typeof args.group === 'string' ? args.group : undefined,
    description: typeof args.description === 'string' ? args.description : undefined,
    version: typeof args.version === 'string' ? args.version : undefined,
    namespace: typeof args.namespace === 'string' ? args.namespace : undefined,
    dualFace: args['dual-face'] === true,
    withTests: args['with-tests'] === true,
  })
  process.stdout.write(`${JSON.stringify({ ok: true, created }, null, 2)}\n`)
}

function commandContract(args: Record<string, string | true>): void {
  const dir = requireArg(args, 'plugin')
  const report = checkContract(dir)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = report.ok ? 0 : 1
}

function commandDiff(args: Record<string, string | true>): void {
  const base = requireArg(args, 'base')
  const candidate = requireArg(args, 'candidate')
  const report = analyzeDiff(base, candidate)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = report.riskLevel === 'high' ? 1 : 0
}

async function commandBench(args: Record<string, string | true>): Promise<void> {
  const plugin = requireArg(args, 'plugin')
  const tasksFile = requireArg(args, 'tasks')
  if (!existsSync(tasksFile)) fail(`tasks file not found: ${tasksFile}`)
  const tasks = JSON.parse(readFileSync(tasksFile, 'utf8')) as BenchmarkTask[]
  const sandboxRoot = typeof args.sandbox === 'string' ? args.sandbox : undefined

  if (typeof args.baseline === 'string') {
    const comparison = await runAb(args.baseline, plugin, tasks, { sandboxRoot })
    process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`)
    process.exitCode = comparison.verdict === 'fail' ? 1 : 0
  } else {
    const sandbox = prepareSandbox(plugin, { sandboxRoot, label: 'run' })
    const results = await runBenchmark(sandbox, tasks)
    process.stdout.write(`${JSON.stringify({ sandbox, results }, null, 2)}\n`)
    process.exitCode = results.some((r) => !r.passed) ? 1 : 0
  }
}

function commandVersion(args: Record<string, string | true>): void {
  const state = requireArg(args, 'state')
  const active = requireArg(args, 'active')
  const store = new VersionStore(state, active)
  const plugin = requireArg(args, 'plugin')
  const sub = requireArg(args, 'version-command')

  switch (sub) {
    case 'list': {
      process.stdout.write(`${JSON.stringify({ plugin, versions: store.list(plugin), onDisk: store.availableVersions(plugin) }, null, 2)}\n`)
      return
    }
    case 'push': {
      const version = requireArg(args, 'version')
      const source = requireArg(args, 'source')
      const entry = store.snapshot(plugin, version, source, typeof args.message === 'string' ? args.message : undefined)
      process.stdout.write(`${JSON.stringify({ ok: true, entry }, null, 2)}\n`)
      return
    }
    case 'rollback': {
      const version = typeof args.version === 'string' ? args.version : store.latest(plugin)?.version
      if (!version) fail(`no version to roll back for ${plugin}`)
      const restored = store.rollback(plugin, version)
      if (!restored) fail(`snapshot missing for ${plugin}@${version}`)
      process.stdout.write(`${JSON.stringify({ ok: true, restored: `${plugin}@${restored}` }, null, 2)}\n`)
      return
    }
    default:
      fail(`unknown version subcommand: ${sub}`)
  }
}

async function commandHealth(args: Record<string, string | true>): Promise<void> {
  const state = requireArg(args, 'state')
  const active = requireArg(args, 'active')
  const plugin = requireArg(args, 'plugin')
  const store = new VersionStore(state, active)
  const monitor = new HealthMonitor(store, {
    maxErrors: typeof args['max-errors'] === 'string' ? Number(args['max-errors']) : 5,
    windowMs: typeof args.window === 'string' ? Number(args.window) : 10 * 60_000,
  })
  const count = typeof args.count === 'string' ? Number(args.count) : 1
  for (let i = 0; i < count; i += 1) monitor.observe(plugin)
  process.stdout.write(
    `${JSON.stringify({ ok: true, plugin, rolledBack: monitor.didRollBack(plugin), versions: store.list(plugin) }, null, 2)}\n`,
  )
}

const COMMANDS: Record<string, (args: Record<string, string | true>) => void | Promise<void>> = {
  scaffold: commandScaffold,
  contract: commandContract,
  diff: commandDiff,
  bench: commandBench,
  'version-list': commandVersion,
  'version-push': commandVersion,
  'version-rollback': commandVersion,
  health: commandHealth,
}

/** CLI entry; returns the process exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(`usage: sep <command> [options]\ncommands: ${Object.keys(COMMANDS).join(', ')}\n`)
    return 0
  }
  // Normalize `version push` → `version-push` and record the subcommand.
  let normalized = command
  let subcommandArgs: Record<string, string> = {}
  if (command === 'version') {
    const sub = rest.shift() ?? ''
    normalized = `${command}-${sub}`
    subcommandArgs = { 'version-command': sub }
  }
  const handler = COMMANDS[normalized]
  if (!handler) fail(`unknown command: ${command}`)
  await handler({ ...parseArgs(rest), ...subcommandArgs })
  return Number(process.exitCode ?? 0)
}

// Run when executed directly (`node lib/cli.js <command>`). The file URL of
// the entry is `file://<path>`; normalize drive-letter paths for Windows.
const entryPath = process.argv[1]?.replace(/\\/g, '/').replace(/^([a-zA-Z]):/, '/$1:')
const isDirectRun = Boolean(entryPath) && import.meta.url === `file://${entryPath}`
if (isDirectRun) {
  main(process.argv.slice(2)).then((code) => process.exit(code))
}
