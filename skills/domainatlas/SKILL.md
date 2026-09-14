---
name: domainatlas
description: Build an initial business map of an existing Git project with DomainAtlas, including natural-language requests such as 构建这个项目的业务图 or 梳理已有业务能力. Also inspect, record, or correct DomainAtlas changes, check or upgrade the CLI, and manage its host hooks when requested. Do not trigger for ordinary coding, commits, or unrelated code graph queries.
---

# DomainAtlas

Use the DomainAtlas CLI to work with Git-tracked business change facts while preserving provenance, confidence, and append-only history.

## When to Use

- The user asks to build an existing project business map or analyze its business capabilities for DomainAtlas. Follow the baseline workflow below.
- The user explicitly asks to "use DomainAtlas to inspect this project's changes," "use DomainAtlas to record this requirement," "use DomainAtlas to correct this record," or "open the DomainAtlas business map."
- The user explicitly invokes `$domainatlas` with a clear operation. If no operation is specified, clarify whether to inspect or record; do not write by default.
- The user explicitly asks to "initialize DomainAtlas for this project": follow the initialization procedure below.
- The user explicitly requests global installation or removal of DomainAtlas host hooks (Codex or Cursor): follow the global hook procedure. This operation does not require the current directory to be an initialized project.
- The user explicitly asks to check the DomainAtlas version: run `-v`. This does not require an initialized project.
- The user explicitly asks for DomainAtlas install status or hook problems: run `status`. This does not require an initialized project and does not write files.
- The user explicitly asks to repair DomainAtlas hooks or fix a broken install: run `doctor`. This does not require an initialized project and does not authorize first-time hook installation or a package upgrade.
- The user explicitly asks to upgrade DomainAtlas or refresh already-installed host hooks: follow the upgrade procedure. This does not require an initialized project and does not authorize first-time hook installation.

Do not trigger for ordinary coding, fixes, tests, reviews, or commits; the mere presence of `.domainatlas/`, this skill, a graph index, or an installed CLI; or discussion of DomainAtlas, changes to its source, or documentation work. Without a business-map construction request or an explicit instruction to use DomainAtlas, do not proactively check initialization, read business records, execute the CLI, upgrade the package, or record the current task as an extra action.

Explicit authorization covers only the project, operation, and scope the user specifies. A request to inspect does not authorize agent-initiated writes. Skill invocation and automatic recording are independent: once global hooks are installed and trusted, initialized projects record each turn automatically without a prefix. A request to "record this change" does not authorize global hook installation.

## Preflight Checks

Opening the shared UI, checking the CLI version, inspecting install health, repairing host hooks, and upgrading the published package are global operations: `domainatlas ui`, `domainatlas -v`, `domainatlas status`, `domainatlas doctor`, and `domainatlas upgrade` work outside Git and do not require the current directory to be initialized. Apply the following target-project checks to build/record/correct operations; do not block these global commands or the project list because the current directory is uninitialized.

1. Confirm the Git repository root in the user's target directory, and use that root as the working directory for subsequent data operations. Distinguish the **DomainAtlas tool repository** from the **target repository being recorded**. Initialization of the tool repository does not imply initialization of the target repository.
2. Read the target root's `.domainatlas/config.json` without modifying it. The current format must be valid JSON containing `schemaVersion: 1` and `storage: "immutable-json-files"`. An empty `.domainatlas/` directory, a code graph index, or an installed tool does not establish initialization. A newly initialized project may have no change records; directories such as `changes/` need not exist yet.
3. If configuration is missing, stop target-project data operations and explain that the target project is not initialized. Do not automatically run `init`, `ingest`, `ingest-codex`, `upgrade`, `doctor`, `codex-hook`, or `cursor-hook`, or manually create the fact directory. If configuration is corrupt or its version is unsupported, report the actual issue without overwriting configuration or rebuilding history. Version, status, doctor, and upgrade requests are not target-project data operations.
4. **The initialization exception applies only when the user explicitly requests DomainAtlas initialization**: confirm the target Git root, run `init`, reread the configuration to verify success, and continue within the authorized scope. Merely asking to "use DomainAtlas" does not authorize initialization.

## How to Use

### Locate the CLI Entry Point

Prefer an installed `domainatlas` CLI after checking `domainatlas -v`; substitute `domainatlas` for `node "$ATLAS_CLI"` below. Otherwise use existing Node.js, pnpm, and DomainAtlas build artifacts. The source repository's `package.json` pins the pnpm version. If a build is needed, run `pnpm build` in the tool repository; do not install DomainAtlas dependencies in the target business repository. If runtime requirements are missing, report them without automatically installing or upgrading anything globally.

