import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { configureCodexHooks } from "../src/adapters/codex-hook-install.js";
import { handleCodexHook } from "../src/adapters/codex-hooks.js";
import { git } from "../src/git/git-snapshot.js";
import { createDomainAtlasRuntime } from "../src/runtime.js";

async function temporary(t: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "atlas-global-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function repository(parent: string, name: string, initialized = false) {
  const root = path.join(parent, name);
  await mkdir(root, { recursive: true });
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "core.hooksPath", "/dev/null"]);
  if (initialized) await createDomainAtlasRuntime(root, null).store.initialize();
  return root;
}

function event(cwd: string, name: string, turn = "turn-1", prompt = "实现退款审核") {
  return { cwd, session_id: "session-1", turn_id: turn, hook_event_name: name,
    prompt, last_assistant_message: "完成退款审核" };
}

const globalHook = (input: unknown) => handleCodexHook(input, null, true);
const cliPath = path.resolve("dist/src/cli.js");

test("global hooks leave non-Git and uninitialized projects untouched, including initialization during a turn", async (t) => {
  const parent = await temporary(t);
  const root = await repository(parent, "empty");
  for (const cwd of [parent, root]) {
    for (const name of ["UserPromptSubmit", "Stop"]) assert.deepEqual(await globalHook(event(cwd, name)), {});
    await assert.rejects(access(path.join(cwd, ".domainatlas")));
  }
  await assert.rejects(access(path.join(root, ".git/domainatlas")));
  await createDomainAtlasRuntime(root, null).store.initialize();
  await globalHook(event(root, "Stop"));
  assert.deepEqual(await createDomainAtlasRuntime(root, null).store.listChanges(), []);
  await assert.rejects(access(path.join(root, ".git/domainatlas")));
});

test("initialized projects automatically record ordinary turns without a prefix and deduplicate completion", async (t) => {
  const parent = await temporary(t);
  const root = await repository(parent, "initialized", true);
  const prompts = ["实现退款审核", "继续开发", "解释一下这个接口"];
  for (const [index, prompt] of prompts.entries()) {
    await globalHook(event(root, "UserPromptSubmit", String(index), prompt));
    await writeFile(path.join(root, "refund.ts"), `export const version = ${index};\n`);
    await Promise.all([globalHook(event(root, "Stop", String(index))), globalHook(event(root, "Stop", String(index)))]);
  }
  const changes = await createDomainAtlasRuntime(root, null).store.listChanges();
  assert.equal(changes.length, 3);
  assert.deepEqual(changes.map((change) => change.record.request).sort(), [...prompts].sort());
  for (const change of changes) assert.deepEqual(change.record.changedFiles, ["refund.ts"]);
});

test("global hooks validate configuration without overwriting it and do not consume legacy turn snapshots", async (t) => {
  const parent = await temporary(t);
  const root = await repository(parent, "config", true);
  const file = path.join(root, ".domainatlas/config.json");
  for (const text of ["{", "null", '{"schemaVersion":2,"storage":"immutable-json-files"}']) {
    await writeFile(file, text);
    assert.match((await globalHook(event(root, "UserPromptSubmit"))).systemMessage!, /invalid or unsupported/);
    assert.deepEqual(await globalHook(event(root, "Stop")), {});
    assert.equal(await readFile(file, "utf8"), text);
  }
  await writeFile(file, '{"schemaVersion":1,"storage":"immutable-json-files"}');
  await handleCodexHook(event(root, "UserPromptSubmit"), null);
  await globalHook(event(root, "Stop"));
  assert.deepEqual(await createDomainAtlasRuntime(root, null).store.listChanges(), []);
});

