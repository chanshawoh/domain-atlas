# MVP architecture

The first vertical slice follows this flow:

    Codex UserPromptSubmit -> Git working-tree snapshot in Git-private state
    Codex Stop -> incremental file versions + request + final message
      -> Codex task-completed event
      -> CodexAdapter
      -> ChangeRecorder
      -> CodeGraphProviderChain
           -> codebase-memory-mcp CLI structured provider when indexed
           -> incremental changed-path fallback when unavailable
      -> FileDomainModelStore (.domainatlas)
      -> GitObserver projection (pending or committed)
      -> stage-records preview -> optional selective staging -> Git commit

## Invariants

1. A real first task is recorded immediately; task count is never an enablement gate.
2. Change files are immutable. Corrections and reversals are new records with supersedes links.
3. Stored records omit commit SHA. Git history supplies the first commit containing the record.
4. Business structure is limited to domain and capability in the MVP.
5. The fallback provider consumes only incremental changed paths and marks its nodes low confidence.
6. Provider failure is not silently ignored. Fallback occurs only for an explicit unavailable condition.
7. .domainatlas is the fact source. Any local database or UI projection must remain rebuildable.
8. A correction/revert must reference an existing record before any new facts are written.
9. Automatic staging requires the entire recorded file-version transition to match HEAD and the index. Path overlap alone is insufficient.
10. Repeated hook delivery uses a stable session/turn ID; JSON files are atomically published without replacement.

## Discovery budgets

Both providers cap emitted domains plus capabilities with `maxNodes`, retaining complete domain/capability pairs. `maxTokens` uses UTF-8 bytes as a conservative token upper bound over serialized domain/capability data. Zero emits no business nodes. Invalid limits fail explicitly.

The CLI provider additionally limits cumulative architecture/search response bytes to `maxTokens`, stops querying on exhaustion, and restricts changed-file queries with `maxSnippetReads` (the legacy name; no source snippets are read). Routing-only `list_projects` metadata has a separate 128 KiB response cap and is never included in model context. Each subprocess has a 15-second timeout. Discovery marked `budgetLimited` is recorded with `(budget-limited)` evidence; a budget limit never triggers fallback. Missing executables or an unindexed project permit fallback; malformed responses and other process failures surface.

Queries request only architecture packages and bounded symbol results scoped by `--file-pattern`. The verified CLI takes a path pattern here, not an anchored regular expression. Results are additionally checked for exact file-path equality.

## Next verified integration points

- Add an MCP transport for codebase-memory-mcp behind the existing provider interface.
- Activate and accept the supplied hooks in a trusted live Codex session, then verify automatic prompt/Stop delivery.
- Extend staged matching to safely compose multiple sequential turns if needed; current matching requires each complete record transition independently.
- Build the graph and timeline projection from the immutable files.
