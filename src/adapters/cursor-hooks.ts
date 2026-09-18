import type { CodeGraphProvider } from "../code-graph/provider.js";
import { beginHostTurn, completeHostTurn, noteHostTurnSummary, resolveHostRoots, type HostHookResult } from "./host-turn.js";

const startEvents = new Set(["beforeSubmitPrompt"]);
const summaryEvents = new Set(["afterAgentResponse"]);
const stopEvents = new Set(["stop"]);

function requiredString(input: Record<string, unknown>, field: string): string {
  const value = input[field];
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing Cursor hook field: " + field);
  return value;
}

function workspaceRoots(event: Record<string, unknown>): string[] {
  const roots = event.workspace_roots;
  if (Array.isArray(roots)) {
    return roots.filter((root): root is string => typeof root === "string" && !!root.trim());
  }
  if (typeof event.cwd === "string" && event.cwd.trim()) return [event.cwd];
  const env = process.env.CURSOR_PROJECT_DIR;
  return env?.trim() ? [env] : [];
}

export async function handleCursorHook(
  input: unknown,
  primaryProvider?: CodeGraphProvider | null,
  global = false,
): Promise<HostHookResult> {
  if (!input || typeof input !== "object") throw new Error("Expected a Cursor hook JSON object");
  const event = input as Record<string, unknown>;
  const name = event.hook_event_name;
  if (typeof name !== "string" || (!startEvents.has(name) && !summaryEvents.has(name) && !stopEvents.has(name))) {
    return {};
  }
  const sessionId = requiredString(event, "conversation_id");
  const turnId = requiredString(event, "generation_id");
  if (stopEvents.has(name) && event.status !== "completed") return {};
  const roots = workspaceRoots(event);
  if (!roots.length) {
    if (global) return {};
    throw new Error("Missing Cursor hook field: workspace_roots");
  }
  let message: string | undefined;
  const targets = new Set<string>();
  for (const cwd of roots) {
    const resolved = await resolveHostRoots(cwd, global, startEvents.has(name));
    if ("result" in resolved) {
      message ??= resolved.result.systemMessage;
      continue;
    }
    for (const root of resolved.roots) targets.add(root);
  }
  for (const root of targets) {
    const common = { host: "cursor" as const, root, sessionId, turnId, global };
    const result = startEvents.has(name)
      ? await beginHostTurn({ ...common, request: requiredString(event, "prompt") })
      : summaryEvents.has(name)
        ? await noteHostTurnSummary({ ...common, summary: requiredString(event, "text") })
        : await completeHostTurn({
          ...common,
          provider: primaryProvider,
          skipIfNoChanges: true,
        });
    message ??= result.systemMessage;
  }
  return message ? { systemMessage: message } : {};
}
