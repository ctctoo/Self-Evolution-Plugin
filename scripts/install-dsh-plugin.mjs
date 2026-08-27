#!/usr/bin/env node
/**
 * install-dsh-plugin.mjs — 跨平台一键把 self-evolution 插件安装到 DSH。
 *
 * 用法:
 *   node scripts/install-dsh-plugin.mjs                 # 默认本地构建 -> web profile
 *   node scripts/install-dsh-plugin.mjs --profile tui   # 指定目标环境
 *   node scripts/install-dsh-plugin.mjs --source <源>   # 自定义源
 *   node scripts/install-dsh-plugin.mjs --dry-run       # 只打印, 不执行
 *
 * --source 支持: 留空=本地构建 | npm 包 | github:user/repo | 本地路径 / file: / link:
 *
 * 说明:
 *   - 有官方 dsh 命令则优先 `dsh plugin --profile <p> add <source>`;
 *     否则回退为在 profile 目录执行 pnpm add + 注入组合清单。
 *   - 安装后需重启 dsh 才能加载插件。
 *
 * 这是统一入口(跨平台); scripts/install-dsh-plugin.{ps1,sh} 是等价的单平台脚本。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

// Windows 上 pnpm/npm 是 .cmd shim, 必须经 shell 执行; 本脚本已对每个参数做
// 安全转义(run() 内 winQuote), 故抑制 Node 的 DEP0190 环境级提示。
process.removeAllListeners('warning')
process.on('warning', (w) => {
  if (w.name === 'DeprecationWarning' && w.message?.includes('shell option true')) return
  console.warn(w)
})

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const PLUGIN_DIR = join(REPO_ROOT, 'plugin')
const PLUGIN_NAME = '@self-evolution/dsh-plugin'
const PLUGIN_ID = 'self-evolution'

// ---------- 参数解析 ----------
const args = process.argv.slice(2)
const opts = { profile: 'web', source: '', dryRun: false, quiet: false }
for (let i = 0; i < args.length; i += 1) {
  const a = args[i]
  const next = () => (i + 1 < args.length ? args[++i] : '')
  if (a === '--profile') opts.profile = next()
  else if (a === '--source') opts.source = next()
  else if (a === '--dry-run') opts.dryRun = true
  else if (a === '--quiet') opts.quiet = true
  else if (a === '-h' || a === '--help') {
    console.log('用法: node scripts/install-dsh-plugin.mjs [--profile web|tui|headless] [--source <源>] [--dry-run] [--quiet]')
    process.exit(0)
  } else {
    console.error(`未知参数: ${a}`)
    process.exit(2)
  }
}

const say = (msg) => { if (!opts.quiet) console.log(msg) }
const warn = (msg) => console.error(`[WARN] ${msg}`)
const fail = (msg) => { console.error(`[ERROR] ${msg}`); process.exit(1) }

// ---------- 依赖探测 ----------
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const PROFILE_DIR = join(DSH_HOME, 'profiles', opts.profile)
const PATCH_FILE = join(PROFILE_DIR, 'cordis.patch.yml')

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { shell: true, stdio: 'ignore' })
  return r.status === 0
}
const pkgMgr = ['pnpm', 'npm'].find(which)
const dshBin = which('dsh')

if (!pkgMgr) fail('未找到 pnpm 或 npm, 请先安装 Node.js')

say('== DSH 自进化插件一键安装 ==')
say(`  仓库目录      : ${REPO_ROOT}`)
say(`  目标 profile  : ${opts.profile} (${PROFILE_DIR})`)
say(`  包管理器      : ${pkgMgr}`)

/**
 * Windows 上 pnpm/npm 是 `.cmd`/`.ps1` shim, Node 无法在 shell:false 下直接执行。
 * 这里在 Windows 用 `shell: true`, 但对每个参数做 Windows 命令行的安全引号转义,
 * 避免参数拼接注入(同时消除 DEP0190 的拼接隐患)。非 Windows 直接数组传参。
 */
function winQuote(arg) {
  if (/^[A-Za-z0-9_\-./:=@,]+$/.test(arg)) return arg
  // 用双引号包裹; 内部双引号按 cmd 规则转义为 \" 会引入复杂性, 这里仅处理常见路径/包名。
  return `"${arg.replace(/"/g, '""')}"`
}

