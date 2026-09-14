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
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "atlas-status-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, "codex-home");
  const cursorHome = path.join(root, "cursor-home");
  const invoke = async (args: string[]) => {
    try {
      return await exec(process.execPath, [cli, ...args], {
        cwd: root, env: { ...process.env, CODEX_HOME: codexHome, CURSOR_HOME: cursorHome }, timeout: 15_000,
      });
    } catch (error) {
      if (error && typeof error === "object" && "stdout" in error) return error as { stdout: string; stderr: string; code: number };
      throw error;
    }
  };
  return { root, codexHome, cursorHome, invoke };
}

test("status and doctor help never write host config or initialize a project", async (t) => {
  const { root, codexHome, cursorHome, invoke } = await fixture(t);
  assert.match((await invoke(["status", "--help"])).stdout, /domainatlas status/);
  assert.match((await invoke(["doctor", "--help"])).stdout, /domainatlas doctor/);
  for (const args of [["status", "--dry-run"], ["status", "--unknown"], ["doctor", "now"],
    ["status", "--codex-home", ""], ["doctor", "--cursor-home", ""]]) {
    await assert.rejects(exec(process.execPath, [cli, ...args], { cwd: root, timeout: 5_000 }));
  }
  await assert.rejects(access(codexHome));
  await assert.rejects(access(cursorHome));
  await assert.rejects(access(path.join(root, ".domainatlas")));
});

test("status reports a healthy install and doctor is a no-op", async (t) => {
  const { root, cursorHome, invoke } = await fixture(t);
  const empty = await invoke(["status"]);
  assert.equal("code" in empty ? empty.code : 0, 0);
  assert.match(empty.stdout, /not installed/);
  assert.match(empty.stdout, /No hook issues found/);
  await invoke(["init", "-g", "--cursor"]);
  const ok = await invoke(["status"]);
  assert.equal("code" in ok ? ok.code : 0, 0);
  assert.match(ok.stdout, /cursor  installed/);
  assert.match(ok.stdout, /No hook issues found/);
  const doctor = await invoke(["doctor"]);
  assert.match(doctor.stdout, /No repairable hook issues/);
  await assert.rejects(access(path.join(root, ".domainatlas")));
  assert.match(await readFile(path.join(cursorHome, "hooks.json"), "utf8"), /domainatlas-hook/);
});

test("status detects broken host hooks and doctor repairs them without installing a missing host", async (t) => {
  const { root, cursorHome, invoke } = await fixture(t);
  await mkdir(cursorHome);
  await writeFile(path.join(cursorHome, "hooks.json"), JSON.stringify({
    version: 1,
    hooks: { stop: [{ command: "'/old/node' '/old/cli.js' cursor-hook --global" }] },
  }));
  const status = await invoke(["status"]);
  assert.equal((status as { code?: number }).code, 1);
  assert.match(status.stdout, /cursor  installed/);
  assert.match(status.stdout, /pinned Node\/CLI path/);
  assert.match(status.stdout, /domainatlas doctor/);
  const bytes = await readFile(path.join(cursorHome, "hooks.json"), "utf8");
  const preview = await invoke(["doctor", "--dry-run"]);
  assert.match(preview.stdout, /Would repair: cursor/);
  assert.equal(await readFile(path.join(cursorHome, "hooks.json"), "utf8"), bytes);
  await assert.rejects(access(path.join(cursorHome, "domainatlas-hook")));
  const repaired = await invoke(["doctor"]);
  assert.match(repaired.stdout, /Repaired: cursor/);
  assert.match(await readFile(path.join(cursorHome, "hooks.json"), "utf8"), /domainatlas-hook/);
  assert.match(await readFile(path.join(cursorHome, "domainatlas-hook"), "utf8"), /hook cursor/);
  const after = await invoke(["status"]);
  assert.equal("code" in after ? after.code : 0, 0);
  assert.match(after.stdout, /No hook issues found/);
  assert.match(after.stdout, /codex  not installed/);
  await assert.rejects(access(path.join(root, ".domainatlas")));
});

test("doctor removes an orphan launcher and skips unreadable hook configuration", async (t) => {
  const { root, codexHome, cursorHome, invoke } = await fixture(t);
  await mkdir(cursorHome);
  await writeFile(path.join(cursorHome, "domainatlas-hook"), "#!/bin/sh\n");
  const preview = await invoke(["doctor", "--dry-run"]);
  assert.match(preview.stdout, /Would repair: cursor/);
  await access(path.join(cursorHome, "domainatlas-hook"));
  const repaired = await invoke(["doctor"]);
  assert.match(repaired.stdout, /Repaired: cursor/);
  await assert.rejects(access(path.join(cursorHome, "domainatlas-hook")));
  await mkdir(codexHome);
  await writeFile(path.join(codexHome, "hooks.json"), "{");
  const blocked = await invoke(["doctor"]);
  assert.equal((blocked as { code?: number }).code, 1);
  assert.match(blocked.stdout, /Skipped: codex \(invalid-config\)/);
  assert.equal(await readFile(path.join(codexHome, "hooks.json"), "utf8"), "{");
  await assert.rejects(access(path.join(root, ".domainatlas")));
});
