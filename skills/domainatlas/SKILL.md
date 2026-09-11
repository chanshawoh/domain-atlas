---
name: domainatlas
description: Use only when the user explicitly requests DomainAtlas (or invokes $domainatlas) to inspect, record, or correct business changes, view the business map, or manage global Codex hooks. Confirm project initialization before data operations; never create the fact directory automatically for an uninitialized project, and initialize only when explicitly requested. Do not trigger for ordinary development, Git commits, code graph queries, or name mentions alone. Installed global hooks independently record turns for initialized projects without invoking this skill each turn.
---

# DomainAtlas

Use the DomainAtlas CLI to work with Git-tracked business change facts while preserving provenance, confidence, and append-only history.

## When to Use

- The user explicitly asks to "use DomainAtlas to inspect this project's changes," "use DomainAtlas to record this requirement," "use DomainAtlas to correct this record," or "open the DomainAtlas business map."
- The user explicitly invokes `$domainatlas` with a clear operation. If no operation is specified, clarify whether to inspect or record; do not write by default.
- The user explicitly asks to "initialize DomainAtlas for this project": follow the initialization procedure below.
- The user explicitly requests global installation or removal of DomainAtlas Codex hooks: follow the global hook procedure. This operation does not require the current directory to be an initialized project.

Do not trigger for ordinary coding, fixes, tests, reviews, or commits; the mere presence of `.domainatlas/`, this skill, a graph index, or an installed CLI; or discussion of DomainAtlas, changes to its source, or documentation work. Without an explicit instruction to use DomainAtlas, do not proactively check initialization, read business records, execute the CLI, or record the current task as an extra action.

Explicit authorization covers only the project, operation, and scope the user specifies. A request to inspect does not authorize agent-initiated writes. Skill invocation and automatic recording are independent: once global hooks are installed and trusted, initialized projects record each turn automatically without a prefix. A request to "record this change" does not authorize global hook installation.

## Preflight Checks

1. Confirm the Git repository root in the user's target directory, and use that root as the working directory for subsequent data operations. Distinguish the **DomainAtlas tool repository** from the **target repository being recorded**. Initialization of the tool repository does not imply initialization of the target repository.
2. Read the target root's `.domainatlas/config.json` without modifying it. The current format must be valid JSON containing `schemaVersion: 1` and `storage: "immutable-json-files"`. An empty `.domainatlas/` directory, a code graph index, or an installed tool does not establish initialization. A newly initialized project may have no change records; directories such as `changes/` need not exist yet.
3. If configuration is missing, stop DomainAtlas operations and explain that the target project is not initialized. Do not automatically run `init`, `ingest-codex`, or `codex-hook`, or manually create the fact directory. If configuration is corrupt or its version is unsupported, report the actual issue without overwriting configuration or rebuilding history.
4. **The initialization exception applies only when the user explicitly requests DomainAtlas initialization**: confirm the target Git root, run `init`, reread the configuration to verify success, and continue within the authorized scope. Merely asking to "use DomainAtlas" does not authorize initialization.

## How to Use

### Locate the CLI Entry Point

Use existing Node.js, pnpm, and DomainAtlas build artifacts. The source repository's `package.json` pins the pnpm version. If a build is needed, run `pnpm build` in the tool repository; do not install DomainAtlas dependencies in the target business repository. If runtime requirements are missing, report them without automatically installing anything globally.

When the skill resides at `skills/domainatlas/` within the source tree, check whether the directory two levels above it is the tool repository. If the skill has been copied elsewhere, locate the actual CLI again; do not treat the skill directory as the target project. Replace `ATLAS_CLI` below with the verified absolute path to `dist/src/cli.js`:

```sh
# Working directory: the root of the target Git repository being recorded
ATLAS_CLI="/absolute/path/to/DomainAtlas/dist/src/cli.js"
node "$ATLAS_CLI" list
```

When operating on the DomainAtlas tool repository itself, `pnpm domainatlas <command>` is also available. If the host requires RTK, use `rtk proxy node ...` or `rtk pnpm ...` for the corresponding commands.

### Select the Operation Requested by the User

Apply the explicit-use and initialization checks above before all data operations. Run `init` only under the initialization exception.

