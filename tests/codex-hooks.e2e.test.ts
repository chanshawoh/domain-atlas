import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile, chmod, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleCodexHook } from "../src/adapters/codex-hooks.js";
import { stageMatchingRecords } from "../src/git/stage-records.js";
import { git, snapshotChanges, worktreeSnapshot } from "../src/git/git-snapshot.js";
import { GitObserver } from "../src/git/git-observer.js";
import { createDomainAtlasRuntime } from "../src/runtime.js";

async function repository(t: { after: (fn: () => Promise<unknown>) => void }): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "domainatlas-hooks-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "DomainAtlas Test"]);
  await git(root, ["config", "user.email", "domainatlas@example.invalid"]);
  await git(root, ["config", "core.hooksPath", "/dev/null"]);
  await mkdir(path.join(root, "src"));
  return root;
}

function hook(root: string, event: string, turn = "turn-1") {
  return { cwd: root, session_id: "session-1", turn_id: turn, hook_event_name: event,
    prompt: "实现退款审核", last_assistant_message: "已实现退款审核，测试通过" };
}

test("first turn hooks record once, stage only matching facts, and become committed", async (t) => {
  const root = await repository(t);
  // Dirty files that already existed at task start must not be attributed to the task.
  await writeFile(path.join(root, "unrelated.txt"), "user work");
  await handleCodexHook(hook(path.join(root, "src"), "UserPromptSubmit"), null);
  await writeFile(path.join(root, "src/refund.ts"), "export const refund = true;\n");
  await handleCodexHook(hook(root, "Stop"), null);
  await Promise.all([handleCodexHook(hook(root, "Stop"), null), handleCodexHook(hook(root, "Stop"), null)]);
  const runtime = createDomainAtlasRuntime(root, null);
  const [change] = await runtime.store.listChanges();
  assert.equal((await runtime.store.listChanges()).length, 1);
  assert.deepEqual(change.record.changedFiles, ["src/refund.ts"]);
  assert.deepEqual(change.record.tests, [], "assistant prose is not test evidence");
  assert.equal(change.record.fileChanges?.[0].before, null);
  assert.deepEqual((await stageMatchingRecords(root)).records, []);
  await git(root, ["add", "--", "src/refund.ts"]);
  const manual = await runtime.adapter.handleTaskCompleted({ request: "其它任务", summary: "其它任务", changedFiles: ["unrelated.txt"] });
  const before = await git(root, ["diff", "--cached", "--raw"]);
  const preview = await stageMatchingRecords(root);
  assert.deepEqual(preview.records, [change.record.id]);
  assert.equal(preview.written, false);
  assert.equal(await git(root, ["diff", "--cached", "--raw"]), before);
  assert.ok(preview.paths.some((file) => file.startsWith(".domainatlas/domains/")));
  assert.ok(!preview.paths.includes(manual.relativePath));
  await stageMatchingRecords(root, true);
  const staged = (await git(root, ["diff", "--cached", "--name-only", "-z"])).split("\0");
  assert.ok(!staged.includes("unrelated.txt"));
  assert.ok(!staged.includes(manual.relativePath));
  await git(root, ["commit", "-m", "记录退款审核"]);
  assert.equal((await new GitObserver(root).resolveRecordLifecycle(change.relativePath)).state, "committed");
  assert.equal((await new GitObserver(root).resolveRecordLifecycle(manual.relativePath)).state, "pending");
});

