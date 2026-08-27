# scripts/ — 一键安装脚本

把 `self-evolution` 插件安装到 DSH 的三种等价入口。任选其一：

## 快速开始

```sh
# 推荐（跨平台，Windows / macOS / Linux 均可用）
node scripts/install-dsh-plugin.mjs            # 默认本地构建 -> web profile

# 或从仓库根 package.json 入口
pnpm install:dsh          # 装到 web
pnpm install:dsh:tui      # 装到 tui
pnpm install:dsh:dry      # 试运行，只打印不改动
```

## 参数

| 参数 | 说明 | 默认 |
|---|---|---|
| `--profile <p>` | 目标环境：`web` / `tui` / `headless` | `web` |
| `--source <源>` | 见下表 | 本地构建产物 |
| `--dry-run` | 只打印将要执行的步骤，不真正执行 | 关 |
| `--quiet` | 精简输出 | 关 |

### `--source` 支持的取值

| 取值 | 含义 |
|---|---|
| （留空） | 本地构建 `plugin/` 后安装（开发期最常用） |
| `@scope/pkg@version` | npm 包（发布到 registry 后） |
| `github:user/repo` | GitHub 仓库 |
| `/abs/path` / `file:...` | 本地目录 / tarball |

## 官方命令优先，自动回退

脚本在内部按以下优先级执行：

1. 若本机存在官方 `dsh` 命令且 source 为 npm/github 源 →
   调用 `dsh plugin --profile <profile> add <source>`
2. 否则 → 回退为在 profile 目录（`~/.dsh/profiles/<profile>`）
   直接执行 `pnpm add`，并把插件写入该 profile 的 `cordis.patch.yml` 组合清单

> 无论哪种方式，安装后都需**重启 dsh** 才能在"设置 → 插件列表"中看到本插件。

## 平台对应脚本

- `install-dsh-plugin.mjs` — 跨平台 Node 脚本（推荐，功能最全）
- `install-dsh-plugin.ps1`  — Windows PowerShell（需 UTF-8 BOM，已内置）
- `install-dsh-plugin.sh`   — macOS / Linux bash（`bash -n` 已验证）

## 安装后验证

```sh
dsh --profile web --dump-config     # 查看组合后的配置树，确认 self-evolution 已加载
dsh --profile web                   # 重启进入，设置 -> 插件列表查看
```

若插件未出现，多半停在 `PENDING`（缺少 `tools`/`agents`/`sessions` 服务提供方）——
在 profile 组合清单中确保这些服务的提供方插件（如 `@deepseek-ai/dsh-tools`、
`dsh-agent-loop`、`dsh-session`）也已启用。
