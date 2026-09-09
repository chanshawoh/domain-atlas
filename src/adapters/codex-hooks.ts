import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createStableId } from "../core/model.js";
import type { CodeGraphProvider } from "../code-graph/provider.js";
import { git, gitRoot, snapshotChanges, worktreeSnapshot, type GitSnapshot } from "../git/git-snapshot.js";
import { createDomainAtlasRuntime } from "../runtime.js";

interface TurnStart {
  request: string;
  snapshot: GitSnapshot;
}

function requiredString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing Codex hook field: " + field);
  return value;
}

// The public hooks schema supplies the prompt and final message. Transcript internals
// and prose claims about tests are deliberately not interpreted as evidence.
export async function handleCodexHook(
  input: unknown,
  primaryProvider?: CodeGraphProvider | null,
): Promise<{ systemMessage?: string }> {
  if (!input || typeof input !== "object") throw new Error("Expected a Codex hook JSON object");
  const event = input as Record<string, unknown>;
  if (event.hook_event_name !== "UserPromptSubmit" && event.hook_event_name !== "Stop") return {};
  const root = await gitRoot(requiredString(event, "cwd"));
  const sessionId = requiredString(event, "session_id");
  const turnId = requiredString(event, "turn_id");
  const id = createStableId("change", ["codex-hook", sessionId, turnId]);
  const stateRoot = path.resolve(root, (await git(root, ["rev-parse", "--git-path", "domainatlas/turns"])).trim());
  const stateFile = path.join(stateRoot, id + ".json");
  const runtime = createDomainAtlasRuntime(root, primaryProvider, () => id);
  if (event.hook_event_name === "UserPromptSubmit") {
    const request = requiredString(event, "prompt");
    const snapshot = await worktreeSnapshot(root);
    await mkdir(stateRoot, { recursive: true });
    await writeFile(stateFile, JSON.stringify({ request, snapshot }), { flag: "wx" }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    return {};
  }
  if ((await runtime.store.listChanges()).some((change) => change.record.id === id)) return {};
  const start = await readFile(stateFile, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!start) return { systemMessage: "DomainAtlas: missing turn-start snapshot; no change record was inferred." };
  const summary = requiredString(event, "last_assistant_message");
  const baseline = JSON.parse(start) as TurnStart;
  const fileChanges = snapshotChanges(baseline.snapshot, await worktreeSnapshot(root));
  try {
    await runtime.adapter.handleTaskCompleted({
      taskId: sessionId + "/" + turnId,
      request: baseline.request,
      summary,
      changedFiles: fileChanges.map((change) => change.path),
      fileChanges,
    });
  } catch (error) {
    // Two Stop deliveries can race. Only an already-complete record is a retry.
    if ((error as NodeJS.ErrnoException).code !== "EEXIST" ||
      !(await runtime.store.listChanges()).some((change) => change.record.id === id)) throw error;
  }
  return {};
}
