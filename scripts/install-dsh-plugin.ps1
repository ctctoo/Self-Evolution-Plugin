#requires -Version 5.1
<#
  install-dsh-plugin.ps1 — 一键把 self-evolution 插件安装到 DSH。

  用法:
    .\scripts\install-dsh-plugin.ps1                      # 用默认 source(本地构建) 装到 web profile
    .\scripts\install-dsh-plugin.ps1 -Profile tui          # 指定目标环境
    .\scripts\install-dsh-plugin.ps1 -Source <源>          # 自定义源(见下)
    .\scripts\install-dsh-plugin.ps1 -DryRun              # 只打印将要执行的步骤,不真正执行

  -Source 支持:
      * 留空                    -> 优先本地构建产物(把 plugin/ 打包后安装)
      * npm 包                  -> 例如 @self-evolution/dsh-plugin@latest
      * github                  -> 例如 github:zhu1090093659/dsh-web-ui
      * 本地目录/文件           -> 绝对路径或 file: 协议

  说明:
    - 需要 pnpm 与 node 可用(pnpm 优先, 无则回退 npm)。
    - 若本机有官方 dsh 命令, 优先调用 `dsh plugin --profile <p> add <source>`;
      否则回退为在 profile 目录直接执行 pnpm add 并注入组合清单。
    - 安装后需重启 dsh 才能加载插件。
#>
[CmdletBinding()]
param(
    [string]$Profile = 'web',
    [string]$Source = '',
    [switch]$DryRun,
    [switch]$Quiet
)

$ErrorActionPreference = 'Stop'
function Say($msg) { if (-not $Quiet) { Write-Host $msg } }
function Warn($msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }

# ---------- 1. 路径与依赖探测 ----------
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PluginDir = Join-Path $RepoRoot 'plugin'
$DSHHome   = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
$ProfileDir = Join-Path $DSHHome "profiles\$Profile"
$PatchFile  = Join-Path $ProfileDir 'cordis.patch.yml'

# pnpm 优先, npm 兜底
$PkgMgr = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $PkgMgr) { $PkgMgr = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $PkgMgr) { throw '未找到 pnpm 或 npm, 请先安装 Node.js' }
$pkgCmd = $PkgMgr.Name

# 官方 dsh 命令(可选)
$Dsh = Get-Command dsh -ErrorAction SilentlyContinue

$PluginName = '@self-evolution/dsh-plugin'   # 插件 npm 包名
$PluginId   = 'self-evolution'               # 插件 name 导出 + 组合清单 id

Say "== DSH 自进化插件一键安装 =="
Say "  仓库目录      : $RepoRoot"
Say "  目标 profile  : $Profile  ($ProfileDir)"
Say "  包管理器      : $pkgCmd"

# ---------- 2. 解析最终的 source ----------
if ($Source -eq '') {
    # 默认本地构建: 打包 plugin/ 为一个可被 pnpm add 的本地 tarball/目录
    Say "  未指定 -Source, 使用本地构建产物"
    if (-not (Test-Path (Join-Path $PluginDir 'package.json'))) {
        throw "未找到插件包: $PluginDir\package.json"
    }
    # 构建
    Say "  构建插件: pnpm -C $PluginDir run build"
    if (-not $DryRun) {
        Push-Location $RepoRoot
        try { & $pkgCmd -C $PluginDir run build } catch { throw "插件构建失败: $_" }
        finally { Pop-Location }
    }
    $Source = $PluginDir
}

$isDshNative = $Dsh -and $Source -notmatch '^(\.{1,2}[\\/]|[A-Za-z]:[\\/]|file:|link:)'

# ---------- 3. 安装依赖到 profile ----------
Say "  安装插件到 profile ($Profile)..."

if (-not $DryRun) {
    New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null
}

