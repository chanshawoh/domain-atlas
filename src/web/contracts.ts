import type { BusinessCapability, BusinessDomain, ChangeRecord } from '../core/model.js';
import type { RecordLifecycle } from '../git/git-observer.js';
import type { BusinessBaseline } from '../core/baseline.js';

export type ProjectedChange = ChangeRecord & { lifecycle: RecordLifecycle };
export interface AtlasSnapshot {
  project: { name: string; root: string; branch: string; initialized: boolean };
  domains: BusinessDomain[];
  capabilities: BusinessCapability[];
  changes: ProjectedChange[];
  baseline?: Pick<BusinessBaseline, 'id' | 'recordedAt' | 'head' | 'coverage'>;
  totals: { domains: number; capabilities: number; changes: number; pending: number; committed: number };
}