test("partial staging and pre-existing edits in the same file do not match", async (t) => {
  const root = await repository(t);
  const file = path.join(root, "src/refund.ts");
  await writeFile(file, "base\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "初始文件"]);
  await handleCodexHook(hook(root, "UserPromptSubmit"), null);
  await writeFile(file, "partial\n");
  await git(root, ["add", "src/refund.ts"]);
  await writeFile(file, "complete\n");
  await handleCodexHook(hook(root, "Stop"), null);
  assert.deepEqual((await stageMatchingRecords(root)).records, []);
  await git(root, ["add", "src/refund.ts"]);
  assert.equal((await stageMatchingRecords(root)).records.length, 1);
  await handleCodexHook(hook(root, "UserPromptSubmit", "turn-2"), null);
  await writeFile(file, "second task\n");
  await handleCodexHook(hook(root, "Stop", "turn-2"), null);
  await git(root, ["add", "src/refund.ts"]);
  assert.deepEqual((await stageMatchingRecords(root)).records, [], "neither task covers the combined diff from HEAD");
});

test("snapshots cover deletions, renames, executable modes, symlinks and unusual paths", async (t) => {
  const root = await repository(t);
  await writeFile(path.join(root, "src/old.ts"), "old\n");
  await writeFile(path.join(root, "src/mode.ts"), "mode\n");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "初始文件"]);
  await handleCodexHook(hook(root, "UserPromptSubmit"), null);
  await git(root, ["mv", "src/old.ts", "src/新 name\n.ts"]);
  await chmod(path.join(root, "src/mode.ts"), 0o755);
  await symlink("mode.ts", path.join(root, "src/link.ts"));
  await handleCodexHook(hook(root, "Stop"), null);
  const [change] = await createDomainAtlasRuntime(root, null).store.listChanges();
  assert.equal(change.record.fileChanges?.length, 4);
  assert.equal(change.record.fileChanges?.find((file) => file.path === "src/old.ts")?.after, null);
  assert.equal(change.record.fileChanges?.find((file) => file.path === "src/link.ts")?.after?.mode, "120000");
  await git(root, ["add", "src"]);
  assert.deepEqual((await stageMatchingRecords(root)).records, [change.record.id]);
});

test("missing baseline is explicit, read-only turns are recorded but not staged, malformed input fails", async (t) => {
  const root = await repository(t);
  assert.match((await handleCodexHook(hook(root, "Stop"), null)).systemMessage!, /missing turn-start/);
  assert.deepEqual(await handleCodexHook({ hook_event_name: "SessionStart" }, null), {});
  await assert.rejects(handleCodexHook({ hook_event_name: "Stop" }, null), /Missing Codex hook field/);
  await handleCodexHook(hook(root, "UserPromptSubmit"), null);
  await handleCodexHook(hook(root, "Stop"), null);
  const [change] = await createDomainAtlasRuntime(root, null).store.listChanges();
  assert.deepEqual(change.record.changedFiles, []);
  assert.deepEqual((await stageMatchingRecords(root)).records, []);
});

test("unknown supersedes fails before writing any facts; valid correction and revert preserve the original", async (t) => {
  const root = await repository(t);
  const runtime = createDomainAtlasRuntime(root, null);
  const event = { request: "纠正记录", summary: "修正范围", changedFiles: ["src/refund.ts"] };
  for (const kind of ["correction", "revert"] as const) {
    await assert.rejects(runtime.adapter.handleTaskCompleted({ ...event, kind, supersedes: "change_missing" }), /target does not exist/);
  }
  assert.deepEqual(await runtime.store.listChanges(), []);
  const original = await runtime.adapter.handleTaskCompleted(event);
  const bytes = await readFile(path.join(root, original.relativePath), "utf8");
  const correction = await runtime.adapter.handleTaskCompleted({ ...event, kind: "correction", supersedes: original.record.id });
  await runtime.adapter.handleTaskCompleted({ ...event, kind: "revert", supersedes: correction.record.id });
  assert.equal(await readFile(path.join(root, original.relativePath), "utf8"), bytes);
  assert.equal((await runtime.store.listChanges()).length, 3);
});

