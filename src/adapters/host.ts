import type { ChangeRecorder, RecordedChange } from "../core/change-recorder.js";
import type { ChangeKind, DevelopmentIdentity, FileChange, HostId, TestResult } from "../core/model.js";

export interface TaskCompletedEvent {
  host?: HostId;
  taskId?: string;
  completedAt?: string;
  request: string;
  summary: string;
  changedFiles: string[];
  fileChanges?: FileChange[];
  developmentIdentity?: DevelopmentIdentity | null;
  tests?: TestResult[];
  kind?: ChangeKind;
  supersedes?: string;
}

export class HostAdapter {
  constructor(private readonly recorder: ChangeRecorder) {}

  handleTaskCompleted(event: TaskCompletedEvent): Promise<RecordedChange> {
    return this.recorder.recordTask(event);
  }
}
