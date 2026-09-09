import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import type { BusinessCapability, ChangeRecord } from "../core/model.js";
import { FileDomainModelStore } from "../storage/file-domain-model-store.js";
import { GitObserver } from "./git-observer.js";
import { git, gitRoot, headSnapshot, indexSnapshot, isLedgerPath, sameVersion, versionAt } from "./git-snapshot.js";

export interface StagePlan {
  records: string[];
  paths: string[];
  skipped: { id: string; reason: string }[];
  written: boolean;
}

function nodePath(kind: string, id: string): string {
  if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error("Unsafe DomainAtlas identifier: " + id);
  return ".domainatlas/" + kind + "/" + id + ".json";
}

export async function stageMatchingRecords(cwd: string, write = false): Promise<StagePlan> {
  const root = await gitRoot(cwd);
  const store = new FileDomainModelStore(root);
  const observer = new GitObserver(root);
  const head = await headSnapshot(root);
  const index = await indexSnapshot(root);
  const changes = await store.listChanges();
  const plan: StagePlan = { records: [], paths: [], skipped: [], written: false };
  const selected = new Map<string, ChangeRecord>();
  const committed = new Set<string>();
  for (const change of changes) {
    const record = change.record;
    if ((await observer.resolveRecordLifecycle(change.relativePath)).state === "committed") {
      committed.add(record.id);
      continue;
    }
    const evidence = record.fileChanges;
    if (!evidence?.length || evidence.length !== record.changedFiles.length ||
      new Set(evidence.map((file) => file.path)).size !== evidence.length ||
      evidence.some((file) => !record.changedFiles.includes(file.path) || isLedgerPath(file.path))) {
      plan.skipped.push({ id: record.id, reason: "No complete file-version evidence" });
      continue;
    }
    if (evidence.some((file) => sameVersion(file.before, file.after) ||
      !sameVersion(file.before, versionAt(head, file.path)) ||
      !sameVersion(file.after, versionAt(index, file.path)))) {
      plan.skipped.push({ id: record.id, reason: "Staged diff does not match the complete recorded change" });
      continue;
    }
    selected.set(record.id, record);
  }
  // Pending corrections may only travel with their selected predecessors.
  let removed: boolean;
  do {
    removed = false;
    for (const [id, record] of selected) {
      if (record.supersedes && !committed.has(record.supersedes) && !selected.has(record.supersedes)) {
        selected.delete(id);
        plan.skipped.push({ id, reason: "supersedes target is neither committed nor selected" });
        removed = true;
      }
    }
  } while (removed);

  const paths = new Set<string>();
  const readFact = async (file: string): Promise<Record<string, unknown>> => {
    // Reject symlinks in any fact path before reading or staging outside content.
    let current = root;
    for (const segment of file.split("/")) {
      current = path.join(current, segment);
      if ((await lstat(current)).isSymbolicLink()) throw new Error("Symlink in DomainAtlas fact path: " + file);
    }
    return JSON.parse(await readFile(current, "utf8")) as Record<string, unknown>;
  };
  if (selected.size) {
    await readFact(".domainatlas/config.json");
    paths.add(".domainatlas/config.json");
  }
  for (const [id, record] of selected) {
    const file = nodePath("changes", id);
    const fact = await readFact(file);
    if (fact.id !== id || JSON.stringify(fact) !== JSON.stringify(record)) throw new Error("Record changed while preparing stage plan: " + id);
    paths.add(file);
    for (const capabilityId of record.affectedCapabilityIds) {
      const capabilityPath = nodePath("capabilities", capabilityId);
      const capability = await readFact(capabilityPath) as unknown as BusinessCapability;
      if (capability.id !== capabilityId) throw new Error("Capability ID mismatch: " + capabilityId);
      const domainPath = nodePath("domains", capability.domainId);
      const domain = await readFact(domainPath);
      if (domain.id !== capability.domainId) throw new Error("Domain ID mismatch: " + capability.domainId);
      paths.add(capabilityPath);
      paths.add(domainPath);
    }
  }
  for (const file of paths) {
    const oid = (await git(root, ["hash-object", "--path=" + file, "--", file])).trim();
    if ((head[file] && head[file].oid !== oid) || (index[file] && index[file].oid !== oid)) {
      throw new Error("Refusing to overwrite a changed or partially staged fact: " + file);
    }
  }
  plan.records = [...selected.keys()].sort();
  plan.paths = [...paths].sort();
  if (write && plan.paths.length) {
    // Catch index changes while graph dependencies were being inspected.
    if (JSON.stringify(index) !== JSON.stringify(await indexSnapshot(root)) ||
      JSON.stringify(head) !== JSON.stringify(await headSnapshot(root))) {
      throw new Error("Git HEAD or index changed while preparing stage plan; retry");
    }
    await git(root, ["add", "--", ...plan.paths]);
    plan.written = true;
  }
  return plan;
}
