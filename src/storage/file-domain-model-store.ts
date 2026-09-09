import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { access, link, mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BusinessCapability, BusinessDomain, ChangeRecord } from "../core/model.js";
import type { DomainModelStore, StoredChange } from "../core/ports.js";

const SAFE_ID = /^[a-z0-9_-]+$/i;

function assertSafeId(id: string): void {
  if (!SAFE_ID.test(id)) {
    throw new Error("Unsafe DomainAtlas identifier: " + id);
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function writeJsonIfAbsent(file: string, value: unknown): Promise<void> {
  try {
    await writeJsonExclusive(file, value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
  }
}

async function writeJsonExclusive(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + "." + randomUUID() + ".tmp";
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    // Publish a complete file atomically without replacing an existing record.
    await link(temporary, file);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

function isChangeRecord(value: unknown): value is ChangeRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ChangeRecord>;
  return candidate.schemaVersion === 1 && typeof candidate.id === "string";
}

export class FileDomainModelStore implements DomainModelStore {
  private readonly atlasRoot: string;

  constructor(private readonly projectRoot: string) {
    this.atlasRoot = path.join(projectRoot, ".domainatlas");
  }

  async initialize(): Promise<void> {
    await mkdir(this.atlasRoot, { recursive: true });
    const configPath = path.join(this.atlasRoot, "config.json");
    if (!(await exists(configPath))) {
      await writeJsonIfAbsent(configPath, {
        schemaVersion: 1,
        storage: "immutable-json-files",
      });
    }
  }

  async addDomainIfAbsent(domain: BusinessDomain): Promise<void> {
    assertSafeId(domain.id);
    await writeJsonIfAbsent(path.join(this.atlasRoot, "domains", domain.id + ".json"), domain);
  }

  async addCapabilityIfAbsent(capability: BusinessCapability): Promise<void> {
    assertSafeId(capability.id);
    await writeJsonIfAbsent(
      path.join(this.atlasRoot, "capabilities", capability.id + ".json"),
      capability,
    );
  }

  async appendChange(record: ChangeRecord): Promise<StoredChange> {
    assertSafeId(record.id);
    const relativePath = path.posix.join(".domainatlas", "changes", record.id + ".json");
    const absolutePath = path.join(this.projectRoot, relativePath);
    await writeJsonExclusive(absolutePath, record);
    return { record, relativePath };
  }

  async listChanges(): Promise<StoredChange[]> {
    const changesRoot = path.join(this.atlasRoot, "changes");
    if (!(await exists(changesRoot))) {
      return [];
    }
    const entries = await readdir(changesRoot, { withFileTypes: true });
    const changes: StoredChange[] = [];
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort()) {
      const relativePath = path.posix.join(".domainatlas", "changes", entry.name);
      const content = await readFile(path.join(this.projectRoot, relativePath), "utf8");
      const parsed: unknown = JSON.parse(content);
      if (!isChangeRecord(parsed)) {
        throw new Error("Invalid DomainAtlas change record: " + relativePath);
      }
      changes.push({ record: parsed, relativePath });
    }
    return changes;
  }
}
