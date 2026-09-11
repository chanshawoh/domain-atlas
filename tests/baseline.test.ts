import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildBaseline } from "../src/core/build-baseline.js";
import { IncrementalFallbackCodeGraphProvider } from "../src/code-graph/fallback-provider.js";
import { createDomainAtlasRuntime } from "../src/runtime.js";
import { readAtlas } from "../src/web/query.js";
import { createWebServer } from "../src/web/server.js";

const exec = promisify(execFile);
const cli = path.resolve("dist/src/cli.js");
const provider = new IncrementalFallbackCodeGraphProvider();
const manifest = {
  schemaVersion: 1,
  domains: [{ name: "订单管理", confidence: "medium", evidence: [{ file: "src/orders/order.ts", reason: "管理订单状态" }],
    capabilities: [{ name: "退款审核", confidence: "high", evidence: [{ file: "src/orders/refund.ts", reason: "校验并审核退款" }] }] }],
};
async function fixture(t: { after: (fn: () => Promise<unknown>) => void }) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "atlas-baseline-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (args: string[]) => exec("git", args, { cwd: root });
  const invoke = (args: string[]) => exec(process.execPath, [cli, ...args], { cwd: root, timeout: 30_000, env: { ...process.env, DOMAINATLAS_HOME: path.join(root, "registry") } });
  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "Baseline Test"]);
  await git(["config", "user.email", "baseline@example.invalid"]);
  for (const file of ["src/orders/order.ts", "src/orders/refund.ts", "tests/refund.test.ts", "dist/main.js", "README.md"]) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), "// fixture\n");
  }
  await git(["add", "."]);
  await git(["commit", "-m", "existing code"]);
  return { root, git, invoke };
}

test("build requires initialization and root, previews without facts, rejects invalid limits", async t => {
  const { root, invoke } = await fixture(t);
  assert.match((await invoke(["build", "--help"])).stdout, /baseline/);
  await assert.rejects(buildBaseline(root, { provider }), /not initialized/);
  await assert.rejects(access(path.join(root, ".domainatlas")));
  await invoke(["init"]);
  await assert.rejects(buildBaseline(path.join(root, "src"), { provider }), /project root/);
  for (const maxFiles of [0, -1, 2001, NaN, 1.5]) await assert.rejects(buildBaseline(root, { maxFiles, provider }), /max-files/);
  await assert.rejects(invoke(["build", "--unknown"]));
  const preview = await buildBaseline(root, { dryRun: true, provider });
  assert.equal(preview.written, false);
  assert.equal(preview.baseline.coverage.eligibleFiles, 2);
  assert.equal(preview.baseline.files.length, 2);
  assert.deepEqual(await readdir(path.join(root, ".domainatlas")), ["config.json"]);
});

test("structural baseline is visible through API without fabricated changes; repeated and concurrent builds are idempotent", async t => {
  const { root, invoke } = await fixture(t);
  await invoke(["init"]);
  const results = await Promise.all([buildBaseline(root, { provider }), buildBaseline(root, { provider })]);
  assert.equal(results.filter(result => result.written).length, 1);
  assert.equal(results[0].baseline.id, results[1].baseline.id);
  const file = path.join(root, ".domainatlas/baselines", results[0].baseline.id + ".json");
  const before = await readFile(file, "utf8");
  const repeat = await buildBaseline(root, { provider });
  assert.equal(repeat.written, false);
  assert.deepEqual(repeat.baseline, JSON.parse(before));
  assert.equal(await readFile(file, "utf8"), before);
  assert.equal((await readdir(path.dirname(file))).length, 1);
  const app = await createWebServer(root);
  t.after(() => app.close());
  const response = await app.inject("/api/atlas");
  assert.equal(response.statusCode, 200);
  const data = response.json();
  assert.ok(data.domains.length);
  assert.ok(data.capabilities.length);
  assert.equal(data.capabilities[0].evidence[0].source, "baseline-file-path");
  assert.equal(data.capabilities[0].confidence, "low");
  assert.deepEqual(data.changes, []);
  assert.equal(data.baseline.id, results[0].baseline.id);
  assert.deepEqual(JSON.parse((await invoke(["list"])).stdout), []);
});

