# MVP architecture

The first vertical slice follows this flow:

    Codex task-completed event
      -> CodexAdapter
      -> ChangeRecorder
      -> CodeGraphProviderChain
           -> codebase-memory-mcp CLI structured provider when indexed
           -> incremental changed-path fallback when unavailable
      -> FileDomainModelStore (.domainatlas)
      -> GitObserver projection (pending or committed)

## Invariants

1. A real first task is recorded immediately; task count is never an enablement gate.
2. Change files are immutable. Corrections and reversals are new records with supersedes links.
3. Stored records omit commit SHA. Git history supplies the first commit containing the record.
4. Business structure is limited to domain and capability in the MVP.
5. The fallback provider consumes only incremental changed paths and marks its nodes low confidence.
6. Provider failure is not silently ignored. Fallback occurs only for an explicit unavailable condition.
7. .domainatlas is the fact source. Any local database or UI projection must remain rebuildable.

## Next verified integration points

- Add an MCP transport for codebase-memory-mcp behind the existing provider interface.
- Connect Codex task completion and staged-diff evidence through a verified Codex extension surface.
- Add a pre-commit integration that stages only matching .domainatlas records.
- Build the graph and timeline projection from the immutable files.
