import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDomainAtlasRuntime } from "../src/runtime.js";
import { git } from "../src/git/git-snapshot.js";

async function graph(args: string[]): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile("codebase-memory-mcp", ["cli", ...args], { timeout: 60_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(error);
        try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    child.stdin?.end();
  });
}

test("installed graph CLI indexes a fixture and completes a real provider ingest", {
  skip: process.env.DOMAINATLAS_REAL_GRAPH !== "1",
}, async (t) => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "domainatlas-real-graph-")));
  const name = "domainatlas-test-" + randomUUID();
  t.after(async () => {
    try { await graph(["delete_project", "--project", name]); }
    finally { await rm(root, { recursive: true, force: true }); }
  });
  await git(root, ["init", "-b", "main"]);
  await mkdir(path.join(root, "src/billing"), { recursive: true });
  await writeFile(path.join(root, "src/billing/refund.ts"), "export class Refund { approve(): boolean { return true; } }\n");
  await graph(["index_repository", "--repo-path", root, "--name", name, "--mode", "fast"]);
  const status = await graph(["index_status", "--project", name, "--format", "json"]) as { status: string };
  assert.equal(status.status, "ready");
  const runtime = createDomainAtlasRuntime(root);
  const recorded = await runtime.adapter.handleTaskCompleted({
    request: "支持退款审核", summary: "实现退款审核", changedFiles: ["README.md", "src/billing/refund.ts"],
  });
  assert.equal(recorded.discovery.provider, "codebase-memory-mcp");
  assert.ok(recorded.discovery.capabilities.some((node) => node.name === "Refund"), JSON.stringify(recorded.discovery));
  assert.equal(recorded.discovery.domains[0].name, "billing");
  assert.equal((await runtime.store.listChanges()).length, 1);
});
