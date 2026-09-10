# DomainAtlas

DomainAtlas is a local, append-only business change ledger for AI-assisted development. The MVP starts recording from the first completed Codex task, derives a two-level business map (domain to capability), and treats Git as the authority that turns a pending record into a committed record.

## Current executable slice

- CodexAdapter accepts explicit task events; `codex-hook` also consumes the documented Codex `UserPromptSubmit` and `Stop` events.
- Turn-start Git snapshots and turn-end file versions identify incremental changes. Duplicate completion events create one record.
- ChangeRecorder creates an evidence-backed immutable change record.
- New records separate development Git configuration, requirement requesters and feedback parties with original evidence; Git lifecycle exposes the actual commit author and committer. See [identity and requirement attribution](docs/attribution.md).
- CodebaseMemoryCliProvider uses the locally installed codebase-memory-mcp structured index without reading the full source tree.
- CodeGraphProviderChain prefers that structured provider and falls back only when it is unavailable.
- IncrementalFallbackCodeGraphProvider examines changed paths only and emits low-confidence domain and capability nodes.
- FileDomainModelStore writes the project fact source under .domainatlas/.
- GitObserver derives the first commit containing each record instead of writing a commit SHA into the record.
- `stage-records` previews matching records and their required facts; `--write` stages those paths only when the full recorded before/after versions match HEAD and the index.
- The read-only Web UI shows the domain/capability map, searchable change history, evidence, and Git lifecycle from the current project's real fact files.

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

Install hooks once for all Codex projects:

    pnpm domainatlas init -g --codex

Use `init -g --codex --dry-run` to preview, `init -g --codex --uninstall` to remove its global entries, and `init --help` for options. `-g` also accepts `--global`. Global setup does not initialize the current project; run plain `init` in each project you want recorded.

After reviewing and trusting the global hooks in Codex `/hooks`, initialized projects record every turn automatically; no prompt prefix is needed. Uninitialized projects and non-Git directories are skipped without creating files. The installer preserves other hooks and backs up the original configuration. The DomainAtlas skill remains explicit-only; automatic recording is independent of skill invocation.

Run the optional real graph CLI integration test (requires an installed `codebase-memory-mcp`):

    pnpm test:graph

## Web UI

Build and open the current project's workbench:

    pnpm build
    pnpm ui

Open http://127.0.0.1:4310. Use `pnpm ui --port 4311` to change the port.

For frontend development, keep `pnpm ui` running and run `pnpm dev:web` in a second terminal. Vite proxies `/api` to port 4310. To inspect another project, run `node /absolute/path/to/DomainAtlas/dist/src/cli.js ui` from that Git repository's root.

The UI uses React 19, TypeScript, Vite 7, Tailwind CSS 4 and Lucide; the local API uses Fastify 5. See [Web UI implementation and validation](docs/web-ui-development.md) for the design source, scope and limitations.

## Deliberate MVP boundary

The hook protocol, stdin CLI, Git pre-commit behavior, and real graph-provider ingest are tested in isolated repositories. Hook trust and activation remain environment-specific; see [the recorded local acceptance](docs/web-ui-product-brief.md). File versions describe changes observed during a turn; they do not prove authorship when multiple actors edit the same worktree. Multi-turn combined diffs and partial staging are conservatively left unmatched. MCP transport, database projections, and Web write operations remain future work.
