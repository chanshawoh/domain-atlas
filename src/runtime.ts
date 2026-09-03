import { CodexAdapter } from "./adapters/codex.js";
import { CodebaseMemoryCliProvider } from "./code-graph/codebase-memory-cli-provider.js";
import { IncrementalFallbackCodeGraphProvider } from "./code-graph/fallback-provider.js";
import { CodeGraphProviderChain, type CodeGraphProvider } from "./code-graph/provider.js";
import { ChangeRecorder } from "./core/change-recorder.js";
import { FileDomainModelStore } from "./storage/file-domain-model-store.js";

export interface DomainAtlasRuntime {
  adapter: CodexAdapter;
  store: FileDomainModelStore;
}

export function createDomainAtlasRuntime(
  projectRoot: string,
  primaryCodeGraphProvider: CodeGraphProvider | null = new CodebaseMemoryCliProvider(),
): DomainAtlasRuntime {
  const store = new FileDomainModelStore(projectRoot);
  const provider = new CodeGraphProviderChain(
    primaryCodeGraphProvider ?? undefined,
    new IncrementalFallbackCodeGraphProvider(),
  );
  const recorder = new ChangeRecorder({
    projectRoot,
    store,
    codeGraphProvider: provider,
  });
  return {
    adapter: new CodexAdapter(recorder),
    store,
  };
}
