# DomainAtlas

DomainAtlas is a local, append-only business change ledger for AI-assisted development. The MVP starts recording from the first completed Codex task, derives a two-level business map (domain to capability), and treats Git as the authority that turns a pending record into a committed record.

## Current executable slice

- CodexAdapter accepts explicit task events; `codex-hook` also consumes the documented Codex `UserPromptSubmit` and `Stop` events.
- Turn-start Git snapshots and turn-end file versions identify incremental changes. Duplicate completion events create one record.
- ChangeRecorder creates an evidence-backed immutable change record.
- CodebaseMemoryCliProvider uses the locally installed codebase-memory-mcp structured index without reading the full source tree.
- CodeGraphProviderChain prefers that structured provider and falls back only when it is unavailable.
- IncrementalFallbackCodeGraphProvider examines changed paths only and emits low-confidence domain and capability nodes.
- FileDomainModelStore writes the project fact source under .domainatlas/.
- GitObserver derives the first commit containing each record instead of writing a commit SHA into the record.
- `stage-records` previews matching records and their required facts; `--write` stages those paths only when the full recorded before/after versions match HEAD and the index.

## Commands

Install and verify:

    pnpm install
    pnpm test

Initialize a project fact source:

    pnpm domainatlas init

The Codex host integration boundary can ingest a completed task event:

    pnpm domainatlas ingest-codex --request "Add refunds" --summary "Added refund review" --changed-file src/billing/refund.ts --test-command "pnpm test" --test-status passed

Corrections never overwrite an earlier record:

    pnpm domainatlas ingest-codex --kind correction --supersedes change_ID --request "Correct the affected scope" --summary "Added omitted capabilities" --changed-file src/billing/refund.ts

Inspect records with their Git-derived lifecycle:

    pnpm domainatlas list

Preview records that match the currently staged code, then stage their fact files:

    pnpm domainatlas stage-records
    pnpm domainatlas stage-records --write

For Codex hook activation and the optional Git pre-commit hook, see [Host integration](docs/codex-integration.md). Build with `pnpm build` before enabling hooks. This repository includes `.codex/hooks.json`; Codex requires review and trust through `/hooks` before those commands can run.

Run the optional real graph CLI integration test (requires an installed `codebase-memory-mcp`):

    pnpm test:graph

## Deliberate MVP boundary

The hook protocol, stdin CLI, Git pre-commit behavior, and real graph-provider ingest are tested in isolated repositories. Automatic delivery by a trusted live Codex session remains an activation acceptance step. File versions describe changes observed during a turn; they do not prove authorship when multiple actors edit the same worktree. Multi-turn combined diffs and partial staging are conservatively left unmatched. MCP transport, database projections, and the graph/timeline UI remain future work.
