import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleCursorHook } from "../src/adapters/cursor-hooks.js";
import { configureCursorHooks } from "../src/adapters/cursor-hook-install.js";
import { git } from "../src/git/git-snapshot.js";
import { createDomainAtlasRuntime } from "../src/runtime.js";
import { registerProject } from "../src/storage/project-registry.js";

async function repository(t: { after: (fn: () => Promise<unknown>) => void }, initialized = false): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "domainatlas-cursor-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "DomainAtlas Test"]);
  await git(root, ["config", "user.email", "domainatlas@example.invalid"]);
  await git(root, ["config", "core.hooksPath", "/dev/null"]);
  await mkdir(path.join(root, "src"));
  if (initialized) await createDomainAtlasRuntime(root, null).store.initialize();
  return root;
}

function event(root: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    hook_event_name: name,
    conversation_id: "conv-1",
    generation_id: "gen-1",
    workspace_roots: [root],
    prompt: "实现退款审核",
    text: "已实现退款审核",
    status: "completed",
    ...extra,
  };
}

const turn = async (root: string, global = false) => {
  await handleCursorHook(event(root, "beforeSubmitPrompt"), null, global);
  await writeFile(path.join(root, "src/refund.ts"), "export const refund = true;\n");
  await handleCursorHook(event(root, "afterAgentResponse"), null, global);
  return handleCursorHook(event(root, "stop"), null, global);
};

test("Cursor turns record once with host cursor and skip empty or aborted stops", async (t) => {
  const root = await repository(t);
  await turn(root);
  await Promise.all([handleCursorHook(event(root, "stop"), null), handleCursorHook(event(root, "stop"), null)]);
  const runtime = createDomainAtlasRuntime(root, null);
  const [change] = await runtime.store.listChanges();
  assert.equal((await runtime.store.listChanges()).length, 1);
  assert.equal(change.record.source.host, "cursor");
  assert.equal(change.record.source.taskId, "conv-1/gen-1");
  assert.deepEqual(change.record.changedFiles, ["src/refund.ts"]);
  assert.equal(change.record.summary, "已实现退款审核");

  await handleCursorHook(event(root, "beforeSubmitPrompt", { generation_id: "gen-ask" }), null);
  await handleCursorHook(event(root, "afterAgentResponse", { generation_id: "gen-ask", text: "只是解释" }), null);
  await handleCursorHook(event(root, "stop", { generation_id: "gen-ask" }), null);
  assert.equal((await runtime.store.listChanges()).length, 1);

  await handleCursorHook(event(root, "beforeSubmitPrompt", { generation_id: "gen-abort" }), null);
  await writeFile(path.join(root, "src/other.ts"), "other\n");
  await handleCursorHook(event(root, "afterAgentResponse", { generation_id: "gen-abort" }), null);
  await handleCursorHook(event(root, "stop", { generation_id: "gen-abort", status: "aborted" }), null);
  assert.equal((await runtime.store.listChanges()).length, 1);
  assert.deepEqual(await handleCursorHook({ hook_event_name: "sessionStart" }, null), {});
});

test("global Cursor hooks skip uninitialized projects and record initialized ones", async (t) => {
  const root = await repository(t);
  assert.deepEqual(await handleCursorHook(event(root, "beforeSubmitPrompt"), null, true), {});
  await assert.rejects(access(path.join(root, ".domainatlas")));
  await createDomainAtlasRuntime(root, null).store.initialize();
  await handleCursorHook(event(root, "stop"), null, true);
  assert.deepEqual(await createDomainAtlasRuntime(root, null).store.listChanges(), []);
  await turn(root, true);
  const [change] = await createDomainAtlasRuntime(root, null).store.listChanges();
  assert.equal(change.record.source.host, "cursor");
});

