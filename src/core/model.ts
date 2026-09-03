import { createHash, randomUUID } from "node:crypto";

export type Confidence = "low" | "medium" | "high";

export interface BusinessNodeEvidence {
  source: string;
  reference: string;
  confidence: Confidence;
}

export interface BusinessDomain {
  schemaVersion: 1;
  id: string;
  name: string;
  confidence: Confidence;
  evidence: BusinessNodeEvidence[];
}

export interface BusinessCapability {
  schemaVersion: 1;
  id: string;
  domainId: string;
  name: string;
  confidence: Confidence;
  evidence: BusinessNodeEvidence[];
}

export type TestStatus = "passed" | "failed" | "not-run";

export interface TestResult {
  command: string;
  status: TestStatus;
  summary?: string;
}

export interface ChangeEvidence {
  kind: "requirement" | "changed-file" | "test" | "code-graph";
  value: string;
}

export type ChangeKind = "change" | "correction" | "revert";

export interface ChangeRecord {
  schemaVersion: 1;
  id: string;
  kind: ChangeKind;
  recordedAt: string;
  request: string;
  summary: string;
  source: {
    host: "codex";
    taskId?: string;
  };
  changedFiles: string[];
  affectedCapabilityIds: string[];
  tests: TestResult[];
  evidence: ChangeEvidence[];
  supersedes?: string;
}

export function createStableId(prefix: string, parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
  return prefix + "_" + digest;
}

export function createChangeId(): string {
  return "change_" + randomUUID();
}

