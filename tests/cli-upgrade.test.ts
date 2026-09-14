import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { isNpmInstalledCli, packageVersion } from "../src/package-info.js";
import { formatUpgrade, upgradeDomainAtlas } from "../src/upgrade.js";

const exec = promisify(execFile);
const cli = path.resolve("dist/src/cli.js");
const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { version: string };

async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "atlas-upgrade-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexHome = path.join(root, "codex-home");
  const cursorHome = path.join(root, "cursor-home");
  const invoke = (args: string[]) => exec(process.execPath, [cli, ...args], {
    cwd: root,
    env: { ...process.env, CODEX_HOME: codexHome, CURSOR_HOME: cursorHome },
    timeout: 15_000,
  });
  return { root, codexHome, cursorHome, invoke };
}

test("-v, --version, and version print the package version without touching hosts or the project", async (t) => {
  const { root, codexHome, cursorHome, invoke } = await fixture(t);
  for (const args of [["-v"], ["--version"], ["version"]]) {
    assert.equal((await invoke(args)).stdout, pkg.version + "\n");
  }
  assert.equal(await packageVersion(cli), pkg.version);
  await assert.rejects(access(codexHome));
  await assert.rejects(access(cursorHome));
  await assert.rejects(access(path.join(root, ".domainatlas")));
});

test("upgrade --help and invalid options never initialize a project or write host config", async (t) => {
  const { root, codexHome, cursorHome, invoke } = await fixture(t);
  assert.match((await invoke(["upgrade", "--help"])).stdout, /domainatlas upgrade/);
  for (const args of [["upgrade", "--unknown"], ["upgrade", "now"], ["upgrade", "--codex"],
    ["upgrade", "--codex-home"], ["upgrade", "--codex-home", ""], ["upgrade", "--cursor-home", ""]]) {
    await assert.rejects(invoke(args));
  }
  await assert.rejects(access(codexHome));
  await assert.rejects(access(cursorHome));
  await assert.rejects(access(path.join(root, ".domainatlas")));
});

test("upgrade refreshes only already-installed hosts and skips npm from a source CLI", async (t) => {
  const { root, codexHome, cursorHome, invoke } = await fixture(t);
  const preview = await invoke(["upgrade", "--dry-run"]);
  assert.match(preview.stdout, /not an npm install/);
  assert.match(preview.stdout, /No installed host hooks/);
  assert.match(preview.stdout, /without --dry-run/);
  await assert.rejects(access(codexHome));
  await invoke(["init", "-g", "--codex"]);
  await invoke(["init", "-g", "--cursor"]);
  const file = path.join(codexHome, "hooks.json");
  const cursorFile = path.join(cursorHome, "hooks.json");
  const before = await readFile(file, "utf8");
  const cursorBefore = await readFile(cursorFile, "utf8");
  const dry = await invoke(["upgrade", "--dry-run"]);
  assert.match(dry.stdout, /Would refresh host hooks: codex, cursor/);
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal(await readFile(cursorFile, "utf8"), cursorBefore);
  const current = await invoke(["upgrade"]);
  assert.match(current.stdout, /skipped package download/);
  assert.match(current.stdout, /Host hooks already current: codex, cursor/);
  assert.equal(await readFile(file, "utf8"), before);
  await writeFile(file, before.replaceAll(/'[^']+' '[^']+' codex-hook --global/g, "'/old/node' '/old/cli.js' codex-hook --global"));
  const applied = await invoke(["upgrade"]);
  assert.match(applied.stdout, /Refreshed host hooks: codex, cursor/);
  const after = await readFile(file, "utf8");
  assert.match(after, /codex-hook --global/);
  assert.doesNotMatch(after, /\/old\/cli\.js/);
  assert.match(await readFile(cursorFile, "utf8"), /cursor-hook --global/);
  await assert.rejects(access(path.join(root, ".domainatlas")));
});

test("upgrade installs a newer npm package then rewrites only installed host hooks", async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "atlas-upgrade-npm-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const globalRoot = path.join(root, "global-node_modules");
  await mkdir(path.join(globalRoot, "domainatlas", "dist", "src"), { recursive: true });
  await writeFile(path.join(globalRoot, "domainatlas", "dist", "src", "cli.js"), "#!/usr/bin/env node\n");
  const currentCli = path.join(root, "node_modules", "domainatlas", "dist", "src", "cli.js");
  await mkdir(path.dirname(currentCli), { recursive: true });
  await writeFile(currentCli, "#!/usr/bin/env node\n");
  await writeFile(path.join(root, "node_modules", "domainatlas", "package.json"),
    JSON.stringify({ name: "domainatlas", version: pkg.version }));
  const codexHome = path.join(root, "codex");
  const cursorHome = path.join(root, "cursor");
  const calls: string[][] = [];
  const dry = await upgradeDomainAtlas({
    cliPath: currentCli, dryRun: true, codexHome, cursorHome,
    npm: async (args) => {
      calls.push(args);
      if (args[0] === "view") return "9.9.9\n";
      throw new Error("unexpected npm " + args.join(" "));
    },
  });
  assert.equal(dry.packageAction, "preview");
  assert.equal(dry.latest, "9.9.9");
  assert.deepEqual(dry.hosts.map((host) => host.status), ["absent", "absent"]);
  assert.deepEqual(calls, [["view", "domainatlas", "version"]]);
  await mkdir(codexHome);
  await writeFile(path.join(codexHome, "hooks.json"), JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command: "'/old/node' '/old/cli.js' codex-hook --global",
      statusMessage: "DomainAtlas: 全局业务记录" }] }] },
  }));
  const applied = await upgradeDomainAtlas({
    cliPath: currentCli, codexHome, cursorHome,
    npm: async (args) => {
      calls.push(args);
      if (args[0] === "view") return "9.9.9\n";
      if (args[0] === "install") return "";
      if (args[0] === "root") return globalRoot + "\n";
      throw new Error("unexpected npm " + args.join(" "));
    },
  });
  assert.equal(applied.packageAction, "install");
  assert.equal(applied.hosts.find((host) => host.name === "codex")?.status, "updated");
  assert.equal(applied.hosts.find((host) => host.name === "cursor")?.status, "absent");
  assert.match(await readFile(path.join(codexHome, "hooks.json"), "utf8"), /domainatlas[/\\]dist[/\\]src[/\\]cli\.js/);
  await assert.rejects(access(cursorHome));
  assert.equal(isNpmInstalledCli(currentCli), true);
  assert.equal(isNpmInstalledCli(cli), false);
  assert.match(formatUpgrade(applied), /Upgraded domainatlas from /);
});