test("installer previews without writes, preserves other hooks, backs up, is idempotent, and removes only its handlers", async (t) => {
  const parent = await temporary(t);
  const codexHome = path.join(parent, "codex");
  const options = { cliPath, codexHome };
  const preview = await configureCodexHooks(options);
  assert.equal(preview.written, false);
  assert.equal(preview.changed, true);
  await assert.rejects(access(codexHome));
  await mkdir(codexHome);
  const other = { type: "command", command: "echo other", timeout: 3 };
  const original = JSON.stringify({ description: "user hooks", extra: { keep: true },
    hooks: { UserPromptSubmit: [{ matcher: "*", hooks: [other] }], Stop: [], SessionStart: [{ hooks: [other] }] } });
  const file = path.join(codexHome, "hooks.json");
  await writeFile(file, original);
  const installed = await configureCodexHooks({ ...options, write: true });
  assert.equal(installed.written, true);
  assert.ok("backup" in installed && installed.backup);
  assert.equal(await readFile(installed.backup, "utf8"), original);
  const first = await readFile(file, "utf8");
  const config = JSON.parse(first);
  assert.deepEqual(config.hooks.UserPromptSubmit[0], { matcher: "*", hooks: [other] });
  assert.equal(config.hooks.Stop.length, 1);
  assert.deepEqual(config.extra, { keep: true });
  assert.equal((await configureCodexHooks({ ...options, write: true })).changed, false);
  assert.equal(await readFile(file, "utf8"), first);
  // Preserve an unrelated handler even when it shares a DomainAtlas-owned group.
  config.hooks.Stop[0].hooks.push(other);
  await writeFile(file, JSON.stringify(config));
  await configureCodexHooks({ ...options, remove: true, write: true });
  const removed = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(removed.hooks.Stop, [{ hooks: [other] }]);
  assert.deepEqual(removed.hooks.SessionStart, [{ hooks: [other] }]);
  assert.equal((await configureCodexHooks({ ...options, remove: true, write: true })).changed, false);
});

test("installer refuses malformed config, symlinks, and concurrent installers without replacing user data", async (t) => {
  const codexHome = await temporary(t);
  const file = path.join(codexHome, "hooks.json");
  const options = { cliPath, codexHome, write: true };
  for (const malformed of ["{", "[]", '{"hooks":{"Stop":{}}}']) {
    await writeFile(file, malformed);
    await assert.rejects(configureCodexHooks(options));
    assert.equal(await readFile(file, "utf8"), malformed);
  }
  await writeFile(file, "{}");
  await writeFile(file + ".domainatlas.lock", "another installer");
  await assert.rejects(configureCodexHooks(options), { code: "EEXIST" });
  assert.equal(await readFile(file, "utf8"), "{}");
  await rm(file + ".domainatlas.lock");
  const target = path.join(codexHome, "target.json");
  await writeFile(target, "{}");
  await rm(file);
  await symlink(target, file);
  await assert.rejects(configureCodexHooks(options), /non-regular/);
  assert.equal(await readFile(target, "utf8"), "{}");
});

test("installed absolute command runs from different projects and subdirectories, quoting special paths", async (t) => {
  const parent = await temporary(t);
  const linkedCli = path.join(parent, "atlas ' $literal cli.js");
  await symlink(cliPath, linkedCli);
  const codexHome = path.join(parent, "codex");
  await configureCodexHooks({ cliPath: linkedCli, codexHome, write: true });
  const config = JSON.parse(await readFile(path.join(codexHome, "hooks.json"), "utf8"));
  const command = config.hooks.UserPromptSubmit[0].hooks[0].command;
  const invoke = (cwd: string, input: unknown) => new Promise<string>((resolve, reject) => {
    const child = execFile("/bin/sh", ["-c", command], { cwd, timeout: 30_000 },
      (error, stdout) => error ? reject(error) : resolve(stdout));
    child.stdin?.end(JSON.stringify(input));
  });
  for (const name of ["first", "second"]) {
    const root = await repository(parent, name, true);
    const cwd = path.join(root, "nested");
    await mkdir(cwd);
    assert.deepEqual(JSON.parse(await invoke(cwd, event(cwd, "UserPromptSubmit"))), {});
    await writeFile(path.join(root, "feature.ts"), "export const feature = true;\n");
    assert.deepEqual(JSON.parse(await invoke(cwd, event(cwd, "Stop"))), {});
    await invoke(cwd, event(cwd, "Stop"));
    const changes = await createDomainAtlasRuntime(root, null).store.listChanges();
    assert.equal(changes.length, 1);
    assert.deepEqual(changes[0].record.changedFiles, ["feature.ts"]);
  }
});