function run(cwd, cmdArgs, opts2 = {}) {
  const target = cwd || process.cwd()
  if (opts2.dryRun || opts.dryRun) {
    say(`  [exec] ${opts2.pretty || cmdArgs.join(' ')}  (cwd=${target})`)
    return { status: 0, stdout: '', stderr: '' }
  }
  let r
  if (process.platform === 'win32') {
    // 数组元素先转义再交给 cmd 执行, 规避 .cmd 需 shell 且参数安全的问题。
    const line = `${cmdArgs[0]} ${cmdArgs.slice(1).map(winQuote).join(' ')}`
    r = spawnSync(line, { cwd: target, shell: true, stdio: opts2.capture ? 'pipe' : 'inherit', encoding: 'utf8' })
  } else {
    r = spawnSync(cmdArgs[0], cmdArgs.slice(1), { cwd: target, stdio: opts2.capture ? 'pipe' : 'inherit', encoding: 'utf8' })
  }
  if (r.status !== 0 && opts2.capture) {
    return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
  }
  return { status: r.status ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}

// ---------- 解析最终 source ----------
let source = opts.source
if (!source) {
  say('  未指定 --source, 使用本地构建产物')
  if (!existsSync(join(PLUGIN_DIR, 'package.json'))) fail(`未找到插件包: ${join(PLUGIN_DIR, 'package.json')}`)
  say(`  构建插件: ${pkgMgr} -C ${PLUGIN_DIR} run build`)
  if (!opts.dryRun) {
    const b = run(REPO_ROOT, [pkgMgr, '-C', PLUGIN_DIR, 'run', 'build'])
    if (b.status !== 0) fail(`插件构建失败(exit ${b.status})`)
  }
  source = PLUGIN_DIR
}

const isNative = Boolean(dshBin) && !/^(\.{1,2}[/\\]|[A-Za-z]:[/\\]|file:|link:)/.test(source)

// ---------- 安装依赖 ----------
say(`  安装插件到 profile (${opts.profile})...`)
if (!opts.dryRun) mkdirSync(PROFILE_DIR, { recursive: true })

if (isNative) {
  say(`  调用官方命令: dsh plugin --profile ${opts.profile} add ${source}`)
  const r = run(PROFILE_DIR, ['dsh', 'plugin', '--profile', opts.profile, 'add', source])
  if (r.status !== 0) fail(`dsh plugin add 失败(exit ${r.status})`)
} else {
  say(`  使用回退方式: ${pkgMgr} add <source>  于 ${PROFILE_DIR}`)
  if (!opts.dryRun) {
    // 确保 profile 目录是自包含的包根(即使它恰好落在某个 pnpm workspace 内)
    const pkgJson = join(PROFILE_DIR, 'package.json')
    if (!existsSync(pkgJson)) {
      writeFileSync(pkgJson, JSON.stringify({ name: `dsh-profile-${opts.profile}`, private: true, version: '0.0.0' }, null, 2) + '\n', 'utf8')
    }
    let addArg = source
    const abs = isAbsolute(source) || existsSync(source)
    if (abs) addArg = `file:${resolve(source)}`
    const args = [pkgMgr, 'add', addArg]
    if (pkgMgr === 'pnpm') args.push('--ignore-workspace-root-check')
    const r = run(PROFILE_DIR, args)
    if (r.status !== 0) fail(`依赖安装失败(exit ${r.status})`)
  }
}

// ---------- 注入组合清单 ----------
say(`  确保 ${PLUGIN_ID} 出现在组合清单中...`)
const block = [
  `- id: ${PLUGIN_ID}`,
  `  name: '${PLUGIN_NAME}'`,
  '  config:',
  '    enabled: true',
  "    allowlist: ['*']",
  "    protected: ['core','dsh-agent-loop','dsh-session','dsh-system-prompt','dsh-tools']",
  `    pluginsRoot: '${REPO_ROOT}/packages'`,
  `    sandboxRoot: '${REPO_ROOT}/.evolution-sandbox'`,
  '    maxIterations: 3',
].join('\n')

if (opts.dryRun) {
  say(`  [DryRun] 将把以下内容写入 ${PATCH_FILE} :`)
  block.split('\n').forEach((l) => say(`    ${l}`))
} else {
  let content = existsSync(PATCH_FILE) ? readFileSync(PATCH_FILE, 'utf8') : ''
  if (content.includes(`id: ${PLUGIN_ID}`)) {
    say(`  ${PLUGIN_ID} 已在 ${PATCH_FILE} 中, 跳过(如需更新配置请手动编辑该文件)`)
  } else {
    if (content && !content.endsWith('\n')) content += '\n'
    content += block + '\n'
    mkdirSync(dirname(PATCH_FILE), { recursive: true })
    writeFileSync(PATCH_FILE, content, 'utf8')
    say(`  已写入组合清单: ${PATCH_FILE}`)
  }
}

// ---------- 收尾 ----------
if (opts.dryRun) {
  say('\n[DryRun] 完成, 未执行任何实际修改。')
  process.exit(0)
}

say('\n== 安装完成 ==')
say(`  插件依赖已加入 profile: ${join(PROFILE_DIR, 'package.json')}`)
if (existsSync(PATCH_FILE)) say(`  组合清单: ${PATCH_FILE}`)
say('')
say('  下一步:')
say(`   1) 重启 dsh 使插件生效:  dsh --profile ${opts.profile}`)
say('   2) 查看已安装插件:        设置 -> 插件列表')
say('   3) 在模型侧调用工具:      self_evolve_analyze / review / apply / deploy / rollback')
say('')
say('  如插件未出现在设置中, 请检查:')
say('    - 插件是否停在 PENDING (缺少 tools/agents/sessions 服务提供方)')
say(`    - 用   dsh --profile ${opts.profile} --dump-config   查看组合后的配置树`)