| User request | CLI command | Behavior |
| --- | --- | --- |
| Inspect business changes and Git status | `node "$ATLAS_CLI" list` | Query records and their pending/committed projections |
| View the business map, timeline, and evidence | `node "$ATLAS_CLI" ui` | Start the read-only local Web UI at `http://127.0.0.1:4310` by default; use `--port 4311` to change the port |
| Record the current business change | `node "$ATLAS_CLI" ingest-codex ...` | Append the request, summary, changed paths, and verified test evidence |
| Preview records matching staged code | `node "$ATLAS_CLI" stage-records` | Preview only; leave the index unchanged |
| Stage matching business records | `node "$ATLAS_CLI" stage-records --write` | Run only when the user's request includes staging; this does not replace a Git commit or push |
| Explicitly initialize the target project | `node "$ATLAS_CLI" init` | Create the target project's fact configuration without also enabling automatic hooks |

Recording example (replace the request, summary, and path with actual information from this task):

```sh
node "$ATLAS_CLI" ingest-codex \
  --request "Add refund review" \
  --summary "Implemented the refund review endpoint" \
  --changed-file src/billing/refund.ts
```

- Supply a separate `--changed-file` for each actual changed path, relative to the target project root. Do not attribute changes from other workspace tasks to this record.
- Include `--test-command` and `--test-status passed|failed|not-run` only when supported by actual execution evidence. Omit them when test results are unknown; do not infer evidence from an assistant response claiming that tests passed.
- Before writing, check whether a record already exists for the same task, especially in projects with hooks enabled. Do not manually duplicate an automatically created record.
- Use `--kind correction --supersedes <existing-record-ID>` for corrections and `--kind revert --supersedes <existing-record-ID>` for reversal facts, with an accurate request and summary. Verify that the referenced record exists and preserve it. A `revert` record does not execute `git revert`.
- Derive commit SHAs from Git history; do not manually write them into fact files. Partial staging, missing file-version evidence, or combined changes from multiple tasks may prevent matching. Report the reason returned by the CLI; do not fabricate a match or force-stage all of `.domainatlas/`.

## Automation and Capability Boundaries

- This skill's `agents/openai.yaml` sets `allow_implicit_invocation: false`. Initialization does not permit implicit invocation.
- Global hooks run independently: a valid `.domainatlas/config.json` enables automatic recording for a project. Ordinary conversation turns in initialized projects are recorded automatically. Uninitialized projects and non-Git directories are silently skipped without creating configuration or task snapshots. If initialization completes midway through a turn, recording begins with the next turn; do not fabricate a start snapshot for the current turn.
- When the user explicitly requests global installation, build in the tool repository and run `pnpm domainatlas init -g --codex` to complete the authorized installation. This command acts directly and does not require `--write`. Add `--dry-run` for preview only; see `init --help` for all options. `-g` is equivalent to `--global`. The default configuration path is `$CODEX_HOME/hooks.json`, or `~/.codex/hooks.json` when the variable is unset; use `--codex-home PATH` to specify a configuration directory. Global installation does not initialize the current project; plain `init` still handles project initialization. Installation preserves other hooks, backs up the previous file, and does not add duplicates on repeated runs.
- When the user explicitly requests removal, use `pnpm domainatlas init -g --codex --uninstall`; add `--dry-run` to preview. This removes only the global hooks managed by the installer; project-local hooks exist independently. Global commands reference absolute paths to Node and the tool CLI, so reinstall after moving the tool or changing the Node path.
- New or modified hooks require user review and trust in Codex CLI `/hooks`. The installer does not change trust state. Global and project hooks both execute; the current `codex-hook --global` deduplicates by session/turn. Older local hooks without `--global` may still record unconditionally. Update or disable them within the user's authorization; do not claim the global filter intercepts other hooks.
- Do not additionally install skills, modify MCP configuration, or enable Git pre-commit hooks. Skill invocation policy cannot disable enabled hooks. Distinguish "explicit-only skill use" from "automatic recording for initialized projects."
- DomainAtlas currently accesses the structured index of `codebase-memory-mcp` through the CLI. When the graph is unavailable, follow the implementation's fallback to low-confidence facts. Do not scan the full source tree to fill in business semantics or treat general errors as successful fallback.
- DomainAtlas itself does not currently provide an MCP transport. Do not invent MCP tool names, service addresses, or startup commands. The Web UI is read-only.
- After completion, briefly report the operation performed, record ID or access URL, and actual verification results. Preserve the distinction between uncommitted, committed, and pushed states.
