# Codex 生命周期与 Git 暂存集成

2026-09-09 核实的官方接口见 [Codex Hooks](https://developers.openai.com/codex/hooks)。本机 `codex-cli 0.153.4` 的 `hooks` 功能为 `stable / true`。本实现使用公开的 JSON stdin 协议，不读取格式未稳定的 transcript。

## 运行方式

先执行 `pnpm build`。仓库已提供 `.codex/hooks.json`，其命令从 Git 根目录定位 `dist/src/cli.js`，因此支持从子目录启动 Codex。当前配置使用 `codex-hook --global` 的初始化检查；全局安装方法见下节。

## 全局安装：已初始化项目自动记录

在 DomainAtlas 工具仓库构建后运行：

```sh
pnpm domainatlas init -g --codex
```

命令形式参考 [RTK 的 `init -g --codex`](https://github.com/rtk-ai/rtk)，`-g` / `--global` 指定用户级范围，`--codex` 指定宿主。执行即安装，**无需 `--write`**；预览用 `pnpm domainatlas init -g --codex --dry-run`，帮助用 `pnpm domainatlas init --help`。普通 `pnpm domainatlas init` 仍只初始化当前项目。全局安装不会顺带初始化当前项目，也不要求从 Git 仓库执行。

配置目标优先 `$CODEX_HOME/hooks.json`，未设置时使用 `~/.codex/hooks.json`。可用 `--codex-home PATH` 指定其他 Codex 配置目录。安装器合并 `UserPromptSubmit` / `Stop`，保留其他钩子和配置，修改前备份原文件；重复安装不新增副本。输出中包含目标文件与备份路径。它不修改 Codex 信任状态，也不安装全局 npm 包。

命令固定为当前 Node 可执行文件与 DomainAtlas `dist/src/cli.js` 的绝对路径。目标项目无需复制 CLI 或 `.codex/hooks.json`，从子目录启动也会解析到目标 Git 根目录。工具仓库移动或 Node 版本路径删除后，需要重新构建并安装；当前实现生成 POSIX shell 命令，适用于 macOS/Linux。

安装后在 Codex CLI `/hooks` 审阅并信任新的全局命令，再开启一轮新任务。生效条件：

- **已初始化项目**：根目录存在有效 `.domainatlas/config.json`（`schemaVersion: 1`、`storage: "immutable-json-files"`），每轮自动保存开始快照并在结束时记录，**不需要提示词前缀或每轮调用技能**。
- **未初始化项目或非 Git 目录**：静默返回 `{}`，不创建事实目录或任务缓存，也不自动初始化。只有明确要求初始化时才运行目标项目的 `init`。
- **本轮中途初始化**：本轮没有开始快照，跳过本轮结束记录，从下一轮开始。
- **配置损坏或版本不支持**：不覆盖配置、不创建快照，开始事件返回跳过原因。
- **重复投递**：session/turn 稳定 ID 去重；两个使用 `--global` 的全局/本地钩子共享规则。已启用的旧版不带 `--global` 的本地钩子仍会独立执行，不能被全局配置覆盖，需单独更新或禁用。

`skills/domainatlas` 支持通过自然语言请求构建已有项目业务图，也可显式调用以查看、管理和手动操作。自动记录由 Hooks 完成，两者互不替代。

卸载安装器管理的全局钩子：

```sh
pnpm domainatlas init -g --codex --uninstall
```

卸载也可叠加 `--dry-run` 预览。卸载保留其他钩子、现有业务事实及项目本地钩子。仅安装全局钩子不等于启用 Git pre-commit，也不会自动暂存或提交记录。

## 生命周期协议

在 Codex CLI 中打开 `/hooks`，审阅并信任本项目的 `UserPromptSubmit` 与 `Stop` 命令。官方文档说明：新的或发生变化的非托管钩子在完成信任之前会被跳过；项目 `.codex/` 配置层也需受信任。未修改用户级配置，也未写入或绕过 Codex 的信任状态。

- `UserPromptSubmit`：使用 `session_id`、`turn_id`、`cwd`、`prompt` 保存开始快照。
- `Stop`：使用相同 session/turn 和 `last_assistant_message`，追加不可变记录。stdout 返回有效的钩子 JSON，不请求自动续跑。
- 重复完成事件：稳定 ID 去重，原子发布完整 JSON。原始记录不会被后续回复覆盖。
- 开始状态保存在当前 worktree 的 `git rev-parse --git-path domainatlas/turns` 目录下；该缓存不进入 Git。缓存含用户需求文本和文件版本，当前尚无自动清理策略。

快照读取 Git 文件元数据，仅对有差异和未忽略的未跟踪文件计算 Git blob ID；不将源码传入模型。开始时已经存在且本轮未改变的修改不会计入本轮。重命名表示为删除旧路径和新增路径；文件模式、软链接、删除和特殊字符路径均有覆盖。

缺少开始快照时，不带 `--global` 的旧入口返回明确提示，`--global` 入口静默跳过；均不补造推断。缺少必要字段或发生 Provider 错误时返回失败。没有文件变化的问答仍可记录需求和回复，但不自动暂存。测试结果默认为空；回复中的“测试通过”不是结构化执行证据。显式 `ingest-codex` 继续支持测试结果录入。

## Git pre-commit

先由开发者暂存本次要提交的代码，然后运行：

```sh
pnpm domainatlas stage-records
pnpm domainatlas stage-records --write
```

第一条只预览。第二条仅暂存匹配记录及其配置、能力、域依赖，保留其他暂存内容。匹配规则要求每个文件的 `before` 等于 HEAD、`after` 等于 index；历史记录没有版本证据、部分暂存、同一文件混入任务前的修改，或者多个任务合并后无法独立匹配时，均保留为未匹配记录。待提交纠正记录的前序记录必须已经提交，或同样被本次选择。已有事实文件被修改或部分暂存时拒绝覆盖。

仓库提供可执行的 `.githooks/pre-commit`。需要自动执行时，可将其中命令合入已有 Git 钩子；未使用其他 Git 钩子的仓库可配置：

```sh
git config --local core.hooksPath .githooks
```

本次开发没有为工作仓库执行这项配置。该 Git 钩子会执行暂存操作；Codex 的两个生命周期钩子仅创建记录。暂存匹配失败的记录会在 JSON 结果中列出原因，不会阻止无关代码提交；事实损坏或 Git 错误会使钩子失败。

## 验证与边界

- `pnpm test`：构建及回归测试，含公开钩子事件、CLI stdin、并发重复事件、追加纠正、文件版本、部分暂存、真实 Git pre-commit 与提交后的生命周期。
- `pnpm test:graph`：在临时仓库调用真实 `codebase-memory-mcp` 建索引、验证 ready、完成真实 Provider ingest，最后删除测试索引与临时仓库。普通测试默认跳过这一外部工具用例。
- 已验证入口协议与隔离仓库闭环；尚未在用户审阅信任后观察真实 Codex 自动派发。启用后应完成一次真实任务，再检查 `pnpm domainatlas list` 与暂存预览。
- 工作树快照说明“本轮期间观察到的变化”，不能区分同一工作树中同时编辑的其他人或代理；需要精确归属时使用独立 worktree。
- 任务中已经完成的 Git 提交先于 `Stop` 记录，记录仍按之后实际包含它的提交投影；不会虚构绑定到较早提交。
- 本阶段不包括自动测试结果采集、多任务差异合成、MCP 传输、数据库投影或图谱/时间线 UI。
