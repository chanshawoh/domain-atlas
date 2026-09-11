#!/usr/bin/env node
import process from "node:process";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { ChangeKind, TestStatus } from "./core/model.js";
import { GitObserver } from "./git/git-observer.js";
import { createDomainAtlasRuntime } from "./runtime.js";
import { handleCodexHook } from "./adapters/codex-hooks.js";
import { stageMatchingRecords } from "./git/stage-records.js";
import { configureCodexHooks } from "./adapters/codex-hook-install.js";
import { readFile } from "node:fs/promises";
import { buildBaseline } from "./core/build-baseline.js";
import { formatBuildSummary, startBuildProgress } from "./build-output.js";
import { discoverProjects, findGitRoot, registerProject } from "./storage/project-registry.js";

function values(args: string[], flag: string): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) {
      result.push(args[index + 1]);
      index += 1;
    }
  }
  return result;
}

function value(args: string[], flag: string): string | undefined {
  return values(args, flag)[0];
}

function required(args: string[], flag: string): string {
  const found = value(args, flag);
  if (!found) {
    throw new Error("Missing required argument: " + flag);
  }
  return found;
}

function usage(): string {
  return [
    "Usage:",
    "  domainatlas init",
    "  domainatlas init -g --codex [--dry-run] [--uninstall] [--codex-home PATH]",
    "  domainatlas ingest-codex --request TEXT --summary TEXT [--task-id ID] [--kind KIND --supersedes ID] [--changed-file PATH]... [--test-command COMMAND --test-status STATUS]",
    "  domainatlas list",
    "  domainatlas build --input FILE [--dry-run] [--max-files 200] [--json]  (current business baseline)",
    "  domainatlas ui [--port 4310] [--scan PATH]...  (all initialized projects)",
    "  domainatlas codex-hook [--global]  (reads one Codex hook JSON object from stdin)",
    "  domainatlas stage-records [--write]  (preview by default)",
  ].join("\n");
}

