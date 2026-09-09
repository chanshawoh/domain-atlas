# 开发状态

## 当前进展（2026-09-09 继续开发）

已完成文档所列下一阶段的本地实现：Codex 任务开始/结束记录、完整 staged diff 匹配、可选 pre-commit 选择性暂存、Provider 预算控制和纠正引用校验。保留了开发前已有的文档修改，原检查记录见下节。

- **宿主接口已核实并实现**：官方 [Codex Hooks](https://developers.openai.com/codex/hooks) 文档提供 `UserPromptSubmit` / `Stop` JSON stdin 协议；本机 `codex-cli 0.153.4` 的 hooks 为 stable / true。新增 `src/adapters/codex-hooks.ts` 和 `codex-hook` 命令，仓库提供 `.codex/hooks.json`。开始事件将请求和 Git 工作树快照保存在当前 worktree 的 Git 私有目录；结束事件按 session/turn 稳定 ID 追加记录，重复/并发投递不会产生重复记录。未解析 transcript，也未将回复中的“测试通过”当作执行证据。
- **暂存匹配与提交路径已实现**：`src/git/git-snapshot.ts` 保存文件前后 blob ID 与模式；记录增加可选 `fileChanges`，旧 JSON 保持可读。`src/git/stage-records.ts` / `stage-records` 默认只预览，`--write` 只暂存完整匹配 HEAD→index 的记录及域/能力/配置依赖。部分暂存、任务前同文件已有修改、缺少版本证据或前序纠正记录未能匹配时保留为未匹配；拒绝覆盖已提交/暂存后又被修改的事实文件。提供可执行 `.githooks/pre-commit`，尚未修改本工作仓库的 `core.hooksPath`。
- **预算与事实完整性已补齐**：两种 Provider 都执行节点总数和 `maxTokens` 限额，按 UTF-8 字节保守估算输出 token 上界；CLI 图谱响应另有累计字节限制，项目路由元数据单独限制为 128 KiB。查询超限停止，并记录 `budget-limited` 标记。`maxSnippetReads` 限制代码文件查询数量，不读取源码片段。修正 CLI `--file-pattern` 参数，限定路径并复核结果路径，避免同名文件误命中；一般进程错误和畸形响应上抛。correction/revert 在写入前校验 supersedes 目标存在。事实 JSON 改为原子、不覆盖发布。
- **验证已完成**：使用既有 Node.js 22.23.1 / pnpm 11.13.0；`rtk proxy env DOMAINATLAS_REAL_GRAPH=1 pnpm test` 构建及 **19/19 测试通过，0 跳过**。覆盖公开事件和 CLI stdin、并发去重、任务前已有修改、部分暂存、重命名/删除/模式/软链接/特殊路径、真实 Git pre-commit、提交后投影、纠正依赖、预算边界和真实 Provider ingest。真实图谱用例在临时 Git 仓库建索引并读取 Refund 类，结束后清理测试索引。`git diff --check` 通过；项目图谱刷新为 ready（323 节点、608 边）。

**尚待启用与验收**：按 `docs/codex-integration.md` 在 Codex `/hooks` 审阅并信任项目钩子，然后观察一次真实任务的自动开始/结束事件。本次已验证协议入口及隔离仓库闭环，尚未证明已信任的真实 Codex 会话自动派发；没有写入或绕过钩子信任状态。Git pre-commit 已在临时仓库实际触发并验证，工作仓库尚未启用。所有项目改动仍在本地，未暂存、未提交、未推送。

**下一步**：先完成上述实机激活验收，再推进可重建的查询和图谱/时间线投影。仍不包含多任务差异合成、自动测试结果采集、MCP 传输和数据库投影。工作树快照记录的是本轮期间观察到的变化，不能证明多人/多代理同时编辑同一 worktree 时的作者归属；任务缓存尚无自动清理策略。

## 本次开发前检查记录

截至 2026-09-09，DomainAtlas 的目标是从第一次 AI 开发任务起积累可追溯的业务变更事实；当前为 TypeScript/pnpm 单包 CLI MVP，已实现任务事件接收、需求/变更文件/测试结果记录、图谱优先发现、增量降级、追加式存储和 Git 生命周期投影，入口为 `src/cli.ts`（`init`、`ingest-codex`、`list`），组装位于 `src/runtime.ts`，核心文件为 `src/adapters/codex.ts`、`src/core/change-recorder.ts`、`src/code-graph/`、`src/storage/file-domain-model-store.ts` 和 `src/git/git-observer.ts`，架构约束见 `docs/mvp-architecture.md`。关键决策是以 Git 跟踪的 `.domainatlas/` JSON 为事实源，业务结构限于“域→能力”两级；通过 codebase-memory-mcp CLI 的结构化索引查询发现能力，不全量读取源码，仅在 Provider 缺失或显式不可用时按变更路径生成低置信度节点；变更记录不覆盖，correction/revert 用 supersedes 关联历史，commit SHA 由 Git 历史推导而不写回记录。本次检查前工作区干净，暂存及未暂存 diff 均为空，main 的 HEAD 与本地 origin/main 同为 `423a35e`（初始化 DomainAtlas MVP；未联网核验远端）；`rtk pnpm domainatlas list` 确认现有原始和纠正两条记录均为 committed，绑定该提交。使用现有 Node.js 22.23.1、pnpm 11.13.0 执行 `rtk pnpm test`，TypeScript 构建及 4/4 测试通过，覆盖首任务立即记录、追加纠正、提交后状态转换、非 Git 目录拒绝、不可用降级及一般 Provider 缺陷上抛；图谱索引状态为 ready（183 节点、380 边），结构化查询和源码片段读取成功，但本次未重新执行真实 Provider 的完整 ingest，现有测试也未覆盖该 CLI Provider。已确认的历史失败是非代码文件占用查询预算导致首条记录影响范围过窄，现代码先过滤非代码及 tests/docs 路径再截取预算，原记录保留并已有追加纠正；CLI 子进程已关闭 stdin 并设置每次调用 15 秒超时。当前仍需主动传入任务事件，未实现真实 Codex 生命周期接入、staged diff 匹配与 pre-commit 选择性暂存、MCP 传输、数据库投影及图谱/时间线 UI；能力名仍主要来自包名、符号或路径，不能视为完整业务语义理解，maxTokens 目前仅声明未执行限额，supersedes 仅校验是否提供而未校验目标存在。下一步先验证可用的 Codex 生命周期扩展点，完成任务结束记录与 staged diff 匹配的宿主闭环，并补充真实 Provider、预算控制和纠正引用校验测试，再推进可重建的查询与 UI 投影；本次仅更新此状态文档。