test("Cursor hook CLI consumes documented stdin", async (t) => {
  const root = await repository(t);
  const invoke = (payload: unknown) => new Promise<string>((resolve, reject) => {
    const child = execFile(process.execPath, [path.resolve("dist/src/cli.js"), "cursor-hook"], { cwd: root },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.end(JSON.stringify(payload));
  });
  assert.deepEqual(JSON.parse(await invoke(event(root, "beforeSubmitPrompt"))), {});
  await writeFile(path.join(root, "src/refund.ts"), "export const refund = true;\n");
  assert.deepEqual(JSON.parse(await invoke(event(root, "afterAgentResponse"))), {});
  assert.deepEqual(JSON.parse(await invoke(event(root, "stop"))), {});
  assert.equal((await createDomainAtlasRuntime(root, null).store.listChanges()).length, 1);
  await assert.rejects(invoke({ hook_event_name: "stop" }), /Missing Cursor hook field/);
});

test("Cursor installer previews, preserves other hooks, and uninstalls only its handlers", async (t) => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), "atlas-cursor-home-")));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const cursorHome = path.join(parent, "cursor");
  const cliPath = path.resolve("dist/src/cli.js");
  const preview = await configureCursorHooks({ cliPath, cursorHome });
  assert.equal(preview.written, false);
  await mkdir(cursorHome);
  const file = path.join(cursorHome, "hooks.json");
  const other = { command: "./hooks/other.sh" };
  await writeFile(file, JSON.stringify({ version: 1, hooks: { stop: [other], afterFileEdit: [other] } }));
  const installed = await configureCursorHooks({ cliPath, cursorHome, write: true });
  assert.equal(installed.written, true);
  const config = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(config.hooks.stop[0], other);
  assert.equal(config.hooks.stop.length, 2);
  assert.equal(config.hooks.beforeSubmitPrompt.length, 1);
  assert.equal(config.hooks.afterAgentResponse.length, 1);
  assert.deepEqual(config.hooks.afterFileEdit, [other]);
  assert.equal((await configureCursorHooks({ cliPath, cursorHome, write: true })).changed, false);
  await configureCursorHooks({ cliPath, cursorHome, remove: true, write: true });
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).hooks.stop, [other]);
});

test("global Cursor hooks record into initialized projects registered below an aggregate workspace directory", async (t) => {
  const parent = await realpath(await mkdtemp(path.join(os.tmpdir(), "atlas-workspace-")));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const previous = process.env.DOMAINATLAS_HOME;
  process.env.DOMAINATLAS_HOME = path.join(parent, "registry");
  t.after(() => { if (previous === undefined) delete process.env.DOMAINATLAS_HOME; else process.env.DOMAINATLAS_HOME = previous; });
  const workspace = path.join(parent, "workspace");
  const nested = async (name: string, initialized: boolean) => {
    const root = path.join(workspace, name);
    await mkdir(root, { recursive: true });
    await git(root, ["init", "-b", "main"]);
    await git(root, ["config", "core.hooksPath", "/dev/null"]);
    await mkdir(path.join(root, "src"));
    if (initialized) await createDomainAtlasRuntime(root, null).store.initialize();
    return root;
  };
  await mkdir(workspace);
  const touched = await nested("touched", true);
  const untouched = await nested("untouched", true);
  const plain = await nested("plain", false);
  assert.ok(await registerProject(touched));
  assert.ok(await registerProject(untouched));
  assert.equal(await registerProject(plain), null);

  await handleCursorHook(event(workspace, "beforeSubmitPrompt"), null, true);
  await writeFile(path.join(touched, "src/refund.ts"), "export const refund = true;\n");
  await handleCursorHook(event(workspace, "afterAgentResponse"), null, true);
  await handleCursorHook(event(workspace, "stop"), null, true);

  const [change] = await createDomainAtlasRuntime(touched, null).store.listChanges();
  assert.deepEqual(change.record.changedFiles, ["src/refund.ts"]);
  assert.deepEqual(await createDomainAtlasRuntime(untouched, null).store.listChanges(), []);
  await access(path.join(untouched, ".git/domainatlas/turns"));
  await assert.rejects(access(path.join(plain, ".git/domainatlas")));
});