When the skill resides at `skills/domainatlas/` within the source tree, check whether the directory two levels above it is the tool repository. If the skill has been copied elsewhere, locate the actual CLI again; do not treat the skill directory as the target project. Replace `ATLAS_CLI` below with the verified absolute path to `dist/src/cli.js`:

```sh
# Working directory: the root of the target Git repository being recorded
ATLAS_CLI="/absolute/path/to/DomainAtlas/dist/src/cli.js"
node "$ATLAS_CLI" list
```

When operating on the DomainAtlas tool repository itself, `pnpm domainatlas <command>` is also available. If the host requires RTK, use `rtk proxy node ...` or `rtk pnpm ...` for the corresponding commands.

### Select the Operation Requested by the User

Apply the requested-scope and initialization checks above to target-project data operations. Shared UI launch, `-v`, `status`, `doctor`, and `upgrade` do not require initialization. Run `init` only under the initialization exception. Run `upgrade` only when the user explicitly asks to upgrade DomainAtlas or refresh already-installed hosts. Run `doctor` only when they ask to repair the install.

| User request | CLI command | Behavior |
| --- | --- | --- |
| Inspect business changes and Git status | `node "$ATLAS_CLI" list` | Query records and their pending/committed projections |
| View the business map, timeline, and evidence | `node "$ATLAS_CLI" ui` | Start the shared project list at `http://127.0.0.1:4310` from any directory; select a project to view its map and history. Use `--port 4311` to change the port |
| Record the current business change | `node "$ATLAS_CLI" ingest --host HOST ...` | Append the request, summary, changed paths, and verified test evidence. `ingest-codex` remains an alias for `--host codex` |
| Preview records matching staged code | `node "$ATLAS_CLI" stage-records` | Preview only; leave the index unchanged |
| Stage matching business records | `node "$ATLAS_CLI" stage-records --write` | Run only when the user's request includes staging; this does not replace a Git commit or push |
| Explicitly initialize the target project | `node "$ATLAS_CLI" init` | Create the target Git root's fact configuration and register it in the user-level project directory, without enabling automatic hooks |
| Check the DomainAtlas CLI version | `node "$ATLAS_CLI" -v` | Print the installed package version. `--version` and `version` are aliases. Does not change hooks or initialize a project |
| Inspect DomainAtlas install health | `node "$ATLAS_CLI" status` | Report CLI install, Codex/Cursor hook launchers, and current-project init. Does not write files |
| Repair DomainAtlas host hooks | `node "$ATLAS_CLI" doctor` | Rewrite already-installed host launchers and hook entries, and remove leftover launchers. Add `--dry-run` to preview. Does not initialize a project, install first-time host hooks, or download npm packages |
| Upgrade DomainAtlas and installed hosts | `node "$ATLAS_CLI" upgrade` | For an npm-installed CLI, install the latest published package, then refresh already-installed Codex and/or Cursor hooks. A source CLI skips the npm download and only refreshes hooks to that build. Add `--dry-run` to preview. `--codex-home` / `--cursor-home` override host config directories. Does not initialize the current project or install hooks for hosts that were never configured |

Recording example (replace the request, summary, and path with actual information from this task):

```sh
node "$ATLAS_CLI" ingest --host cursor \
  --request "Add refund review" \
  --summary "Implemented the refund review endpoint" \
  --changed-file src/billing/refund.ts
```

- Supply a separate `--changed-file` for each actual changed path, relative to the target project root. Do not attribute changes from other workspace tasks to this record.
- Include `--test-command` and `--test-status passed|failed|not-run` only when supported by actual execution evidence. Omit them when test results are unknown; do not infer evidence from an assistant response claiming that tests passed.
- Before writing, check whether a record already exists for the same task, especially in projects with hooks enabled. Do not manually duplicate an automatically created record.
- Use `--kind correction --supersedes <existing-record-ID>` for corrections and `--kind revert --supersedes <existing-record-ID>` for reversal facts, with an accurate request and summary. Verify that the referenced record exists and preserve it. A `revert` record does not execute `git revert`.
- Derive commit SHAs from Git history; do not manually write them into fact files. Partial staging, missing file-version evidence, or combined changes from multiple tasks may prevent matching. Report the reason returned by the CLI; do not fabricate a match or force-stage all of `.domainatlas/`.

## Version and Upgrade

These commands do not require an initialized project and do not write business facts.

