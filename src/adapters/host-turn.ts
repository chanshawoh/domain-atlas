import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CodeGraphProvider } from "../code-graph/provider.js";
import { createStableId, type DevelopmentIdentity, type HostId } from "../core/model.js";
import { readDevelopmentIdentity } from "../git/git-identity.js";
import { git, gitRoot, snapshotChanges, worktreeSnapshot, type GitSnapshot } from "../git/git-snapshot.js";
import { createDomainAtlasRuntime } from "../runtime.js";

export type HostHookResult = { systemMessage?: string };

interface TurnStart {
  request: string;
  snapshot: GitSnapshot;
  developmentIdentity?: DevelopmentIdentity | null;
  global?: boolean;
  summary?: string;
}

export function hostTurnId(host: HostId, sessionId: string, turnId: string): string {
  return createStableId("change", [host + "-hook", sessionId, turnId]);
}

async function turnStateFile(root: string, id: string): Promise<string> {
  const stateRoot = path.resolve(root, (await git(root, ["rev-parse", "--git-path", "domainatlas/turns"])).trim());
  return path.join(stateRoot, id + ".json");
}

export async function resolveHostRoot(
  cwd: string,
  global: boolean,
  isStart: boolean,
): Promise<{ root: string } | { result: HostHookResult }> {
  const root = await gitRoot(cwd).catch((error) => {
    if (global && /not a git repository/i.test(String(error.message))) return null;
    throw error;
  });
  if (!root) return { result: {} };
  if (!global) return { root };
  const configText = await readFile(path.join(root, ".domainatlas/config.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (configText === null) return { result: {} };
  try {
    const config = JSON.parse(configText);
    if (config?.schemaVersion !== 1 || config?.storage !== "immutable-json-files") throw new Error("unsupported config");
  } catch {
    return {
      result: isStart
        ? { systemMessage: "DomainAtlas: invalid or unsupported .domainatlas/config.json; recording skipped." }
        : {},
    };
  }
  return { root };
}

export async function beginHostTurn(options: {
  host: HostId;
  root: string;
  sessionId: string;
  turnId: string;
  request: string;
  global: boolean;
}): Promise<HostHookResult> {
  const id = hostTurnId(options.host, options.sessionId, options.turnId);
  const stateFile = await turnStateFile(options.root, id);
  const snapshot = await worktreeSnapshot(options.root);
  const developmentIdentity = await readDevelopmentIdentity(options.root, "turn-start");
  await mkdir(path.dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify({
    request: options.request,
    snapshot,
    developmentIdentity,
    ...(options.global ? { global: true } : {}),
  }), { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
  });
  return {};
}

export async function noteHostTurnSummary(options: {
  host: HostId;
  root: string;
  sessionId: string;
  turnId: string;
  summary: string;
}): Promise<HostHookResult> {
  const id = hostTurnId(options.host, options.sessionId, options.turnId);
  const stateFile = await turnStateFile(options.root, id);
  const start = await readFile(stateFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!start) return {};
  const baseline = JSON.parse(start) as TurnStart;
  await writeFile(stateFile, JSON.stringify({ ...baseline, summary: options.summary }));
  return {};
}

export async function completeHostTurn(options: {
  host: HostId;
  root: string;
  sessionId: string;
  turnId: string;
  summary?: string;
  global: boolean;
  provider?: CodeGraphProvider | null;
  skipIfNoChanges?: boolean;
}): Promise<HostHookResult> {
  const id = hostTurnId(options.host, options.sessionId, options.turnId);
  const stateFile = await turnStateFile(options.root, id);
  const start = await readFile(stateFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!start) {
    return options.global ? {} : { systemMessage: "DomainAtlas: missing turn-start snapshot; no change record was inferred." };
  }
  const baseline = JSON.parse(start) as TurnStart;
  if (options.global && baseline.global !== true) return {};
  const runtime = createDomainAtlasRuntime(options.root, options.provider, () => id);
  if ((await runtime.store.listChanges()).some((change) => change.record.id === id)) return {};
  const summary = (options.summary ?? baseline.summary ?? "").trim();
  if (!summary) {
    return options.global ? {} : { systemMessage: "DomainAtlas: missing turn summary; no change record was inferred." };
  }
  const fileChanges = snapshotChanges(baseline.snapshot, await worktreeSnapshot(options.root));
  if (options.skipIfNoChanges && !fileChanges.length) return {};
  try {
    await runtime.adapter.handleTaskCompleted({
      host: options.host,
      taskId: options.sessionId + "/" + options.turnId,
      request: baseline.request,
      developmentIdentity: baseline.developmentIdentity ?? null,
      summary,
      changedFiles: fileChanges.map((change) => change.path),
      fileChanges,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" ||
      !(await runtime.store.listChanges()).some((change) => change.record.id === id)) throw error;
  }
  return {};
}
