#!/usr/bin/env bash
# install-dsh-plugin.sh — 一键把 self-evolution 插件安装到 DSH。
#
# 用法:
#   ./scripts/install-dsh-plugin.sh                      # 用默认 source(本地构建) 装到 web profile
#   ./scripts/install-dsh-plugin.sh --profile tui        # 指定目标环境
#   ./scripts/install-dsh-plugin.sh --source <源>        # 自定义源(见下)
#   ./scripts/install-dsh-plugin.sh --dry-run            # 只打印步骤, 不执行
#
# --source 支持: 留空=本地构建 | npm 包 | github:user/repo | 本地路径/file:
#
# 说明:
#   - 需要 pnpm(node 优先) 与 node。
#   - 有官方 dsh 命令则优先 `dsh plugin --profile <p> add <source>`;
#     否则回退为在 profile 目录执行 pnpm add + 注入组合清单。
#   - 安装后需重启 dsh 生效。
set -euo pipefail

# ---------- 参数解析 ----------
PROFILE="web"
SOURCE=""
DRY_RUN=0
QUIET=0
while [ $# -gt 0 ]; do
    case "$1" in
        --profile)   PROFILE="$2"; shift 2 ;;
        --source)    SOURCE="$2"; shift 2 ;;
        --dry-run)   DRY_RUN=1; shift ;;
        --quiet)     QUIET=1; shift ;;
        -h|--help)   sed -n '1,20p' "$0"; exit 0 ;;
        *)           echo "未知参数: $1" >&2; exit 2 ;;
    esac
done

say() { [ "$QUIET" -eq 0 ] && echo "$*"; }
warn() { echo "[WARN] $*" >&2; }

# ---------- 路径与依赖探测 ----------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PLUGIN_DIR="$REPO_ROOT/plugin"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
PATCH_FILE="$PROFILE_DIR/cordis.patch.yml"

PKG_MGR=""
if command -v pnpm >/dev/null 2>&1; then PKG_MGR="pnpm"
elif command -v npm >/dev/null 2>&1; then PKG_MGR="npm"
else echo "未找到 pnpm 或 npm" >&2; exit 1; fi

DSH_BIN=""
if command -v dsh >/dev/null 2>&1; then DSH_BIN="dsh"; fi

PLUGIN_NAME="@self-evolution/dsh-plugin"
PLUGIN_ID="self-evolution"

say "== DSH 自进化插件一键安装 =="
say "  仓库目录      : $REPO_ROOT"
say "  目标 profile  : $PROFILE ($PROFILE_DIR)"
say "  包管理器      : $PKG_MGR"

# ---------- 解析最终 source ----------
if [ -z "$SOURCE" ]; then
    say "  未指定 --source, 使用本地构建产物"
    [ -f "$PLUGIN_DIR/package.json" ] || { echo "未找到插件包: $PLUGIN_DIR/package.json" >&2; exit 1; }
    say "  构建插件: $PKG_MGR -C $PLUGIN_DIR run build"
    if [ "$DRY_RUN" -eq 0 ]; then
        (cd "$REPO_ROOT" && "$PKG_MGR" -C "$PLUGIN_DIR" run build)
    fi
    SOURCE="$PLUGIN_DIR"
fi

# 判断是否走官方 dsh 命令(仅 npm/github 源且 dsh 可用)
IS_DSH_NATIVE=0
if [ -n "$DSH_BIN" ] && [[ ! "$SOURCE" =~ ^(\.{1,2}/|[A-Za-z]:[/\\]|file:|link:) ]]; then
    IS_DSH_NATIVE=1
fi

# ---------- 安装依赖 ----------
say "  安装插件到 profile ($PROFILE)..."
[ "$DRY_RUN" -eq 0 ] && mkdir -p "$PROFILE_DIR"

if [ "$IS_DSH_NATIVE" -eq 1 ]; then
    say "  调用官方命令: dsh plugin --profile $PROFILE add $SOURCE"
    if [ "$DRY_RUN" -eq 0 ]; then
        dsh plugin --profile "$PROFILE" add "$SOURCE"
    fi
else
    say "  使用回退方式: $PKG_MGR add <source>  于 $PROFILE_DIR"
    if [ "$DRY_RUN" -eq 0 ]; then
        # 确保 profile 目录是自包含的包根(即使它恰好落在某个 pnpm workspace 内)
        PKG_JSON="$PROFILE_DIR/package.json"
        if [ ! -f "$PKG_JSON" ]; then
            printf '{\n  "name": "dsh-profile-%s",\n  "private": true,\n  "version": "0.0.0"\n}\n' "$PROFILE" > "$PKG_JSON"
        fi
        ADD_ARG="$SOURCE"
        if [ -d "$SOURCE" ] || [ -f "$SOURCE" ]; then
            RESOLVED="$(cd "$(dirname "$SOURCE")" && pwd)/$(basename "$SOURCE")"
            ADD_ARG="file:$RESOLVED"
        fi
        EXTRA_FLAGS=()
        if [ "$PKG_MGR" = "pnpm" ]; then EXTRA_FLAGS+=("--ignore-workspace-root-check"); fi
        (cd "$PROFILE_DIR" && "$PKG_MGR" add "$ADD_ARG" "${EXTRA_FLAGS[@]}")
    fi
fi

# ---------- 注入组合清单 ----------
say "  确保 $PLUGIN_ID 出现在组合清单中..."
read -r -d '' BLOCK <<EOF || true
- id: $PLUGIN_ID
  name: '$PLUGIN_NAME'
  config:
    enabled: true
    allowlist: ['*']
    protected: ['core','dsh-agent-loop','dsh-session','dsh-system-prompt','dsh-tools']
    pluginsRoot: '$REPO_ROOT/packages'
    sandboxRoot: '$REPO_ROOT/.evolution-sandbox'
    maxIterations: 3
EOF

if [ "$DRY_RUN" -eq 0 ]; then
    if [ -f "$PATCH_FILE" ] && grep -qF "id: $PLUGIN_ID" "$PATCH_FILE"; then
        say "  $PLUGIN_ID 已在 $PATCH_FILE 中, 跳过(如需更新配置请手动编辑该文件)"
    else
        mkdir -p "$(dirname "$PATCH_FILE")"
        { [ -f "$PATCH_FILE" ] && cat "$PATCH_FILE" && echo; echo "$BLOCK"; } > "$PATCH_FILE.tmp"
        mv "$PATCH_FILE.tmp" "$PATCH_FILE"
        say "  已写入组合清单: $PATCH_FILE"
    fi
else
    say "  [DryRun] 将把以下内容写入 $PATCH_FILE :"
    echo "$BLOCK" | sed 's/^/    /'
fi

# ---------- 收尾 ----------
if [ "$DRY_RUN" -eq 1 ]; then
    say ""
    say "[DryRun] 完成, 未执行任何实际修改。"
    exit 0
fi

say ""
say "== 安装完成 =="
say "  插件依赖已加入 profile: $PROFILE_DIR/package.json"
[ -f "$PATCH_FILE" ] && say "  组合清单: $PATCH_FILE"
say ""
say "  下一步:"
say "   1) 重启 dsh 使插件生效:  dsh --profile $PROFILE"
say "   2) 查看已安装插件:        设置 -> 插件列表"
say "   3) 在模型侧调用工具:      self_evolve_analyze / review / apply / deploy / rollback"
say ""
say "  如插件未出现在设置中, 请检查:"
say "    - 插件是否停在 PENDING (缺少 tools/agents/sessions 服务提供方)"
say "    - 用   dsh --profile $PROFILE --dump-config   查看组合后的配置树"