When the user asks for the DomainAtlas version, run `domainatlas -v` (or `node "$ATLAS_CLI" -v`). Report the printed version. Do not initialize a project, install hooks, or query npm.

When the user asks whether DomainAtlas is installed correctly or why hooks are failing, run `domainatlas status`. Report the CLI install, each host, and any issues. Do not write files.

When the user explicitly asks to repair DomainAtlas hooks or fix a broken install, run `domainatlas doctor`. Add `--dry-run` only when they asked to preview. This rewrites already-installed host launchers and hook entries and removes leftover launchers. It does not initialize a project, install first-time host hooks, or run `npm install`. After repair, report what changed and any skipped unreadable configurations.

When the user explicitly asks to upgrade DomainAtlas or refresh already-installed host hooks, run `domainatlas upgrade`. Add `--dry-run` only when they asked to preview. Do not treat a version check, documentation work, or the existence of a newer release as authorization to upgrade.

- An npm-installed CLI (`node_modules/domainatlas`) queries the latest stable published version and, when newer, runs `npm install -g domainatlas@<latest>` before rewriting hooks to that package.
- A source checkout skips the npm download and only rewrites already-installed host hooks to the current build.
- Only Codex and/or Cursor hooks that already contain DomainAtlas global handlers are refreshed. Hosts that were never configured are left alone. This command does not install first-time hooks; use `init -g --codex` or `init -g --cursor` under the global hook procedure.
- Use `--codex-home` or `--cursor-home` only when the user specified those directories. Defaults follow `$CODEX_HOME` / `$CURSOR_HOME`, or `~/.codex` / `~/.cursor`.
- Report the CLI's summary: whether the package was upgraded, skipped, or already latest, and which hosts were refreshed or absent. Do not claim that copied skills, MCP config, or hook trust were updated.

## Shared Project Workbench

`domainatlas ui` starts one local port for all registered projects. `init` registers Git roots in `DOMAINATLAS_HOME/projects` (default `~/.domainatlas/projects`); project facts remain in each repository. The registry records paths only and is independent of global host hooks.

For projects initialized by older versions, run `domainatlas ui --scan /confirmed/project/parent` to discover and register existing initialized repositories. Multiple `--scan` roots are supported. Restrict scanning to user-specified directories; no whole-machine search is needed. Alternatively, rerun `domainatlas init` in a confirmed project or start `ui` there to register it. Scanning never initializes uninitialized projects or changes their business facts. Report scan warnings and directory-limit notices.

Newly registered projects appear after refreshing the project list without restarting the server. Select a project to view its map, baseline and history; use “全部项目” to return. Moved/deleted projects remain listed as unavailable; reinitialize at the new location to register it. Registry IDs identify canonical paths, not business fact IDs. Do not treat an unavailable old path as permission to delete project data.

## Content Language

Generate business names, descriptions, summaries, and evidence explanations in the user's current conversation language, unless the user explicitly requests another language. Preserve original requests, quotations, code identifiers, and paths. Follow this language preference directly; do not add language detection validation or reject mixed-language inputs. The Web UI language is a separate display preference and does not translate stored facts.

## Build an Existing Project Business Map

A request such as “用 DomainAtlas 构建这个项目已有业务的业务图” authorizes this workflow. Apply the target-root and initialization checks first. A baseline describes current code; it does not reconstruct past requirements, authorship, or historical changes.

1. Check that codebase-memory graph tools are available and the confirmed target root has a ready, current index. Index or refresh the target root if the tools are available. If tools are unavailable or the index cannot be made ready, stop before generating or importing a baseline and explain which environment requirement needs to be completed. Bare `domainatlas build` is disabled; it does not fall back to paths or symbols.
2. Use the graph to identify modules, entrypoints and call relationships, then read relevant documentation and bounded source snippets to explain business responsibilities. A ready code graph alone does not establish business semantics. Do not turn technical class names, enums, configuration or infrastructure into business capabilities. If evidence cannot support the requested business map, stop and identify the missing evidence instead of constructing a speculative map. Cover the user's requested scope; do not equate a sampled module with the entire project.
3. Write a temporary JSON manifest using the shape below. Names should describe business responsibilities in the user's language, not just class names. Each domain and capability needs at least one tracked project-relative file and a concrete reason it supports that node. Do not include weak inference just to populate the map; high confidence needs direct implementation evidence. The CLI verifies file existence and captures content hashes; semantic correctness remains the AI's responsibility.
4. Run `domainatlas build --input /absolute/path/to/baseline.json`. The CLI validates the entire manifest before writing one immutable baseline. It creates IDs, records the current HEAD and evidence hashes, and rejects unsupported fields, duplicate names or invalid file paths. Do not use `ingest` to pretend a baseline is a completed development task.
5. Open or refresh `domainatlas ui` when requested and report domains, capabilities, limited scope and verification. `domainatlas list` lists changes only, so it may remain empty after a successful baseline build. Keep commits, pushes, hooks and package installation within the user's requested scope.

