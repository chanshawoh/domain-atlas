import type { ChangeKind, TestResult } from "../core/model.js";
import type { ChangeRecorder, RecordedChange } from "../core/change-recorder.js";

export interface CodexTaskCompletedEvent {
  taskId?: string;
  completedAt?: string;
  request: string;
  summary: string;
  changedFiles: string[];
  tests?: TestResult[];
  kind?: ChangeKind;
  supersedes?: string;
}

export class CodexAdapter {
  constructor(private readonly recorder: ChangeRecorder) {}

  handleTaskCompleted(event: CodexTaskCompletedEvent): Promise<RecordedChange> {
    return this.recorder.recordCodexTask(event);
  }
}