test("actual Git pre-commit hook stages matching facts in an isolated repository", async (t) => {
  const root = await repository(t);
  const before = await worktreeSnapshot(root);
  await writeFile(path.join(root, "src/refund.ts"), "export const refund = true;\n");
  const fileChanges = snapshotChanges(before, await worktreeSnapshot(root));
  const change = await createDomainAtlasRuntime(root, null).adapter.handleTaskCompleted({
    request: "退款", summary: "支持退款", changedFiles: ["src/refund.ts"], fileChanges,
  });
  await git(root, ["add", "src/refund.ts"]);
  await symlink(path.resolve("dist"), path.join(root, "dist"));
  const hookFile = path.join(root, ".git/hooks/pre-commit");
  await writeFile(hookFile, await readFile(".githooks/pre-commit"));
  await chmod(hookFile, 0o755);
  await git(root, ["config", "core.hooksPath", path.join(root, ".git/hooks")]);
  await git(root, ["commit", "-m", "通过钩子记录退款"]);
  assert.equal((await new GitObserver(root).resolveRecordLifecycle(change.relativePath)).state, "committed");
});

test("Codex hook CLI consumes documented stdin and returns valid hook JSON", async (t) => {
  const root = await repository(t);
  const invoke = (event: unknown) => new Promise<string>((resolve, reject) => {
    const child = execFile(process.execPath, [path.resolve("dist/src/cli.js"), "codex-hook"], { cwd: root },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.end(JSON.stringify(event));
  });
  assert.deepEqual(JSON.parse(await invoke(hook(root, "UserPromptSubmit"))), {});
  await writeFile(path.join(root, "src/refund.ts"), "export const refund = true;\n");
  assert.deepEqual(JSON.parse(await invoke(hook(root, "Stop"))), {});
  assert.equal((await createDomainAtlasRuntime(root, null).store.listChanges()).length, 1);
  await assert.rejects(invoke({ hook_event_name: "Stop" }), /Missing Codex hook field/);
});

test("concurrent Stop deliveries publish exactly one complete record", async (t) => {
  const root = await repository(t);
  await handleCodexHook(hook(root, "UserPromptSubmit"), null);
  await writeFile(path.join(root, "src/refund.ts"), "refund\n");
  await Promise.all(Array.from({ length: 3 }, () => handleCodexHook(hook(root, "Stop"), null)));
  const changes = await createDomainAtlasRuntime(root, null).store.listChanges();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].record.summary, "已实现退款审核，测试通过");
});

test("selective staging preserves existing staged facts and refuses to overwrite later edits", async (t) => {
  const root = await repository(t);
  await handleCodexHook(hook(root, "UserPromptSubmit"), null);
  await writeFile(path.join(root, "src/refund.ts"), "refund\n");
  await handleCodexHook(hook(root, "Stop"), null);
  await git(root, ["add", "src/refund.ts"]);
  const preview = await stageMatchingRecords(root);
  const factPath = preview.paths.find((file) => file.startsWith(".domainatlas/capabilities/"))!;
  await git(root, ["add", factPath]);
  const staged = await git(root, ["diff", "--cached", "--raw"]);
  const fact = JSON.parse(await readFile(path.join(root, factPath), "utf8"));
  fact.name = "未暂存的名称修正";
  await writeFile(path.join(root, factPath), JSON.stringify(fact));
  await assert.rejects(stageMatchingRecords(root, true), /Refusing to overwrite/);
  assert.equal(await git(root, ["diff", "--cached", "--raw"]), staged);
});

test("a pending correction cannot be staged without its unmatched predecessor", async (t) => {
  const root = await repository(t);
  const runtime = createDomainAtlasRuntime(root, null);
  const before = await worktreeSnapshot(root);
  await writeFile(path.join(root, "src/refund.ts"), "refund\n");
  const fileChanges = snapshotChanges(before, await worktreeSnapshot(root));
  const event = { request: "退款审核", summary: "新增退款", changedFiles: ["src/refund.ts"] };
  const original = await runtime.adapter.handleTaskCompleted(event);
  await runtime.adapter.handleTaskCompleted({ ...event, kind: "correction", supersedes: original.record.id, fileChanges });
  await git(root, ["add", "src/refund.ts"]);
  const plan = await stageMatchingRecords(root);
  assert.deepEqual(plan.records, []);
  assert.ok(plan.skipped.some((item) => item.reason.includes("supersedes target")));
});
