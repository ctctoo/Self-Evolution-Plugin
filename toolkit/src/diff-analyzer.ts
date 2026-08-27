/**
 * Diff analyzer.
 *
 * Compares two plugin trees (baseline vs candidate) and produces a
 * structured, review-friendly report: per-file status, line-level added /
 * removed counts via a simple LCS, and newly-introduced high-risk code
 * markers. Intended as the primary input for the inspection step of the
 * evolution loop (Readme § Diff 分析器).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { DiffReport, FileDiff } from './types.ts'

/** Literal high-risk code markers (aligned with the plugin Inspector). */
export const RISK_MARKERS: readonly string[] = [
  'process.exit(',
  'eval(',
  'new Function(',
  'node:child_process',
  'node:net',
  'child_process.spawn',
  'child_process.exec',
  'readFileSync("/etc/',
  'readFileSync("/root/',
]

/** Collect every file path (relative) under a directory. */
function collectFiles(dir: string, out = new Set<string>(), prefix = ''): Set<string> {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git') continue
    const full = join(dir, entry)
    const rel = prefix ? `${prefix}/${entry}` : entry
    if (statSync(full).isDirectory()) {
      collectFiles(full, out, rel)
    } else {
      out.add(rel)
    }
  }
  return out
}

/** Check newly added lines for risk markers. */
function riskMarkersOf(addedLines: readonly string[]): string[] {
  const hits = new Set<string>()
  for (const line of addedLines) {
    for (const marker of RISK_MARKERS) {
      if (line.includes(marker)) hits.add(marker)
    }
  }
  return [...hits]
}

type DiffOp = { readonly op: 'same' | 'add' | 'del'; readonly text: string }

/** Line-level diff of two texts via LCS (bounded; falls back for huge files). */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split(/\r?\n/)
  const b = after.split(/\r?\n/)
  if (a.length * b.length > 2_000_000) {
    // Large input: no shared-context refinement, report add/del directly.
    return [
      ...a.map((text) => ({ op: 'del' as const, text })),
      ...b.map((text) => ({ op: 'add' as const, text })),
    ]
  }

  // Classic DP LCS table.
  const m = a.length
  const n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    }
  }
  const out: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i]! })
      i += 1
      j += 1
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push({ op: 'del', text: a[i]! })
      i += 1
    } else {
      out.push({ op: 'add', text: b[j]! })
      j += 1
    }
  }
  while (i < m) {
    out.push({ op: 'del', text: a[i]! })
    i += 1
  }
  while (j < n) {
    out.push({ op: 'add', text: b[j]! })
    j += 1
  }
  return out
}

/** Build a hunk list with 1-based line anchors for a diff. */
function buildHunks(ops: readonly DiffOp[], deletedOnly = false): FileDiff['hunks'] {
  const hunks: { start: number; lines: string[] }[] = []
  let line = 1
  let current: { start: number; lines: string[] } | undefined
  for (const op of ops) {
    if (op.op === 'same') {
      line += 1
      current = undefined
      continue
    }
    if (deletedOnly && op.op === 'add') continue
    if (!current) {
      current = { start: line, lines: [] }
      hunks.push(current)
    }
    current.lines.push(`${op.op === 'add' ? '+' : '-'} ${op.text}`)
    if (op.op === 'del') line += 1
  }
  return hunks
}

function analyzeFile(baseDir: string, candidateDir: string, rel: string, hasBase: boolean, hasCandidate: boolean): FileDiff {
  if (!hasBase) {
    const lines = readFileSync(join(candidateDir, rel), 'utf8').split(/\r?\n/)
    return {
      path: rel,
      status: 'added',
      addedLines: lines.length,
      removedLines: 0,
      riskMarkers: riskMarkersOf(lines),
      hunks: [{ start: 1, lines }],
    }
  }
  if (!hasCandidate) {
    return { path: rel, status: 'removed', addedLines: 0, removedLines: 0, riskMarkers: [], hunks: [] }
  }
  const before = readFileSync(join(baseDir, rel), 'utf8')
  const after = readFileSync(join(candidateDir, rel), 'utf8')
  if (before === after) {
    return { path: rel, status: 'unchanged', addedLines: 0, removedLines: 0, riskMarkers: [], hunks: [] }
  }
  const ops = diffLines(before, after)
  const addedLines = ops.filter((o) => o.op === 'add').length
  const removedLines = ops.filter((o) => o.op === 'del').length
  const addedText = ops.filter((o) => o.op === 'add').map((o) => o.text)
  return {
    path: rel,
    status: 'modified',
    addedLines,
    removedLines,
    riskMarkers: riskMarkersOf(addedText),
    hunks: buildHunks(ops),
  }
}

/** Compare a baseline and a candidate plugin tree. */
export function analyzeDiff(baseDir: string, candidateDir: string): DiffReport {
  const baseFiles = collectFiles(baseDir)
  const candidateFiles = collectFiles(candidateDir)
  const all = new Set<string>([...baseFiles, ...candidateFiles])

  const files: FileDiff[] = []
  for (const rel of all) {
    const diff = analyzeFile(baseDir, candidateDir, rel, baseFiles.has(rel), candidateFiles.has(rel))
    if (diff.status !== 'unchanged') files.push(diff)
  }
  files.sort((x, y) => x.path.localeCompare(y.path))

  const added = files.filter((f) => f.status === 'added').length
  const removed = files.filter((f) => f.status === 'removed').length
  const modified = files.filter((f) => f.status === 'modified').length
  const addedLines = files.reduce((acc, f) => acc + f.addedLines, 0)
  const removedLines = files.reduce((acc, f) => acc + f.removedLines, 0)
  const riskMarkers = files.reduce((acc, f) => acc + f.riskMarkers.length, 0)

  return {
    baseDir: relative(process.cwd(), baseDir) || baseDir,
    candidateDir: relative(process.cwd(), candidateDir) || candidateDir,
    files,
    summary: { added, removed, modified, addedLines, removedLines, riskMarkers },
    riskLevel: riskMarkers > 0 ? 'high' : added + removed + modified > 0 ? 'low' : 'none',
  }
}
