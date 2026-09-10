import type { BusinessCapability, BusinessDomain, ChangeRecord } from '../core/model.js';
import type { RecordLifecycle } from '../git/git-observer.js';

export type ProjectedChange = ChangeRecord & { lifecycle: RecordLifecycle };
export interface AtlasSnapshot {
  project: { name: string; root: string; branch: string; initialized: boolean };
  domains: BusinessDomain[];
  capabilities: BusinessCapability[];
  changes: ProjectedChange[];
  totals: { domains: number; capabilities: number; changes: number; pending: number; committed: number };
}