Example manifest (replace every name, file and reason with actual findings):

```json
{
  "schemaVersion": 1,
  "domains": [{
    "name": "订单管理",
    "confidence": "medium",
    "evidence": [{ "file": "src/orders/order.ts", "reason": "实现订单生命周期管理" }],
    "capabilities": [{
      "name": "退款审核",
      "confidence": "medium",
      "evidence": [{ "file": "src/orders/refund.ts", "reason": "校验退款申请并执行审核状态转换" }]
    }]
  }]
}
```

Baselines are stored separately in `.domainatlas/baselines/`. Identical builds are idempotent; changed builds append snapshots. The UI uses the newest baseline plus incremental facts, retaining earlier snapshots and all change records. Each input replaces the projected baseline, so include the full intended baseline scope rather than a one-capability patch. Baselines cannot prove historical evolution; Git-history backfill is not implemented.

## Automation and Capability Boundaries

- This skill supports natural-language selection for business-map construction. Selection alone does not authorize unrelated operations.
- Global hooks run independently: a valid `.domainatlas/config.json` enables automatic recording for a project. Ordinary conversation turns in initialized projects are recorded automatically. Uninitialized projects and non-Git directories are silently skipped without creating configuration or task snapshots. If initialization completes midway through a turn, recording begins with the next turn; do not fabricate a start snapshot for the current turn.
- When the user explicitly requests global installation, build in the tool repository and run `pnpm domainatlas init -g --codex` or `pnpm domainatlas init -g --cursor` for the requested host. These commands act directly and do not require `--write`. Add `--dry-run` for preview only; see `init --help` for all options. `-g` is equivalent to `--global`. Codex defaults to `$CODEX_HOME/hooks.json` or `~/.codex/hooks.json`; Cursor defaults to `$CURSOR_HOME/hooks.json` or `~/.cursor/hooks.json`. Use `--codex-home` or `--cursor-home` to override. Global installation does not initialize the current project; plain `init` still handles project initialization. Installation writes a short `domainatlas-hook` launcher in the host home and points hook commands at that script; the launcher pins Node and the CLI so hosts do not need nvm on `PATH`. Installation preserves other hooks, backs up the previous file, and does not add duplicates on repeated runs. User-level Cursor hooks do not run in Cloud Agents.
- When the user explicitly requests removal, use `pnpm domainatlas init -g --codex --uninstall` or `pnpm domainatlas init -g --cursor --uninstall`; add `--dry-run` to preview. This removes only the global hooks managed by the installer; project-local hooks exist independently. Hook commands call `domainatlas-hook` in the host home; that launcher pins Node and the CLI. After an npm upgrade or a moved Node/CLI path, run `domainatlas upgrade` to refresh already-installed hosts; it does not install hooks for hosts that were never configured.
- New or modified hooks require user review: Codex CLI `/hooks`, or Cursor Settings → Hooks. The installer does not change trust state. Global and project hooks both execute; `codex-hook --global` and `cursor-hook --global` deduplicate by session/turn. Older local Codex hooks without `--global` may still record unconditionally. Update or disable them within the user's authorization; do not claim the global filter intercepts other hooks.
- Do not additionally install skills, modify MCP configuration, or enable Git pre-commit hooks. Skill invocation policy cannot disable enabled hooks. Distinguish user-requested skill operations from automatic recording for initialized projects.
- DomainAtlas currently accesses the structured index of `codebase-memory-mcp` through the CLI. For incremental recording only, when the graph is unavailable, follow the implementation's fallback to low-confidence facts. Never use that fallback for baseline construction. For incremental recording, do not scan the full source tree to fill in business semantics. Baseline analysis uses the dedicated workflow above. Do not treat general errors as successful fallback.
- DomainAtlas itself does not currently provide an MCP transport. Do not invent MCP tool names, service addresses, or startup commands. The Web UI is read-only.
- After completion, briefly report the operation performed, record ID or access URL, and actual verification results. Preserve the distinction between uncommitted, committed, and pushed states.
