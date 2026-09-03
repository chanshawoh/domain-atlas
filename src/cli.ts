#!/usr/bin/env node
import process from "node:process";
import type { ChangeKind, TestStatus } from "./core/model.js";
import { GitObserver } from "./git/git-observer.js";
import { createDomainAtlasRuntime } from "./runtime.js";

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
    "  domainatlas ingest-codex --request TEXT --summary TEXT [--task-id ID] [--kind KIND --supersedes ID] [--changed-file PATH]... [--test-command COMMAND --test-status STATUS]",
    "  domainatlas list",
  ].join("\n");
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  const projectRoot = process.cwd();
  const runtime = createDomainAtlasRuntime(projectRoot);

  if (command === "init") {
    await runtime.store.initialize();
    process.stdout.write("Initialized .domainatlas in " + projectRoot + "\n");
    return;
  }

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
