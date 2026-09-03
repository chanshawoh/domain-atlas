# DomainAtlas

DomainAtlas is a local, append-only business change ledger for AI-assisted development. The MVP starts recording from the first completed Codex task, derives a two-level business map (domain to capability), and treats Git as the authority that turns a pending record into a committed record.

## Current executable slice

- CodexAdapter accepts a host-level task-completed event without assuming an undocumented Codex hook API.
- ChangeRecorder creates an evidence-backed immutable change record.
- CodebaseMemoryCliProvider uses the locally installed codebase-memory-mcp structured index without reading the full source tree.
- CodeGraphProviderChain prefers that structured provider and falls back only when it is unavailable.
- IncrementalFallbackCodeGraphProvider examines changed paths only and emits low-confidence domain and capability nodes.
- FileDomainModelStore writes the project fact source under .domainatlas/.
- GitObserver derives the first commit containing each record instead of writing a commit SHA into the record.

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

## Deliberate MVP boundary

The repository does not yet claim a verified Codex lifecycle hook. The current codebase-memory-mcp adapter uses the verified local CLI contract; a future MCP transport can implement the same provider interface. The provider boundary, unavailable-provider fallback, immutable storage, and Git lifecycle are implemented and tested now.
