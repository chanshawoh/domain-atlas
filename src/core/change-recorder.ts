import type { TaskCompletedEvent } from "../adapters/host.js";
import type { BusinessDiscovery, CodeGraphBudget, CodeGraphProvider } from "../code-graph/provider.js";
import { createChangeId, type ChangeEvidence, type ChangeRecord, type HostId } from "./model.js";
import type { DomainModelStore, StoredChange } from "./ports.js";
import { limitDiscovery } from "../code-graph/budget.js";
import { readDevelopmentIdentity } from "../git/git-identity.js";
import { extractRequirementParties } from "./requirement-parties.js";

export interface RecordedChange extends StoredChange {
  discovery: BusinessDiscovery;
}

export interface ChangeRecorderOptions {
  projectRoot: string;
  store: DomainModelStore;
  codeGraphProvider: CodeGraphProvider;
  now?: () => string;
  createId?: () => string;
  graphBudget?: CodeGraphBudget;
}

export class ChangeRecorder {
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly graphBudget: CodeGraphBudget;

  constructor(private readonly options: ChangeRecorderOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? createChangeId;
    this.graphBudget = options.graphBudget ?? {
      maxDepth: 2,
      maxNodes: 20,
      maxSnippetReads: 8,
      maxTokens: 6000,
    };
  }

  async recordTask(event: TaskCompletedEvent): Promise<RecordedChange> {
    const request = event.request.trim();
    const summary = event.summary.trim();
    if (!request) {
      throw new Error("Task request is required");
    }
    if (!summary) {
      throw new Error("Task summary is required");
    }
    const host: HostId = event.host ?? "codex";
    const kind = event.kind ?? "change";
    if ((kind === "correction" || kind === "revert") && !event.supersedes) {
      throw new Error(kind + " records must declare supersedes");
    }
    if (kind === "change" && event.supersedes) {
      throw new Error("Only correction or revert records can declare supersedes");
    }
    if (event.supersedes && !(await this.options.store.listChanges()).some(
      (change) => change.record.id === event.supersedes,
    )) {
      throw new Error("supersedes target does not exist: " + event.supersedes);
    }

    const changedFiles = [...new Set(event.changedFiles.filter(Boolean))].sort();
    const developmentIdentity = event.developmentIdentity === undefined
      ? await readDevelopmentIdentity(this.options.projectRoot, "ingest")
      : event.developmentIdentity;
    const discovery = limitDiscovery(await this.options.codeGraphProvider.discover({
      projectRoot: this.options.projectRoot,
      request,
      changedFiles,
      budget: this.graphBudget,
    }), this.graphBudget);
    const evidence: ChangeEvidence[] = [
      { kind: "requirement", value: request },
      ...changedFiles.map((file) => ({ kind: "changed-file" as const, value: file })),
      { kind: "code-graph", value: discovery.provider + (discovery.budgetLimited ? " (budget-limited)" : "") },
      ...(event.tests ?? []).map((test) => ({
        kind: "test" as const,
        value: test.command + ": " + test.status,
      })),
    ];
    const record: ChangeRecord = {
      schemaVersion: 1,
      id: this.createId(),
      kind,
      recordedAt: event.completedAt ?? this.now(),
      request,
      summary,
      source: {
        host,
        ...(event.taskId ? { taskId: event.taskId } : {}),
      },
      changedFiles,
      ...(event.fileChanges ? { fileChanges: event.fileChanges } : {}),
      attribution: { developmentIdentity, ...extractRequirementParties(request) },
      affectedCapabilityIds: discovery.capabilities.map((capability) => capability.id).sort(),
      tests: event.tests ?? [],
      evidence,
      ...(event.supersedes ? { supersedes: event.supersedes } : {}),
    };

    await this.options.store.initialize();
    for (const domain of discovery.domains) {
      await this.options.store.addDomainIfAbsent(domain);
    }
    for (const capability of discovery.capabilities) {
      await this.options.store.addCapabilityIfAbsent(capability);
    }
    const stored = await this.options.store.appendChange(record);
    return { ...stored, discovery };
  }
}
