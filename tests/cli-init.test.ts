import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
const cli = path.resolve("dist/src/cli.js");

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "atlas-init-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, "codex-home");
  const invoke = (args: string[]) => exec(process.execPath, [cli, ...args], {
    cwd: root, env: { ...process.env, CODEX_HOME: codexHome }, timeout: 15_000,
  });
  return { root, codexHome, file: path.join(codexHome, "hooks.json"), invoke };
}

test("init -g --codex installs immediately, dry-run never writes, and uninstall retains other hooks", async (t) => {
  const { root, codexHome, file, invoke } = await fixture(t);
  const preview = JSON.parse((await invoke(["init", "-g", "--codex", "--dry-run"])).stdout);
  assert.equal(preview.written, false);
  assert.match(preview.notice, /without --dry-run/);
  await assert.rejects(access(codexHome));
  await assert.rejects(access(path.join(root, ".domainatlas")));
  await mkdir(codexHome);
  const other = { hooks: [{ type: "command", command: "echo user-hook" }] };
  await writeFile(file, JSON.stringify({ hooks: { Stop: [other] } }));
  const installed = JSON.parse((await invoke(["init", "-g", "--codex"])).stdout);
  assert.equal(installed.written, true);
  assert.equal(installed.file, file);
  const config = JSON.parse(await readFile(file, "utf8"));
  assert.equal(config.hooks.Stop.length, 2);
  assert.deepEqual(config.hooks.Stop[0], other);
  assert.equal(config.hooks.UserPromptSubmit.length, 1);
  const bytes = await readFile(file, "utf8");
  assert.equal(JSON.parse((await invoke(["init", "--codex", "--global"])).stdout).changed, false);
  await invoke(["init", "-g", "--codex", "--uninstall", "--dry-run"]);
  assert.equal(await readFile(file, "utf8"), bytes);
  const removed = JSON.parse((await invoke(["init", "--global", "--codex", "--uninstall"])).stdout);
  assert.equal(removed.written, true);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).hooks.Stop, [other]);
  await assert.rejects(access(path.join(root, ".domainatlas")));
});

test("plain init preserves project initialization and leaves global configuration alone", async (t) => {
  const { root, codexHome, invoke } = await fixture(t);
  await invoke(["init"]);
  const file = path.join(root, ".domainatlas/config.json");
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { schemaVersion: 1, storage: "immutable-json-files" });
  const bytes = await readFile(file, "utf8");
  await invoke(["init"]);
  assert.equal(await readFile(file, "utf8"), bytes);
  await assert.rejects(access(codexHome));
});

test("help and invalid init options never accidentally initialize a project or write global config", async (t) => {
  const { root, codexHome, invoke } = await fixture(t);
  for (const args of [["--help"], ["-h"], ["init", "--help"], ["init", "-h"]]) {
    assert.match((await invoke(args)).stdout, /domainatlas init/);
  }
  for (const args of [["init", "-g"], ["init", "--codex"], ["init", "--cursor"], ["init", "--dry-run"], ["init", "--uninstall"],
    ["init", "--unknown"], ["init", "project"], ["init", "-g", "--codex", "--write"],
    ["init", "-g", "--codex", "--cursor"], ["init", "-g", "--codex", "--codex-home"], ["init", "-g", "--codex", "--codex-home", ""],
    ["init", "-g", "--cursor", "--cursor-home"], ["init", "-g", "--cursor", "--cursor-home", ""]]) {
    await assert.rejects(invoke(args));
  }
  await assert.rejects(access(codexHome));
  await assert.rejects(access(path.join(root, ".domainatlas")));
});

test("explicit Codex home overrides environment for installation and removal", async (t) => {
  const { root, codexHome, invoke } = await fixture(t);
  const customHome = path.join(root, "custom home");
  const installed = JSON.parse((await invoke(["init", "-g", "--codex", "--codex-home", customHome])).stdout);
  assert.equal(installed.file, path.join(customHome, "hooks.json"));
  await assert.rejects(access(codexHome));
  const file = path.join(customHome, "hooks.json");
  const bytes = await readFile(file, "utf8");
  await invoke(["init", "-g", "--codex", "--codex-home", customHome, "--uninstall", "--dry-run"]);
  assert.equal(await readFile(file, "utf8"), bytes);
  await invoke(["init", "-g", "--codex", "--codex-home", customHome, "--uninstall"]);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).hooks, { UserPromptSubmit: [], Stop: [] });
  await assert.rejects(access(codexHome));
});

test("init -g --cursor installs immediately, dry-run never writes, and uninstall retains other hooks", async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "atlas-init-cursor-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cursorHome = path.join(root, "cursor-home");
  const invoke = (args: string[]) => exec(process.execPath, [cli, ...args], {
    cwd: root, env: { ...process.env, CURSOR_HOME: cursorHome }, timeout: 15_000,
  });
  const file = path.join(cursorHome, "hooks.json");
  const preview = JSON.parse((await invoke(["init", "-g", "--cursor", "--dry-run"])).stdout);
  assert.equal(preview.written, false);
  await assert.rejects(access(cursorHome));
  await mkdir(cursorHome);
  const other = { command: "./hooks/other.sh" };
  await writeFile(file, JSON.stringify({ version: 1, hooks: { stop: [other] } }));
  const installed = JSON.parse((await invoke(["init", "-g", "--cursor"])).stdout);
  assert.equal(installed.written, true);
  const config = JSON.parse(await readFile(file, "utf8"));
  assert.equal(config.hooks.stop.length, 2);
  assert.deepEqual(config.hooks.stop[0], other);
  assert.equal(config.hooks.beforeSubmitPrompt.length, 1);
  const bytes = await readFile(file, "utf8");
  await invoke(["init", "-g", "--cursor", "--uninstall", "--dry-run"]);
  assert.equal(await readFile(file, "utf8"), bytes);
  await invoke(["init", "--global", "--cursor", "--uninstall"]);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")).hooks.stop, [other]);
  await assert.rejects(access(path.join(root, ".domainatlas")));
});