if ($isDshNative) {
    # 官方 dsh 命令(适合 npm/github 源)
    Say "  调用官方命令: dsh plugin --profile $Profile add $Source"
    if (-not $DryRun) {
        & $Dsh.Source plugin --profile $Profile add $Source
        if ($LASTEXITCODE -ne 0) { throw "dsh plugin add 失败(exit $LASTEXITCODE)" }
    }
} else {
    # 回退: 在 profile 目录直接安装依赖
    Say "  使用回退方式: $pkgCmd add <source>  于 $ProfileDir"
    if (-not $DryRun) {
        Push-Location $ProfileDir
        try {
            # 确保 profile 目录是自包含的包根(即使它恰好落在某个 pnpm workspace 内)
            $pkgJson = Join-Path $ProfileDir 'package.json'
            if (-not (Test-Path $pkgJson)) {
                $init = @{ name = "dsh-profile-$Profile"; private = $true; version = '0.0.0' } | ConvertTo-Json -Depth 3
                Set-Content -Path $pkgJson -Value $init -Encoding utf8
            }
            # 本地路径统一转换为 file: 协议, 保证 pnpm/npm 均可用
            $addArg = $Source
            if (Test-Path $Source) {
                $resolved = (Resolve-Path $Source).Path
                $addArg = "file:$resolved"
            }
            $addCmdArgs = @('add', $addArg)
            if ($pkgCmd -match '^pnpm') { $addCmdArgs += '--ignore-workspace-root-check' }
            & $pkgCmd @addCmdArgs
            if ($LASTEXITCODE -ne 0) { throw "依赖安装失败(exit $LASTEXITCODE)" }
        } finally { Pop-Location }
    }
}

# ---------- 4. 注入组合清单(cordis.patch.yml) ----------
Say "  确保 $PluginId 出现在组合清单中..."
$block = @(
    "- id: $PluginId"
    "  name: '$PluginName'"
    "  config:"
    "    enabled: true"
    "    allowlist: ['*']"
    "    protected: ['core','dsh-agent-loop','dsh-session','dsh-system-prompt','dsh-tools']"
    "    pluginsRoot: '$RepoRoot/packages'"
    "    sandboxRoot: '$RepoRoot/.evolution-sandbox'"
    "    maxIterations: 3"
)

if (-not $DryRun) {
    $content = if (Test-Path $PatchFile) { Get-Content $PatchFile -Raw } else { '' }
    if ($content -match [regex]::Escape("id: $PluginId")) {
        Say "  $PluginId 已在 $PatchFile 中, 跳过(如需更新配置请手动编辑该文件的 config 键)"
    } else {
        $toWrite = $content
        if ($toWrite -and -not $toWrite.EndsWith("`n")) { $toWrite += "`n" }
        # 追加到 plugins 顶层列表之后; cordis.patch.yml 是叠加层, 追加即可
        $toWrite += ($block -join "`n") + "`n"
        Set-Content -Path $PatchFile -Value $toWrite -Encoding utf8
        Say "  已写入组合清单: $PatchFile"
    }
} else {
    Say "  [DryRun] 将把以下内容写入 $PatchFile :"
    $block | ForEach-Object { Say "    $_" }
}

# ---------- 5. 收尾 ----------
if ($DryRun) {
    Say "`n[DryRun] 完成, 未执行任何实际修改。"
    exit 0
}

Say ""
Say "== 安装完成 =="
Say "  插件依赖已加入 profile: $ProfileDir\package.json"
if (Test-Path $PatchFile) { Say "  组合清单: $PatchFile" }
Say ""
Say "  下一步:"
Say "   1) 重启 dsh 使插件生效:  dsh --profile $Profile"
Say "   2) 查看已安装插件:        设置 -> 插件列表"
Say "   3) 在模型侧调用工具:      self_evolve_analyze / review / apply / deploy / rollback"
Say ""
Say "  如插件未出现在设置中, 请检查:"
Say "    - 插件是否停在 PENDING (缺少 tools/agents/sessions 服务提供方)"
Say "    - 用   dsh --profile $Profile --dump-config   查看组合后的配置树"
