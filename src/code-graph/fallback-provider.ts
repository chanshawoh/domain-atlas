import path from "node:path";
import { createStableId, type BusinessCapability, type BusinessDomain } from "../core/model.js";
import type { BusinessDiscovery, CodeGraphContext, CodeGraphProvider } from "./provider.js";
import { limitDiscovery, validateBudget } from "./budget.js";

const STRUCTURAL_SEGMENTS = new Set([
  "app",
  "apps",
  "client",
  "lib",
  "packages",
  "server",
  "src",
]);

const NON_BUSINESS_SEGMENTS = new Set([
  ".github",
  "docs",
  "scripts",
  "test",
  "tests",
]);

function cleanName(value: string): string {
  return value.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim() || "project";
}

function businessSegments(file: string): string[] {
  const segments = file.split(/[\\/]+/).filter(Boolean);
  while (segments.length > 0 && STRUCTURAL_SEGMENTS.has(segments[0].toLowerCase())) {
    segments.shift();
  }
  if (segments.length > 0 && NON_BUSINESS_SEGMENTS.has(segments[0].toLowerCase())) {
    return [];
  }
  return segments;
}

export class IncrementalFallbackCodeGraphProvider implements CodeGraphProvider {
  readonly name = "incremental-fallback";

  async discover(context: CodeGraphContext): Promise<BusinessDiscovery> {
    validateBudget(context.budget);
    const domains = new Map<string, BusinessDomain>();
    const capabilities = new Map<string, BusinessCapability>();
    let budgetLimited = false;

    for (const changedFile of context.changedFiles) {
      if (domains.size + capabilities.size >= context.budget.maxNodes) {
        budgetLimited = true;
        break;
      }

      const relativeFile = path.isAbsolute(changedFile)
        ? path.relative(context.projectRoot, changedFile)
        : changedFile;
      const segments = businessSegments(relativeFile);
      if (segments.length === 0) {
        continue;
      }
      const domainName = cleanName(segments[0] ?? "project");
      const capabilitySegment = segments.find(
        (segment, index) => index > 0 && !STRUCTURAL_SEGMENTS.has(segment.toLowerCase()),
      );
      const capabilityName = cleanName(capabilitySegment ?? segments[0] ?? "project");
      const domainId = createStableId("domain", [domainName]);
      const capabilityId = createStableId("capability", [domainId, capabilityName]);
      const evidence = {
        source: "changed-file-path",
        reference: relativeFile,
        confidence: "low" as const,
      };

      if (!domains.has(domainId)) {
        domains.set(domainId, {
          schemaVersion: 1,
          id: domainId,
          name: domainName,
          confidence: "low",
          evidence: [evidence],
        });
      }
      if (!capabilities.has(capabilityId)) {
        capabilities.set(capabilityId, {
          schemaVersion: 1,
          id: capabilityId,
          domainId,
          name: capabilityName,
          confidence: "low",
          evidence: [evidence],
        });
      }
    }

    return limitDiscovery({
      domains: [...domains.values()],
      capabilities: [...capabilities.values()],
      provider: this.name,
      ...(budgetLimited ? { budgetLimited: true } : {}),
    }, context.budget);
  }
}
