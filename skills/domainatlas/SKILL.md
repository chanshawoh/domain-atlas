---
name: domainatlas
description: 仅当用户明确要求使用 DomainAtlas（或显式调用 $domainatlas）查看、记录、纠正业务变更、查看业务地图或管理全局 Codex 钩子时使用。项目数据操作前确认已初始化；未初始化时不自动创建事实目录，只有明确要求初始化时才执行。普通开发、Git 提交、代码图谱查询以及仅提到名称时不触发本技能；已安装的全局钩子独立为已初始化项目自动记录，无需每轮调用技能。
---

# DomainAtlas

通过 DomainAtlas CLI 使用 Git 跟踪的业务变更事实，保留来源、置信度和追加式历史。

## 什么时候使用

- 用户明确说“用 DomainAtlas 查看当前项目的变更”“使用 DomainAtlas 记录这次需求”“用 DomainAtlas 纠正这条记录”或“打开 DomainAtlas 业务地图”。
- 用户显式调用 `$domainatlas`，且操作目标明确；未指定操作时先确认要查看还是记录，不默认写入。
- 用户明确要求“为这个项目初始化 DomainAtlas”时，进入下述初始化流程。
- 用户明确要求全局安装或卸载 DomainAtlas Codex 钩子时，进入全局钩子流程；该操作不要求当前目录是已初始化项目。

以下情况不触发：普通编码、修复、测试、审查、提交；仅存在 `.domainatlas/`、本技能、图谱索引或已安装 CLI；仅讨论 DomainAtlas、修改其源码或编写其文档。未获明确使用指令时，不主动探测初始化状态、不读取业务记录、不执行 CLI，不附带记录本次任务。

用户的明确使用指令只覆盖其指定的项目、操作和范围。“查看”不包含智能体主动写入。技能调用与自动记录独立：全局钩子安装并受信任后，已初始化项目每轮自动记录，无需前缀；仅“记录本次变更”不代表授权安装全局钩子。

## 操作前检查

1. 在用户指定的目标目录确认 Git 仓库根目录，后续数据操作均以该根目录作为工作目录。区分 **DomainAtlas 工具仓库** 与 **被记录的目标仓库**；不能因为工具仓库已初始化，就认为目标仓库也已初始化。
2. 只读检查目标根目录的 `.domainatlas/config.json`。当前格式应为可解析的 JSON，包含 `schemaVersion: 1` 和 `storage: "immutable-json-files"`。只有 `.domainatlas/` 空目录、代码图谱索引或工具安装，不代表完成初始化。初次初始化可以没有任何变更记录，不要求 `changes/` 等目录预先存在。
3. 配置缺失时停止 DomainAtlas 操作，说明目标项目尚未初始化；不要自动执行 `init`、`ingest-codex`、`codex-hook`，也不要手工创建事实目录。配置损坏或版本不支持时报告实际问题，不覆盖配置或重建历史。
4. **初始化例外仅适用于用户明确要求初始化 DomainAtlas**：确认目标 Git 根目录后执行 `init`，重新读取配置验证成功，再按用户已授权的范围继续。单纯“使用 DomainAtlas”不等于授权初始化。

## 如何使用

### 定位运行入口

使用现有 Node.js、pnpm 和 DomainAtlas 构建产物。源码仓库的 `package.json` 固定 pnpm 版本；需要构建时在工具仓库执行 `pnpm build`，不要在目标业务仓库安装 DomainAtlas 的依赖。运行环境缺失时说明缺失项，不自动全局安装。

技能随源码位于 `skills/domainatlas/` 时，可检查其上两级是否为工具仓库；技能复制到其他位置后应重新定位实际 CLI，不将技能目录当作目标项目。以下命令中的 `ATLAS_CLI` 需替换为已经核实的 `dist/src/cli.js` 绝对路径：

```sh
# 工作目录：被记录的目标 Git 仓库根目录
ATLAS_CLI="/absolute/path/to/DomainAtlas/dist/src/cli.js"
node "$ATLAS_CLI" list
```

在 DomainAtlas 工具仓库自身操作时，也可用 `pnpm domainatlas <命令>`。若宿主要求 RTK，使用 `rtk proxy node ...` 或 `rtk pnpm ...` 执行对应命令。

### 按用户请求选择操作

所有数据操作都先执行上面的显式使用与初始化检查；`init` 仅走初始化例外。

