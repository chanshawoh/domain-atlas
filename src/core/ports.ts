import type {
  BusinessCapability,
  BusinessDomain,
  ChangeRecord,
} from "./model.js";

export interface StoredChange {
  record: ChangeRecord;
  relativePath: string;
}

export interface DomainModelStore {
  initialize(): Promise<void>;
  addDomainIfAbsent(domain: BusinessDomain): Promise<void>;
  addCapabilityIfAbsent(capability: BusinessCapability): Promise<void>;
  appendChange(record: ChangeRecord): Promise<StoredChange>;
  listChanges(): Promise<StoredChange[]>;
}

