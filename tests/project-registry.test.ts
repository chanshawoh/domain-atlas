import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, mkdtemp, readFile, realpath, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { discoverProjects, listProjects, registerProject, resolveProject } from "../src/storage/project-registry.js";
import { createDomainAtlasRuntime } from "../src/runtime.js";
import { createWebServer } from "../src/web/server.js";

const exec = promisify(execFile);
const cli = path.resolve("dist/src/cli.js");
async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "atlas-projects-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "registry");
  const env = { ...process.env, DOMAINATLAS_HOME: home };
  const invoke = (cwd: string, args: string[]) => exec(process.execPath, [cli, ...args], { cwd, env, timeout: 15_000 });
  const repository = async (name: string, initialized = true) => {
    const target = path.join(root, name);
    await mkdir(target, { recursive: true });
    await exec("git", ["init", "-b", "main"], { cwd: target });
    if (initialized) await createDomainAtlasRuntime(target, null).store.initialize();
    return target;
  };
  return { root, home, env, invoke, repository };
}

test("init registers canonical Git roots across invocations and from subdirectories without altering facts", async t => {
  const { root, home, invoke, repository } = await fixture(t);
  const project = await repository("订单 项目", false);
  await mkdir(path.join(project, "src"));
  await invoke(path.join(project, "src"), ["init"]);
  await assert.rejects(access(path.join(project, "src/.domainatlas")));
  const before = await readFile(path.join(project, ".domainatlas/config.json"), "utf8");
  const alias = path.join(root, "alias");
  await symlink(project, alias);
  await Promise.all([invoke(project, ["init"]), invoke(alias, ["init"])]);
  const directory = await listProjects(home);
  assert.equal(directory.projects.length, 1);
  assert.equal(directory.projects[0].root, project);
  assert.equal(directory.projects[0].status, "available");
  assert.equal(await resolveProject(directory.projects[0].id, home), project);
  assert.equal(await readFile(path.join(project, ".domainatlas/config.json"), "utf8"), before);
  assert.equal((await readdir(path.join(home, "projects"))).length, 1);
});

test("legacy discovery registers initialized nested roots only, skips symlinks and dependencies, and is bounded", async t => {
  const { root, home, repository } = await fixture(t);
  const first = await repository("parent/first");
  await repository("parent/first/nested");
  const uninitialized = await repository("parent/plain", false);
  await repository("parent/node_modules/hidden");
  await repository("outside");
  await symlink(path.join(root, "outside"), path.join(root, "parent/linked"));
  const before = await readFile(path.join(first, ".domainatlas/config.json"), "utf8");
  assert.equal((await discoverProjects(path.join(root, "parent"), home)).registered, 2);
  assert.equal((await listProjects(home)).projects.length, 2);
  assert.equal((await discoverProjects(path.join(root, "parent"), home)).registered, 2);
  assert.equal(await readFile(path.join(first, ".domainatlas/config.json"), "utf8"), before);
  await assert.rejects(access(path.join(uninitialized, ".domainatlas")));
  assert.match((await discoverProjects(root, home, 1)).warnings.join(" "), /上限/);
});

test("stale and corrupt projects do not hide healthy projects and arbitrary paths cannot be resolved", async t => {
  const { home, repository } = await fixture(t);
  const healthy = await repository("healthy");
  const gone = await repository("gone");
  const invalid = await repository("invalid");
  for (const project of [healthy, gone, invalid]) await registerProject(project, home);
  await rm(gone, { recursive: true });
  await writeFile(path.join(invalid, ".domainatlas/config.json"), "broken");
  await writeFile(path.join(home, "projects/broken.json"), "broken");
  const directory = await listProjects(home);
  assert.equal(directory.projects.filter(project => project.status === "available").length, 1);
  assert.equal(directory.projects.filter(project => project.status === "unavailable").length, 2);
  assert.equal(directory.warnings.length, 1);
  for (const id of ["../../etc/passwd", healthy, "project_0000000000000000"]) assert.equal(await resolveProject(id, home), null);
});

test("one API serves independent maps and histories, with live registration and project-scoped record IDs", async t => {
  const { root, home, repository } = await fixture(t);
  const first = await repository("one/service");
  const second = await repository("two/service");
  const firstId = await registerProject(first, home);
  const app = await createWebServer(root, undefined, home);
  t.after(() => app.close());
  const change = await createDomainAtlasRuntime(first, null).adapter.handleTaskCompleted({ request: "订单审核", summary: "支持订单审核", changedFiles: ["src/orders/review.ts"] });
  assert.equal((await app.inject("/api/projects")).json().projects.length, 1);
  const secondId = await registerProject(second, home);
  assert.equal((await app.inject("/api/projects")).json().projects.length, 2);
  const a = (await app.inject(`/api/projects/${firstId}/atlas`)).json();
  const b = (await app.inject(`/api/projects/${secondId}/atlas`)).json();
  assert.equal(a.project.root, first);
  assert.equal(a.changes.length, 1);
  assert.equal(b.project.root, second);
  assert.deepEqual(b.changes, []);
  assert.deepEqual(b.capabilities, []);
  assert.equal((await app.inject(`/api/projects/${firstId}/changes/${change.record.id}`)).statusCode, 200);
  assert.equal((await app.inject(`/api/projects/${secondId}/changes/${change.record.id}`)).statusCode, 404);
  assert.equal((await app.inject("/api/projects/unknown/atlas")).statusCode, 404);
  assert.equal((await app.inject("/api/projects/%2E%2E%2Fsecret/atlas")).statusCode, 404);
  assert.equal((await app.inject({ url: "/api/projects", headers: { host: "evil.invalid" } })).statusCode, 403);
  assert.equal((await app.inject({ url: `/api/projects/${firstId}/atlas`, headers: { origin: "https://evil.invalid" } })).statusCode, 403);
  assert.equal((await app.inject({ method: "POST", url: "/api/projects", payload: { root: first } })).statusCode, 404);
  await rm(path.join(second, ".domainatlas"), { recursive: true });
  assert.equal((await app.inject(`/api/projects/${secondId}/atlas`)).statusCode, 500);
  assert.equal((await app.inject(`/api/projects/${firstId}/atlas`)).statusCode, 200);
});

test("UI CLI starts outside Git, discovers legacy projects and serves the directory from a single port", async t => {
  const { root, home, env, invoke, repository } = await fixture(t);
  const project = await repository("legacy");
  assert.match((await invoke(root, ["ui", "--help"])).stdout, /--scan/);
  await assert.rejects(access(home));
  for (const args of [["ui", "--port", "0"], ["ui", "--unknown"], ["ui", "--scan", ""]]) await assert.rejects(invoke(root, args));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = (reservation.address() as { port: number }).port;
  await new Promise<void>(resolve => reservation.close(() => resolve()));
  const child = spawn(process.execPath, [cli, "ui", "--port", String(port), "--scan", project], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  t.after(async () => { if (child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; } });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("UI startup timed out")), 10_000);
    let output = "";
    child.stdout.on("data", data => { output += data; if (output.includes("DomainAtlas Web UI:")) { clearTimeout(timer); resolve(); } });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => { clearTimeout(timer); reject(new Error("UI exited: " + code)); });
  });
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(base)).status, 200);
  const directory = await (await fetch(base + "/api/projects")).json();
  assert.equal(directory.projects.length, 1);
  assert.equal(directory.projects[0].root, project);
  assert.equal((await fetch(base + `/api/projects/${directory.projects[0].id}/atlas`)).status, 200);
  await assert.rejects(access(path.join(root, ".domainatlas")));
});