function initUsage(): string {
  return [
    "Usage: domainatlas init [OPTIONS]",
    "",
    "Without options, initialize .domainatlas at the Git root and register it in the shared project directory.",
    "With -g --codex, install user-level Codex hooks without initializing the current project.",
    "",
    "  -g, --global       Configure user-level hooks (requires --codex)",
    "      --codex        Target Codex (requires --global)",
    "      --dry-run      Preview global hook changes without writing files",
    "      --uninstall    Remove DomainAtlas global hooks, preserving other hooks and facts",
    "      --codex-home PATH  Override CODEX_HOME (default: ~/.codex when unset)",
    "  -h, --help         Show this help",
    "",
    "Examples:",
    "  domainatlas init",
    "  domainatlas init -g --codex",
    "  domainatlas init -g --codex --dry-run",
    "  domainatlas init -g --codex --uninstall",
  ].join("\n");
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (command === "--help" || command === "-h") {
    process.stdout.write(usage() + "\n");
    return;
  }
  if (command === "init") {
    const { values: options } = parseArgs({ args, allowPositionals: false, options: {
      global: { type: "boolean", short: "g" },
      codex: { type: "boolean" },
      "dry-run": { type: "boolean" },
      uninstall: { type: "boolean" },
      "codex-home": { type: "string" },
      help: { type: "boolean", short: "h" },
    } });
    if (options.help) {
      process.stdout.write(initUsage() + "\n");
      return;
    }
    if (args.length) {
      if (!options.global || !options.codex) {
        throw new Error("Global hook options require both --global (-g) and --codex. Use domainatlas init --help.");
      }
      if (options["codex-home"] !== undefined && !options["codex-home"].trim()) throw new Error("--codex-home must not be empty");
      const result = await configureCodexHooks({ cliPath: fileURLToPath(import.meta.url),
        codexHome: options["codex-home"], write: !options["dry-run"], remove: options.uninstall });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return;
    }
    const root = await findGitRoot(process.cwd());
    await createDomainAtlasRuntime(root ?? process.cwd()).store.initialize();
    if (root) await registerProject(root);
    process.stdout.write("Initialized .domainatlas in " + (root ?? process.cwd()) + "\n");
    return;
  }
  if (command === "ui") {
    const { values: options } = parseArgs({ args, allowPositionals: false, options: {
      port: { type: "string" }, scan: { type: "string", multiple: true }, help: { type: "boolean", short: "h" },
    } });
    if (options.help) {
      process.stdout.write("Usage: domainatlas ui [--port 4310] [--scan PATH]...\nStart one workbench for all registered projects, from any directory.\n--scan discovers previously initialized projects under PATH and registers them.\nProject registry: DOMAINATLAS_HOME/projects (default ~/.domainatlas/projects).\n");
      return;
    }
    const port = Number(options.port ?? 4310);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid --port");
    if (options.scan?.some(directory => !directory.trim())) throw new Error("--scan must not be empty");
    for (const directory of options.scan ?? []) {
      process.stdout.write(JSON.stringify(await discoverProjects(directory)) + "\n");
    }
    const { startWebServer } = await import("./web/server.js");
    await startWebServer(process.cwd(), port);
    return;
  }
  if (command === "build") {
    const { values: options } = parseArgs({ args, allowPositionals: false, options: {
      input: { type: "string" }, "dry-run": { type: "boolean" }, "max-files": { type: "string" }, json: { type: "boolean" }, help: { type: "boolean", short: "h" },
    } });
    if (options.help) {
      process.stdout.write("Usage: domainatlas build --input FILE [--dry-run] [--max-files 200] [--json]\nBuild the current business baseline from an AI-analyzed JSON manifest.\nRequires domainatlas init and --input. Automatic graph/path inference is disabled. Prepare codebase-memory-mcp and a ready project index, then use the DomainAtlas skill for business analysis. Writes an immutable baseline, not historical changes.\n--dry-run validates and previews without writing. --max-files: 1..2000 (default 200).\nShows progress on stderr and a completion summary on stdout. --json returns full JSON without progress.\nUse the bundled skills/domainatlas/SKILL.md for the input schema and skill workflow.\n");
      return;
    }
    const progress = options.json ? undefined : startBuildProgress(text => process.stderr.write(text));
    try {
      if (options.input !== undefined) progress?.update("读取业务分析文件");
      const result = await buildBaseline(process.cwd(), { dryRun: options["dry-run"],
        ...(options.input !== undefined ? { input: JSON.parse(await readFile(options.input, "utf8")) } : {}),
        ...(options["max-files"] !== undefined ? { maxFiles: Number(options["max-files"]) } : {}),
        onProgress: progress?.update,
      });
      progress?.stop();
      process.stdout.write(options.json ? JSON.stringify(result, null, 2) + "\n" : formatBuildSummary(result, !!options["dry-run"]));
    } finally {
      progress?.stop();
    }
    return;
  }
  if (command === "codex-hook") {
    if (args.length && (args.length !== 1 || args[0] !== "--global")) throw new Error("Usage: domainatlas codex-hook [--global]");
    let input = "";
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 1024 * 1024) throw new Error("Codex hook input exceeds 1 MiB");
    }
    process.stdout.write(JSON.stringify(await handleCodexHook(JSON.parse(input), undefined, args.includes("--global"))) + "\n");
    return;
  }
  if (command === "stage-records") {
    if (args.some((arg) => arg !== "--write")) throw new Error("Usage: domainatlas stage-records [--write]");
    process.stdout.write(JSON.stringify(await stageMatchingRecords(process.cwd(), args.includes("--write")), null, 2) + "\n");
    return;
  }
  const projectRoot = process.cwd();
  const runtime = createDomainAtlasRuntime(projectRoot);

  if (command === "ingest-codex") {
    const testCommand = value(args, "--test-command");
    const testStatus = value(args, "--test-status");
    const kind = value(args, "--kind");
    const allowedStatuses = new Set<TestStatus>(["passed", "failed", "not-run"]);
    const allowedKinds = new Set<ChangeKind>(["change", "correction", "revert"]);
    if (testStatus && !allowedStatuses.has(testStatus as TestStatus)) {
      throw new Error("Invalid --test-status: " + testStatus);
    }
    if (testStatus && !testCommand) {
      throw new Error("--test-status requires --test-command");
    }
    if (kind && !allowedKinds.has(kind as ChangeKind)) {
      throw new Error("Invalid --kind: " + kind);
    }
    const recorded = await runtime.adapter.handleTaskCompleted({
      request: required(args, "--request"),
      summary: required(args, "--summary"),
      changedFiles: values(args, "--changed-file"),
      ...(kind ? { kind: kind as ChangeKind } : {}),
      ...(value(args, "--supersedes") ? { supersedes: value(args, "--supersedes") } : {}),
      ...(testCommand
        ? { tests: [{ command: testCommand, status: (testStatus ?? "not-run") as TestStatus }] }
        : {}),
      ...(value(args, "--task-id") ? { taskId: value(args, "--task-id") } : {}),
    });
    process.stdout.write(JSON.stringify(recorded, null, 2) + "\n");
    return;
  }

  if (command === "list") {
    const observer = new GitObserver(projectRoot);
    const changes = await runtime.store.listChanges();
    const projected = await Promise.all(
      changes.map(async (change) => ({
        ...change.record,
        lifecycle: await observer.resolveRecordLifecycle(change.relativePath),
      })),
    );
    process.stdout.write(JSON.stringify(projected, null, 2) + "\n");
    return;
  }

  process.stderr.write(usage() + "\n");
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 1;
});