test("AI CLI import validates evidence and preserves incremental facts and change history", async t => {
  const { root, invoke, git } = await fixture(t);
  await invoke(["init"]);
  const input = path.join(root, "baseline-input.json");
  await writeFile(input, JSON.stringify(manifest));
  const preview = JSON.parse((await invoke(["build", "--input", input, "--dry-run"])).stdout);
  assert.equal(preview.written, false);
  await assert.rejects(access(path.join(root, ".domainatlas/baselines")));
  const built = JSON.parse((await invoke(["build", "--input", input])).stdout);
  assert.equal(built.written, true);
  assert.equal(built.baseline.head, (await git(["rev-parse", "HEAD"])).stdout.trim());
  assert.equal(built.baseline.files[0].oid, (await git(["hash-object", "src/orders/order.ts"])).stdout.trim());
  const runtime = createDomainAtlasRuntime(root, null);
  const change = await runtime.adapter.handleTaskCompleted({ request: "新增支付", summary: "支持支付", changedFiles: ["src/payment/pay.ts"] });
  const snapshot = await readAtlas(root);
  assert.ok(snapshot.capabilities.some(cap => cap.name === "退款审核"));
  assert.ok(snapshot.capabilities.some(cap => cap.name === "pay"));
  assert.equal(snapshot.changes[0].id, change.record.id);
  assert.equal(snapshot.totals.changes, 1);
});

test("invalid AI manifests write no partial facts", async t => {
  const { root, invoke, git } = await fixture(t);
  await invoke(["init"]);
  await symlink("order.ts", path.join(root, "src/orders/link.ts"));
  await git(["add", "src/orders/link.ts"]);
  for (const file of ["../outside.ts", "/etc/passwd", "missing.ts", ".domainatlas/config.json", "src/orders/link.ts"]) {
    const input = structuredClone(manifest);
    input.domains[0].capabilities[0].evidence[0].file = file;
    await assert.rejects(buildBaseline(root, { input }));
  }
  for (const input of [{}, { ...manifest, extra: true }, { ...manifest, domains: [...manifest.domains, ...manifest.domains] }]) {
    await assert.rejects(buildBaseline(root, { input }));
  }
  await assert.rejects(access(path.join(root, ".domainatlas/baselines")));
  assert.deepEqual(await readdir(path.join(root, ".domainatlas")), ["config.json"]);
});

test("limited scans disclose scope and graph failures never publish a partial baseline", async t => {
  const { root, invoke } = await fixture(t);
  await invoke(["init"]);
  const limited = await buildBaseline(root, { provider, maxFiles: 1, dryRun: true });
  assert.equal(limited.baseline.coverage.limited, true);
  assert.equal(limited.baseline.files.length, 1);
  await assert.rejects(buildBaseline(root, { provider: { name: "broken", async discover() { throw new Error("graph failure"); } } }), /graph failure/);
  await assert.rejects(access(path.join(root, ".domainatlas/baselines")));
});

test("changed input appends a new baseline, UI uses newest semantics and preserves old snapshots", async t => {
  const { root, invoke } = await fixture(t);
  await invoke(["init"]);
  const first = await buildBaseline(root, { input: manifest });
  const original = await readFile(path.join(root, ".domainatlas/baselines", first.baseline.id + ".json"), "utf8");
  const input = structuredClone(manifest);
  input.domains[0].capabilities[0].name = "退款审批";
  const second = await buildBaseline(root, { input });
  assert.notEqual(second.baseline.id, first.baseline.id);
  assert.equal((await readdir(path.join(root, ".domainatlas/baselines"))).length, 2);
  assert.equal(await readFile(path.join(root, ".domainatlas/baselines", first.baseline.id + ".json"), "utf8"), original);
  const snapshot = await readAtlas(root);
  assert.deepEqual(snapshot.capabilities.map(cap => cap.name), ["退款审批"]);
});

test("source mutations during discovery and redirected storage are rejected", async t => {
  const { root, invoke } = await fixture(t);
  await invoke(["init"]);
  await assert.rejects(buildBaseline(root, { provider: { name: "mutating", async discover(context) {
    await writeFile(path.join(root, "src/orders/order.ts"), "// changed during scan\n");
    return provider.discover(context);
  } } }), /changed during/);
  await assert.rejects(access(path.join(root, ".domainatlas/baselines")));
  await symlink(path.join(root, "src"), path.join(root, ".domainatlas/baselines"));
  await assert.rejects(buildBaseline(root, { input: manifest }), /local directory/);
});
