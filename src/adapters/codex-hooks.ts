import type { CodeGraphProvider } from "../code-graph/provider.js";
import { beginHostTurn, completeHostTurn, resolveHostRoots, type HostHookResult } from "./host-turn.js";

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
  global = false,
): Promise<HostHookResult> {
  if (!input || typeof input !== "object") throw new Error("Expected a Codex hook JSON object");
  const event = input as Record<string, unknown>;
  if (event.hook_event_name !== "UserPromptSubmit" && event.hook_event_name !== "Stop") return {};
  const resolved = await resolveHostRoots(requiredString(event, "cwd"), global, event.hook_event_name === "UserPromptSubmit");
  if ("result" in resolved) return resolved.result;
  const sessionId = requiredString(event, "session_id");
  const turnId = requiredString(event, "turn_id");
  let message: string | undefined;
  for (const root of resolved.roots) {
    const result = event.hook_event_name === "UserPromptSubmit"
      ? await beginHostTurn({
        host: "codex",
        root,
        sessionId,
        turnId,
        request: requiredString(event, "prompt"),
        global,
      })
      : await completeHostTurn({
        host: "codex",
        root,
        sessionId,
        turnId,
        summary: requiredString(event, "last_assistant_message"),
        global,
        provider: primaryProvider,
        skipIfNoChanges: resolved.registryFallback,
      });
    message ??= result.systemMessage;
  }
  return message ? { systemMessage: message } : {};
}
