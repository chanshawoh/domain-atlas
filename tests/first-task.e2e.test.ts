import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { GitObserver } from "../src/git/git-observer.js";
import { createDomainAtlasRuntime } from "../src/runtime.js";

const execFileAsync = promisify(execFile);

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd: root });
  return stdout.trim();
}

test("the first Codex task becomes pending immediately and committed after Git commit", async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "domainatlas-e2e-"));
  t.after(async () => rm(projectRoot, { recursive: true, force: true }));
  await git(projectRoot, ["init", "-b", "main"]);
  await git(projectRoot, ["config", "user.name", "DomainAtlas Test"]);
  await git(projectRoot, ["config", "user.email", "domainatlas@example.invalid"]);

  const runtime = createDomainAtlasRuntime(projectRoot, null);
  const recorded = await runtime.adapter.handleTaskCompleted({
    taskId: "codex-task-1",
    completedAt: "2026-08-20T08:00:00.000Z",
    request: "支持退款审核",
    summary: "新增退款审核能力",
    changedFiles: ["src/billing/refund.ts"],
    tests: [{ command: "pnpm test", status: "passed" }],
  });

  assert.equal(recorded.record.source.host, "codex");
  assert.equal(recorded.discovery.domains.length, 1);
  assert.equal(recorded.discovery.domains[0].name, "billing");
  assert.equal(recorded.discovery.capabilities.length, 1);
  assert.equal(recorded.discovery.capabilities[0].name, "refund");

  const observer = new GitObserver(projectRoot);
  assert.deepEqual(await observer.resolveRecordLifecycle(recorded.relativePath), { state: "pending" });

  const stored = JSON.parse(
    await readFile(path.join(projectRoot, recorded.relativePath), "utf8"),
  ) as { id: string };
  assert.equal(stored.id, recorded.record.id);
  assert.equal((await readdir(path.join(projectRoot, ".domainatlas", "changes"))).length, 1);

  await assert.rejects(
    runtime.adapter.handleTaskCompleted({
      request: "纠正退款审核记录",
      summary: "补充遗漏的影响范围",
      changedFiles: ["src/billing/refund.ts"],
      kind: "correction",
    }),
    /must declare supersedes/,
  );
  const correction = await runtime.adapter.handleTaskCompleted({
    request: "纠正退款审核记录",
    summary: "补充遗漏的影响范围",
    changedFiles: ["src/billing/refund.ts"],
    kind: "correction",
    supersedes: recorded.record.id,
  });
  assert.notEqual(correction.record.id, recorded.record.id);
  assert.equal(correction.record.supersedes, recorded.record.id);
  assert.equal((await readdir(path.join(projectRoot, ".domainatlas", "changes"))).length, 2);

  await git(projectRoot, ["add", ".domainatlas"]);
  await git(projectRoot, ["commit", "-m", "记录第一次业务变更"]);
  const head = await git(projectRoot, ["rev-parse", "HEAD"]);
  assert.deepEqual(await observer.resolveRecordLifecycle(recorded.relativePath), {
    state: "committed",
    commitSha: head,
  });
  assert.deepEqual(await observer.resolveRecordLifecycle(correction.relativePath), {
    state: "committed",
    commitSha: head,
  });
});

test("Git lifecycle projection rejects a non-Git project", async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "domainatlas-no-git-"));
  t.after(async () => rm(projectRoot, { recursive: true, force: true }));
  const observer = new GitObserver(projectRoot);
  await assert.rejects(
    observer.resolveRecordLifecycle(".domainatlas/changes/change_1.json"),
    /not a git repository/i,
  );
});