| 用户请求 | CLI 命令 | 行为 |
| --- | --- | --- |
| 查看业务变更与 Git 状态 | `node "$ATLAS_CLI" list` | 查询记录及 pending/committed 投影 |
| 查看业务地图、时间线和证据 | `node "$ATLAS_CLI" ui` | 启动只读本地 Web UI，默认 `http://127.0.0.1:4310`；可用 `--port 4311` 换端口 |
| 记录本次业务变更 | `node "$ATLAS_CLI" ingest-codex ...` | 追加需求、摘要、变更路径及已核实的测试证据 |
| 预览与已暂存代码匹配的记录 | `node "$ATLAS_CLI" stage-records` | 仅预览，不改变暂存区 |
| 将匹配业务记录加入暂存区 | `node "$ATLAS_CLI" stage-records --write` | 用户请求包含暂存时才执行；不会替代 Git 提交或推送 |
| 明确初始化目标项目 | `node "$ATLAS_CLI" init` | 创建目标项目的事实配置；不会顺带启用自动钩子 |

记录示例（将需求、摘要和路径替换为本次真实信息）：

```sh
node "$ATLAS_CLI" ingest-codex \
  --request "增加退款审核" \
  --summary "完成退款审核接口" \
  --changed-file src/billing/refund.ts
```

- 每个实际变更路径单独使用一次 `--changed-file`，路径相对目标项目根目录；不要把工作区其他任务的修改归入本次记录。
- 仅在有真实执行证据时附加 `--test-command` 与 `--test-status passed|failed|not-run`。未掌握测试结果时省略，不能从助手回复中的“测试通过”推断证据。
- 写入前检查是否已有同一任务的记录，尤其是已启用 Hooks 的项目；已自动记录时不要再手工重复录入。
- 纠正使用 `--kind correction --supersedes <已有记录ID>`，回退事实使用 `--kind revert --supersedes <已有记录ID>`，并提供真实需求与摘要。验证引用存在，保留原记录；`revert` 记录不等于执行 `git revert`。
- commit SHA 由 Git 历史投影，不手写回事实文件。部分暂存、缺少文件版本证据或多任务合并可能无法匹配，按 CLI 返回原因报告，不伪造匹配或强制暂存全部 `.domainatlas/`。

## 自动化与能力边界

- 本技能的 `agents/openai.yaml` 设置 `allow_implicit_invocation: false`；已初始化也不允许隐式调用。
- 全局 Hooks 独立运行：有效 `.domainatlas/config.json` 是项目自动记录的启用标志。已初始化项目普通对话自动记录；未初始化、非 Git 目录静默跳过，不创建配置或任务快照。初始化在某一轮中途完成时，从下一轮开始记录，不补造本轮开始快照。
- 用户明确要求全局安装时，在工具仓库构建后执行 `pnpm domainatlas init -g --codex` 完成已授权安装；该命令直接执行，无需 `--write`。仅预览时追加 `--dry-run`，完整选项见 `init --help`，`-g` 等价于 `--global`。默认使用 `$CODEX_HOME/hooks.json`，未设置时为 `~/.codex/hooks.json`；可用 `--codex-home PATH` 指定配置目录。全局安装不初始化当前项目；普通 `init` 仍用于项目初始化。安装保留其他钩子、备份旧文件，重复安装不新增副本。
- 用户明确要求卸载时使用 `pnpm domainatlas init -g --codex --uninstall`，追加 `--dry-run` 可预览；仅移除安装器管理的全局钩子，项目本地钩子独立存在。全局命令引用 Node 与工具 CLI 的绝对路径，工具移动或 Node 路径变化后需重新安装。
- 新增或修改的钩子需用户在 Codex CLI `/hooks` 审阅并信任。安装器不修改信任状态。全局与项目钩子会同时执行，当前 `codex-hook --global` 按 session/turn 去重；旧版不带 `--global` 的本地钩子仍可能无条件记录，按用户授权更新或禁用，不能声称全局过滤器会拦截其他钩子。
- 不顺带安装技能、修改 MCP 配置或启用 Git pre-commit。技能调用策略不能关闭已启用的 Hooks；明确区分“仅显式使用技能”与“已初始化项目自动记录”。
- DomainAtlas 当前通过 CLI 使用 `codebase-memory-mcp` 的结构化索引；图谱不可用时按实现降级为低置信度事实，不全量扫描源码补齐业务语义，不把一般错误当作降级成功。
- 当前 DomainAtlas 自身尚未提供 MCP transport；不要虚构 MCP 工具名、服务地址或启动命令。Web UI 为只读入口。
- 完成后简要报告执行的操作、记录 ID 或访问地址，以及真实验证结果。保留未提交、已提交和已推送之间的区别。
