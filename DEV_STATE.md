# 开发状态

截至 2026-08-20，DomainAtlas 已从空仓库进入首个可执行垂直切片。当前实现使用 Node.js 22、TypeScript 和 pnpm，代码按逻辑边界组织在单包内，尚未为了形式上的完整度提前拆成多包。

## 已实现

- CodexAdapter：接收逻辑上的任务完成事件，不虚构尚未验证的 Codex Hook API。
- ChangeRecorder：从第一次任务开始生成带需求、变更文件、测试结果、来源和受影响能力的不可变记录。
- CodeGraphProvider：独立图谱边界与 Provider 链。
- CodebaseMemoryCliProvider：调用本机已验证的 codebase-memory-mcp 0.9.0 CLI 结构化索引；显式关闭子进程标准输入并设置 15 秒超时，避免任务完成流程被挂起。
- IncrementalFallbackCodeGraphProvider：主 Provider 不可用时，仅依据增量变更路径生成低置信度的“业务域 → 业务能力”两级节点。
- FileDomainModelStore：以 .domainatlas/ 下的独立 JSON 文件作为 Git 跟踪的追加式事实源。
- GitObserver：不把 commit SHA 写回记录文件，而是从 Git 历史推导首次包含记录的 commit；无 commit 时投影为 pending。
- CLI：支持 init、ingest-codex、list，以及 correction/revert 的 supersedes 参数。

## 已验证

- pnpm test 通过 4 个测试，覆盖第一次任务立即记录、Git commit 后转为 committed、追加式 correction、非 Git 仓库报错、Provider 不可用降级和真实 Provider 缺陷不被隐藏。
- codebase-memory-mcp 已重新索引本仓库；最后一次实施中返回 183 个节点、380 条边。
- 真实 Provider 调用约 1.3 秒返回结构化符号，示例包括 core → ChangeRecorder、git → GitObserver。
- 本次真实 Codex 任务已生成两条 pending 记录：原始 change 与一条 supersedes 原记录的 correction。原记录因非代码文件占用查询预算而只识别 CodexAdapter，系统保留原记录并追加纠正记录，没有覆盖历史。

## 当前边界

- main 分支仍无 commit，因此两条实际记录均为 pending；提交包含对应 .domainatlas/ 文件后，GitObserver 才会投影为 committed。
- 尚未接入经过验证的 Codex 生命周期 Hook，也未实现只暂存匹配记录的 pre-commit 集成。
- 尚未实现本地数据库投影、业务图谱与时间线 UI。
- 当前 codebase-memory-mcp 使用本机 CLI 传输；未来 MCP 传输应复用同一个 Provider 接口。

## 下一实施切片

验证 Codex 可用的生命周期扩展点，并实现“任务完成生成待固化记录 → 提交前只选择与 staged diff 匹配的 .domainatlas 记录 → Git 提交后投影为正式记录”的真实宿主闭环。
